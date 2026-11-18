import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import type { QuoteLead } from "./deliver";

/**
 * Envio da solicitação de cotação por e-mail via SMTP autenticado
 * (E-mail Locaweb: email-ssl.com.br, porta 465, SSL/TLS).
 *
 * - Credenciais só no servidor (SMTP_PASSWORD como secret na Vercel); nunca
 *   expostas ao navegador, a logs ou a respostas da API.
 * - Remetente autenticado = SMTP_USER (o "From" precisa ser o mesmo
 *   endereço); o e-mail do visitante vai apenas em Reply-To.
 * - Timeouts curtos e explícitos: a função serverless nunca fica presa.
 * - Message-ID estável por conteúdo + minuto, para que clientes/servidores de
 *   e-mail reconheçam reenvios idênticos.
 * - Logs sem dados pessoais: apenas código do erro SMTP.
 */

/** Destinatário comercial das solicitações (pode ser sobrescrito por QUOTE_EMAIL_TO). */
export const DEFAULT_QUOTE_RECIPIENT = "folhatec@folhatec.com.br";
export const QUOTE_EMAIL_SUBJECT = "Nova solicitação de cotação | Site FolhaTec";
export const DEFAULT_SENDER_NAME = "FolhaTec - Site";

/** Timeouts SMTP (ms). Os padrões do Nodemailer (2 a 10 min) são longos demais para serverless. */
export const SMTP_TIMEOUTS = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000 } as const;
/** Teto total do envio, independente das fases acima. */
export const SMTP_SEND_DEADLINE_MS = 20000;

/** Variáveis de ambiente (process.env ou um objeto equivalente nos testes). */
export type EnvVars = Readonly<Record<string, string | undefined>>;

/**
 * Estado de um canal de entrega lido do ambiente:
 * - absent: nada configurado (dev/staging usam stub);
 * - invalid: configurado de forma incompleta/errada — nunca vira stub
 *   silencioso; a entrega falha de forma visível (503);
 * - ready: pronto para uso.
 */
export type ChannelConfig<T> = { state: "absent" } | { state: "invalid" } | { state: "ready"; config: T };

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /** "Nome <endereço>" — o endereço é sempre o SMTP_USER. */
  from: string;
  to: string;
}

/** Títulos legíveis da solução/segmento escolhidos (o lead guarda só os slugs). */
export interface QuoteContextLabels {
  solution: string | null;
  segment: string | null;
}

export interface QuoteEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
}

export type SmtpFailureReason = "auth" | "timeout" | "network_error" | "rejected" | "unknown";

export type EmailSendResult =
  | { status: "delivered"; messageId: string }
  | { status: "failed"; reason: SmtpFailureReason; code?: string; responseCode?: number };

