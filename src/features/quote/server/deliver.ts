import { createHmac } from "node:crypto";
import { SITE_ENV, SITE_URL } from "@/lib/config/env";
import type { AttributionPayload } from "../attribution";
import type { QuoteData } from "../validation";
import { readEmailConfig, sendQuoteEmail, type ChannelConfig, type EnvVars, type QuoteContextLabels } from "./email";

/** Timeout do webhook: a requisição nunca espera indefinidamente. */
export const WEBHOOK_TIMEOUT_MS = 8000;

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
  | { status: "failed"; reason: "timeout" | "http_error" | "network_error"; httpStatus?: number };

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

export interface DeliveryOptions {
  env?: EnvVars;
  siteEnv?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Entrega o lead.
 * - E-mail (RESEND_API_KEY + QUOTE_EMAIL_FROM): canal principal. O sucesso só
 *   é confirmado após o aceite do Resend; falha no e-mail = falha da entrega.
 * - Webhook (QUOTE_WEBHOOK_URL): opcional. Sozinho, é o canal principal; junto
 *   com o e-mail, é complementar (falha apenas registrada em log).
 * - Canal principal configurado de forma inválida: `not_configured` em
 *   qualquer ambiente — nunca stub silencioso.
 * - Nenhum canal em development/staging: stub (nada é enviado).
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
  const email = readEmailConfig(env);
  const webhook = readWebhookConfig(env);

  if (email.state === "invalid" || (email.state === "absent" && webhook.state === "invalid")) {
    console.error("[quote] Canal de entrega configurado incorretamente. Lead não entregue.");
    return { status: "not_configured" };
  }

  if (email.state === "absent") {
    if (webhook.state === "ready") return sendWebhook(lead, webhook.config, fetchImpl);
    if (siteEnv === "production") {
      console.error("[quote] Nenhum canal de entrega configurado em produção (e-mail/webhook). Lead não entregue.");
      return { status: "not_configured" };
    }
    console.info("[quote] Entrega não configurada — stub de desenvolvimento (nenhum envio realizado).");
    return { status: "stub" };
  }

  const [emailResult, webhookResult] = await Promise.all([
    sendQuoteEmail(lead, labels, email.config, fetchImpl),
    webhook.state === "ready" ? sendWebhook(lead, webhook.config, fetchImpl) : Promise.resolve(null),
  ]);
  if (webhookResult?.status === "failed") {
    console.error("[quote] Webhook complementar falhou; o e-mail segue como canal principal.");
  }
  return emailResult.status === "delivered" ? { status: "delivered" } : emailResult;
}

async function sendWebhook(
  lead: QuoteLead,
  config: WebhookConfig,
  fetchImpl: typeof fetch,
): Promise<DeliveryResult> {
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
