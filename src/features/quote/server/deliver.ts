import { createHmac } from "node:crypto";
import { SITE_ENV, SITE_URL } from "@/lib/config/env";
import type { AttributionPayload } from "../attribution";
import type { QuoteData } from "../validation";
import {
  quoteFingerprint,
  readSmtpConfig,
  sendQuoteEmail,
  type ChannelConfig,
  type EnvVars,
  type QuoteContextLabels,
  type SmtpFailureReason,
  type SmtpTestOverrides,
} from "./email";

/** Timeout do webhook: a requisição nunca espera indefinidamente. */
export const WEBHOOK_TIMEOUT_MS = 8000;
/** Janela em que uma solicitação idêntica já entregue não é reenviada. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export interface QuoteLead {
  /** Timestamp oficial — gerado pelo servidor. */
  submitted_at: string;
  site: { url: string; env: string };
  contact: {
    name: string;
    company: string | null;
    phone: string;
    email: string;
  };
  message: string | null;
  context: { solution: string | null; segment: string | null };
  consent: { privacy_policy: true; accepted_at: string };
  attribution: AttributionPayload;
}

export type DeliveryResult =
  | { status: "delivered" }
  | { status: "stub" }
  | { status: "not_configured" }
  | { status: "failed"; reason: SmtpFailureReason | "http_error"; httpStatus?: number };

export function buildLead(data: QuoteData, attribution: AttributionPayload, now = new Date()): QuoteLead {
  const timestamp = now.toISOString();
  return {
    submitted_at: timestamp,
    site: { url: SITE_URL, env: SITE_ENV },
    contact: { name: data.name, company: data.company, phone: data.phone, email: data.email },
    message: data.message,
    context: { solution: data.solution, segment: data.segment },
    consent: { privacy_policy: true, accepted_at: timestamp },
    attribution,
  };
}

interface WebhookConfig {
  url: string;
  secret: string | null;
}

function readWebhookConfig(env: EnvVars): ChannelConfig<WebhookConfig> {
  const url = env.QUOTE_WEBHOOK_URL?.trim();
  if (!url) return { state: "absent" };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocolo");
  } catch {
    console.error("[quote] QUOTE_WEBHOOK_URL inválida.");
    return { state: "invalid" };
  }
  return { state: "ready", config: { url, secret: env.QUOTE_WEBHOOK_SECRET?.trim() || null } };
}

/** Há algum canal real (SMTP/webhook) configurado, válido ou não? */
export function hasDeliveryChannel(env: EnvVars = process.env): boolean {
  return readSmtpConfig(env).state !== "absent" || readWebhookConfig(env).state !== "absent";
}

/**
 * Hosts em que o envio real é permitido. Padrão: o host de
 * NEXT_PUBLIC_SITE_URL e sua variante com/sem "www" (ex.: www.folhatec.com.br
 * e folhatec.com.br). QUOTE_ALLOWED_HOSTS (lista separada por vírgula)
 * substitui o padrão. Em outros hosts (ex.: URL *.vercel.app de homologação)
 * a solicitação não é enviada e o site informa isso ao visitante.
 */
export function allowedDeliveryHosts(env: EnvVars = process.env, siteUrl: string = SITE_URL): string[] {
  const explicit = env.QUOTE_ALLOWED_HOSTS?.split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (explicit?.length) return explicit;
  try {
    const host = new URL(siteUrl).host.toLowerCase();
    return [host, host.startsWith("www.") ? host.slice(4) : `www.${host}`];
  } catch {
    return [];
  }
}

export interface DeliveryOptions {
  env?: EnvVars;
  siteEnv?: string;
  siteUrl?: string;
  /** Host que recebeu a requisição; `undefined` desativa a verificação (testes unitários). */
  host?: string | null;
  fetchImpl?: typeof fetch;
  smtpOverrides?: SmtpTestOverrides;
}

// Proteção contra duplicidade (melhor esforço, por instância serverless):
// envios simultâneos idênticos compartilham o mesmo resultado e um envio
// idêntico já entregue não é repetido dentro da janela.
const inflight = new Map<string, Promise<DeliveryResult>>();
const recentlyDelivered = new Map<string, number>();

/** Limpa a memória de duplicidade (usado nos testes). */
export function resetDeliveryMemory(): void {
  inflight.clear();
  recentlyDelivered.clear();
}