const ADDRESS = /^[^\s@<>"]+@[^\s@<>.]+(\.[^\s@<>.]+)+$/;
const NAMED_ADDRESS = /^([^<>"\r\n]{1,80})<([^\s@<>"]+@[^\s@<>.]+(\.[^\s@<>.]+)+)>$/;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Endereço contido em "email@dominio" ou "Nome <email@dominio>"; null se inválido. */
export function senderAddress(value: string): string | null {
  if (ADDRESS.test(value)) return value.toLowerCase();
  const named = NAMED_ADDRESS.exec(value);
  return named?.[2] ? named[2].toLowerCase() : null;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

/**
 * Configuração SMTP a partir do ambiente.
 * - `absent`: nenhuma de SMTP_HOST / SMTP_USER / SMTP_PASSWORD definida
 *   (QUOTE_EMAIL_FROM/TO sozinhos não ativam o envio).
 * - `invalid`: qualquer configuração parcial ou inconsistente — inclusive
 *   "From" com endereço diferente do usuário autenticado.
 * Nenhum valor é registrado em log.
 */
export function readSmtpConfig(env: EnvVars = process.env): ChannelConfig<SmtpConfig> {
  const host = env.SMTP_HOST?.trim() ?? "";
  const user = env.SMTP_USER?.trim().toLowerCase() ?? "";
  const password = env.SMTP_PASSWORD ?? "";
  if (!host && !user && !password) return { state: "absent" };

  const port = Number(env.SMTP_PORT?.trim() || "465");
  const secureRaw = env.SMTP_SECURE;
  const secure = parseBoolean(secureRaw) ?? port === 465;
  const from = env.QUOTE_EMAIL_FROM?.trim() || `${DEFAULT_SENDER_NAME} <${user}>`;
  const to = (env.QUOTE_EMAIL_TO?.trim() || DEFAULT_QUOTE_RECIPIENT).toLowerCase();

  const problems = [
    !HOSTNAME.test(host) && "SMTP_HOST",
    !ADDRESS.test(user) && "SMTP_USER",
    !password && "SMTP_PASSWORD",
    !(Number.isInteger(port) && port > 0 && port < 65536) && "SMTP_PORT",
    secureRaw !== undefined && secureRaw.trim() !== "" && parseBoolean(secureRaw) === null && "SMTP_SECURE",
    senderAddress(from) !== user && "QUOTE_EMAIL_FROM (deve usar o endereço do SMTP_USER)",
    !ADDRESS.test(to) && "QUOTE_EMAIL_TO",
  ].filter(Boolean);
  if (problems.length) {
    console.error(`[quote] Configuração SMTP incompleta ou inválida: ${problems.join(", ")}.`);
    return { state: "invalid" };
  }
  return { state: "ready", config: { host, port, secure, user, password, from, to } };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Data/hora no fuso de Brasília, com precisão de minuto. */
export function formatBrasiliaTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} (horário de Brasília)`;
}

function contextLabel(slug: string | null, label: string | null): string | null {
  if (!slug) return null;
  return label ? label : slug;
}

const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;

/** Linhas [rótulo, valor] — somente campos efetivamente preenchidos. */
export function quoteEmailRows(lead: QuoteLead, labels: QuoteContextLabels): {
  contact: Array<[string, string]>;
  request: Array<[string, string]>;
  origin: Array<[string, string]>;
} {
  const solution = contextLabel(lead.context.solution, labels.solution);
  const segment = contextLabel(lead.context.segment, labels.segment);
  const attribution = lead.attribution;
  const lastTouch = attribution.last_touch ?? attribution.first_touch;
  const campaign = lastTouch
    ? CAMPAIGN_KEYS.filter((key) => lastTouch[key]).map((key) => `${key}=${lastTouch[key]}`).join(" · ")
    : "";

  const contact: Array<[string, string]> = [
    ["Nome", lead.contact.name],
    ...(lead.contact.company ? [["Empresa", lead.contact.company] as [string, string]] : []),
    ["E-mail", lead.contact.email],
    ["Telefone / WhatsApp", lead.contact.phone],
  ];
  const request: Array<[string, string]> = [
    ...(solution ? [["Solução de interesse", solution] as [string, string]] : []),
    ...(segment ? [["Segmento", segment] as [string, string]] : []),
    ["Mensagem", lead.message ?? "(não informada)"],
  ];
  const origin: Array<[string, string]> = [
    ["Data e horário", formatBrasiliaTime(lead.submitted_at)],
    ...(attribution.conversion_page ? [["Página de envio", attribution.conversion_page] as [string, string]] : []),
    ...(attribution.origin_url && attribution.origin_url !== attribution.conversion_page
      ? [["Entrada no site", attribution.origin_url] as [string, string]]
      : []),
    ...(attribution.referrer ? [["Origem (referrer)", attribution.referrer] as [string, string]] : []),
    ...(campaign ? [["Campanha", campaign] as [string, string]] : []),
    ["Consentimento LGPD", "Aceite da Política de Privacidade registrado no envio"],
    ["Site", `${lead.site.url} (${lead.site.env})`],
  ];
  return { contact, request, origin };
}

function htmlSection(title: string, rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><th align="left" valign="top" style="padding:6px 12px 6px 0;color:#5d5da7;font-weight:600;white-space:nowrap">${escapeHtml(label)}</th>` +
        `<td style="padding:6px 0;color:#0f0f0f;white-space:pre-wrap;word-break:break-word">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return (
    `<h2 style="margin:24px 0 8px;font-size:15px;color:#232c73;text-transform:uppercase;letter-spacing:.06em">${escapeHtml(title)}</h2>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;line-height:1.5">${body}</table>`
  );
}

function textSection(title: string, rows: Array<[string, string]>): string {
  return `${title.toUpperCase()}\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}`;
}

/**
 * Impressão digital da solicitação: mesmo conteúdo no mesmo minuto → mesma
 * chave. Usada no Message-ID e na proteção contra duplicidade.
 */
export function quoteFingerprint(lead: QuoteLead): string {
  const minute = lead.submitted_at.slice(0, 16);
  const fingerprint = JSON.stringify([lead.contact, lead.message, lead.context, minute]);
  return createHash("sha256").update(fingerprint).digest("hex").slice(0, 40);
}

