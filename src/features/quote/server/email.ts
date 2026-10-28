import { createHash } from "node:crypto";
import type { QuoteLead } from "./deliver";

/**
 * Envio da solicitação de cotação por e-mail via Resend (API HTTP, sem SDK).
 * https://resend.com/docs/api-reference/emails/send-email
 *
 * - Credencial só no servidor (RESEND_API_KEY); nunca exposta ao navegador.
 * - Remetente autenticado = QUOTE_EMAIL_FROM (domínio verificado no Resend);
 *   o e-mail do visitante vai apenas em `reply_to`.
 * - `Idempotency-Key` estável por conteúdo + minuto: reenvios idênticos
 *   (duplo clique, retry de rede) não geram e-mails duplicados.
 * - Logs sem dados pessoais: apenas status HTTP e tipo de erro do provedor.
 */

export const RESEND_API_URL = "https://api.resend.com/emails";
/** Destinatário comercial das solicitações (pode ser sobrescrito por QUOTE_EMAIL_TO). */
export const DEFAULT_QUOTE_RECIPIENT = "folhatec@folhatec.com.br";
export const QUOTE_EMAIL_SUBJECT = "Nova solicitação de cotação | FolhaTec";
export const EMAIL_TIMEOUT_MS = 8000;

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

export interface EmailConfig {
  apiKey: string;
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
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
}

export type EmailSendResult =
  | { status: "delivered"; id: string | null }
  | { status: "failed"; reason: "timeout" | "http_error" | "network_error"; httpStatus?: number };

const ADDRESS = /^[^\s@<>]+@[^\s@<>.]+(\.[^\s@<>.]+)+$/;
const NAMED_ADDRESS = /^[^<>\r\n]{1,80}<([^\s@<>]+@[^\s@<>.]+(\.[^\s@<>.]+)+)>$/;

/** Aceita "email@dominio" ou "Nome <email@dominio>". */
export function isValidSender(value: string): boolean {
  return ADDRESS.test(value) || NAMED_ADDRESS.test(value);
}

/**
 * Configuração do e-mail a partir do ambiente. Sem RESEND_API_KEY e sem
 * QUOTE_EMAIL_FROM → `absent`. Qualquer configuração parcial ou inválida →
 * `invalid` (registrado em log, sem valores).
 */
export function readEmailConfig(env: EnvVars = process.env): ChannelConfig<EmailConfig> {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const from = env.QUOTE_EMAIL_FROM?.trim() ?? "";
  const to = env.QUOTE_EMAIL_TO?.trim() || DEFAULT_QUOTE_RECIPIENT;
  if (!apiKey && !from) return { state: "absent" };
  if (!apiKey || !isValidSender(from) || !ADDRESS.test(to)) {
    console.error("[quote] Configuração de e-mail incompleta ou inválida (RESEND_API_KEY / QUOTE_EMAIL_FROM / QUOTE_EMAIL_TO).");
    return { state: "invalid" };
  }
  return { state: "ready", config: { apiKey, from, to } };
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

export function buildQuoteEmail(lead: QuoteLead, labels: QuoteContextLabels, config: Pick<EmailConfig, "from" | "to">): QuoteEmail {
  const { contact, request, origin } = quoteEmailRows(lead, labels);
  const intro = "Nova solicitação de cotação enviada pelo site da FolhaTec. Responda este e-mail para falar diretamente com o solicitante.";

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
    to: [config.to],
    reply_to: lead.contact.email,
    subject: QUOTE_EMAIL_SUBJECT,
    html,
    text,
  };
}

/**
 * Chave de idempotência: mesmo conteúdo no mesmo minuto → mesma chave.
 * O corpo do e-mail também tem precisão de minuto, então um reenvio idêntico
 * é reconhecido pelo Resend e não gera segundo e-mail.
 */
export function quoteIdempotencyKey(lead: QuoteLead): string {
  const minute = lead.submitted_at.slice(0, 16);
  const fingerprint = JSON.stringify([lead.contact, lead.message, lead.context, minute]);
  return `folhatec-quote-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 40)}`;
}

/** Envia o e-mail; `fetchImpl` permite testar respostas do provedor sem rede. */
export async function sendQuoteEmail(
  lead: QuoteLead,
  labels: QuoteContextLabels,
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailSendResult> {
  const email = buildQuoteEmail(lead, labels, config);
  try {
    const response = await fetchImpl(RESEND_API_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": quoteIdempotencyKey(lead),
        "user-agent": "folhatec-site/quote-email",
      },
      body: JSON.stringify(email),
      cache: "no-store",
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Apenas o tipo do erro (ex.: validation_error) — a mensagem pode conter endereços.
      const errorName = await response
        .json()
        .then((body: unknown) => (body && typeof body === "object" && "name" in body ? String((body as { name: unknown }).name) : "desconhecido"))
        .catch(() => "desconhecido");
      console.error(`[quote] Resend recusou o envio: HTTP ${response.status} (${errorName.slice(0, 60)}).`);
      return { status: "failed", reason: "http_error", httpStatus: response.status };
    }
    const id = await response
      .json()
      .then((body: unknown) => (body && typeof body === "object" && "id" in body ? String((body as { id: unknown }).id) : null))
      .catch(() => null);
    console.info(`[quote] E-mail aceito pelo Resend${id ? ` (id ${id})` : ""}.`);
    return { status: "delivered", id };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    console.error(`[quote] Falha ao chamar o Resend (${timedOut ? "timeout" : "erro de rede"}).`);
    return { status: "failed", reason: timedOut ? "timeout" : "network_error" };
  }
}