/**
 * Entrega o lead.
 * - SMTP (SMTP_HOST + SMTP_USER + SMTP_PASSWORD): canal principal. O sucesso
 *   só é confirmado quando o servidor SMTP aceita a mensagem; falha no e-mail
 *   = falha da entrega.
 * - Webhook (QUOTE_WEBHOOK_URL): opcional. Sozinho, é o canal principal; junto
 *   com o e-mail, é complementar (falha apenas registrada em log).
 * - Canal principal configurado de forma inválida: `not_configured` em
 *   qualquer ambiente — nunca stub silencioso.
 * - Host fora da lista autorizada: stub (nada é enviado; o site avisa).
 * - Nenhum canal em development/staging: stub (nada é enviado; o site avisa).
 * - Nenhum canal em production: `not_configured` (a API retorna erro).
 * Nenhum dado pessoal ou credencial é registrado em log.
 */
export async function deliverQuote(
  lead: QuoteLead,
  labels: QuoteContextLabels = { solution: null, segment: null },
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const env = options.env ?? process.env;
  const siteEnv = options.siteEnv ?? SITE_ENV;
  const fetchImpl = options.fetchImpl ?? fetch;
  const smtp = readSmtpConfig(env);
  const webhook = readWebhookConfig(env);

  if (smtp.state === "invalid" || (smtp.state === "absent" && webhook.state === "invalid")) {
    console.error("[quote] Canal de entrega configurado incorretamente. Lead não entregue.");
    return { status: "not_configured" };
  }

  if (smtp.state === "absent" && webhook.state === "absent") {
    if (siteEnv === "production") {
      console.error("[quote] Nenhum canal de entrega configurado em produção (SMTP/webhook). Lead não entregue.");
      return { status: "not_configured" };
    }
    console.info("[quote] Entrega não configurada — stub (nenhum envio realizado).");
    return { status: "stub" };
  }

  if (options.host !== undefined) {
    const host = (options.host ?? "").toLowerCase();
    if (!allowedDeliveryHosts(env, options.siteUrl ?? SITE_URL).includes(host)) {
      console.warn("[quote] Host sem autorização para envio real — stub (nenhum envio realizado).");
      return { status: "stub" };
    }
  }

  const key = quoteFingerprint(lead);
  const now = Date.now();
  for (const [entry, expires] of recentlyDelivered) if (expires <= now) recentlyDelivered.delete(entry);
  if (recentlyDelivered.has(key)) {
    console.info("[quote] Solicitação idêntica já entregue — reenvio ignorado.");
    return { status: "delivered" };
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async (): Promise<DeliveryResult> => {
    if (smtp.state === "absent") {
      return webhook.state === "ready" ? sendWebhook(lead, webhook.config, fetchImpl) : { status: "not_configured" };
    }
    const [emailResult, webhookResult] = await Promise.all([
      sendQuoteEmail(lead, labels, smtp.config, options.smtpOverrides),
      webhook.state === "ready" ? sendWebhook(lead, webhook.config, fetchImpl) : Promise.resolve(null),
    ]);
    if (webhookResult?.status === "failed") {
      console.error("[quote] Webhook complementar falhou; o e-mail segue como canal principal.");
    }
    return emailResult.status === "delivered" ? { status: "delivered" } : { status: "failed", reason: emailResult.reason };
  })();

  inflight.set(key, run);
  try {
    const result = await run;
    if (result.status === "delivered") recentlyDelivered.set(key, Date.now() + DUPLICATE_WINDOW_MS);
    return result;
  } finally {
    inflight.delete(key);
  }
}

async function sendWebhook(lead: QuoteLead, config: WebhookConfig, fetchImpl: typeof fetch): Promise<DeliveryResult> {
  const body = JSON.stringify(lead);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "folhatec-site/quote-webhook",
  };
  if (config.secret) {
    headers["x-folhatec-signature"] = `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`;
  }

  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[quote] Webhook respondeu HTTP ${response.status}.`);
      return { status: "failed", reason: "http_error", httpStatus: response.status };
    }
    return { status: "delivered" };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    console.error(`[quote] Falha ao chamar webhook (${timedOut ? "timeout" : "erro de rede"}).`);
    return { status: "failed", reason: timedOut ? "timeout" : "network_error" };
  }
}