export function buildQuoteEmail(lead: QuoteLead, labels: QuoteContextLabels, config: Pick<SmtpConfig, "from" | "to" | "user">): QuoteEmail {
  const { contact, request, origin } = quoteEmailRows(lead, labels);
  const intro = "Nova solicitação de cotação enviada pelo site da FolhaTec. Use “Responder” para falar diretamente com o solicitante.";
  const domain = config.user.split("@")[1] ?? "folhatec.com.br";

  const html =
    `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="max-width:640px;margin:0 auto;background:#ffffff;border-top:4px solid #cccf32;padding:24px 28px">` +
    `<h1 style="margin:0 0 8px;font-size:20px;color:#232c73">${escapeHtml(QUOTE_EMAIL_SUBJECT)}</h1>` +
    `<p style="margin:0;color:#4a4a4a;font-size:14px">${escapeHtml(intro)}</p>` +
    htmlSection("Contato", contact) +
    htmlSection("Solicitação", request) +
    htmlSection("Origem", origin) +
    `</div></body></html>`;

  const text = [QUOTE_EMAIL_SUBJECT, intro, textSection("Contato", contact), textSection("Solicitação", request), textSection("Origem", origin)].join(
    "\n\n",
  );

  return {
    from: config.from,
    to: config.to,
    replyTo: lead.contact.email,
    subject: QUOTE_EMAIL_SUBJECT,
    html,
    text,
    messageId: `<cotacao-${quoteFingerprint(lead)}@${domain}>`,
  };
}

/** Classifica erros do Nodemailer/SMTP sem expor mensagens (que podem conter endereços). */
export function classifySmtpError(error: unknown): { reason: SmtpFailureReason; code?: string; responseCode?: number } {
  const err = (error ?? {}) as { code?: unknown; responseCode?: unknown; name?: unknown };
  const code = typeof err.code === "string" ? err.code : undefined;
  const responseCode = typeof err.responseCode === "number" ? err.responseCode : undefined;
  let reason: SmtpFailureReason = "unknown";
  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) reason = "auth";
  else if (code === "ETIMEDOUT" || err.name === "SmtpDeadline") reason = "timeout";
  else if (code && ["ECONNECTION", "ESOCKET", "EDNS", "ETLS", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"].includes(code)) {
    reason = "network_error";
  } else if (code === "EENVELOPE" || code === "EMESSAGE" || (responseCode !== undefined && responseCode >= 400)) reason = "rejected";
  return { reason, ...(code ? { code } : {}), ...(responseCode !== undefined ? { responseCode } : {}) };
}

/** Opções de transporte só para testes (ex.: servidor SMTP simulado sem TLS). */
export interface SmtpTestOverrides {
  ignoreTLS?: boolean;
  requireTLS?: boolean;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  deadlineMs?: number;
}

/** Envia o e-mail e só retorna `delivered` quando o servidor SMTP aceita o destinatário. */
export async function sendQuoteEmail(
  lead: QuoteLead,
  labels: QuoteContextLabels,
  config: SmtpConfig,
  overrides: SmtpTestOverrides = {},
): Promise<EmailSendResult> {
  const email = buildQuoteEmail(lead, labels, config);
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Sem SSL direto (ex.: porta 587), exige STARTTLS — nunca autentica em texto puro.
    requireTLS: overrides.requireTLS ?? !config.secure,
    ignoreTLS: overrides.ignoreTLS ?? false,
    auth: { user: config.user, pass: config.password },
    tls: { servername: config.host, minVersion: "TLSv1.2" },
    connectionTimeout: overrides.connectionTimeout ?? SMTP_TIMEOUTS.connectionTimeout,
    greetingTimeout: overrides.greetingTimeout ?? SMTP_TIMEOUTS.greetingTimeout,
    socketTimeout: overrides.socketTimeout ?? SMTP_TIMEOUTS.socketTimeout,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("SMTP deadline"), { name: "SmtpDeadline" })),
      overrides.deadlineMs ?? SMTP_SEND_DEADLINE_MS,
    );
  });

  try {
    const info = await Promise.race([
      transport.sendMail({
        from: email.from,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        messageId: email.messageId,
      }),
      deadline,
    ]);
    const accepted = info.accepted.map((address) => String(address).toLowerCase());
    if (!accepted.includes(config.to) || info.rejected.length > 0) {
      console.error("[quote] SMTP não aceitou o destinatário da solicitação.");
      return { status: "failed", reason: "rejected" };
    }
    console.info("[quote] E-mail aceito pelo servidor SMTP.");
    return { status: "delivered", messageId: email.messageId };
  } catch (error) {
    const failure = classifySmtpError(error);
    const detail = [failure.code, failure.responseCode].filter(Boolean).join(" ");
    console.error(`[quote] Falha no envio SMTP: ${failure.reason}${detail ? ` (${detail})` : ""}.`);
    return { status: "failed", ...failure };
  } finally {
    if (timer) clearTimeout(timer);
    transport.close();
  }
}
