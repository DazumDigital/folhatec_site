/**
 * Testes unitários (sem navegador e sem rede) do envio das solicitações por
 * e-mail (Resend) e da escolha do canal de entrega. O provedor é simulado
 * com um `fetch` falso — nenhuma mensagem real é enviada.
 */
import { expect, test } from "@playwright/test";
import { sanitizeAttribution } from "../../src/features/quote/attribution";
import { buildLead, deliverQuote } from "../../src/features/quote/server/deliver";
import {
  DEFAULT_QUOTE_RECIPIENT,
  QUOTE_EMAIL_SUBJECT,
  RESEND_API_URL,
  buildQuoteEmail,
  readEmailConfig,
  quoteIdempotencyKey,
  sendQuoteEmail,
  type EmailConfig,
} from "../../src/features/quote/server/email";

const CONFIG: EmailConfig = { apiKey: "re_test_fake", from: "Site FolhaTec <site@folhatec.com.br>", to: DEFAULT_QUOTE_RECIPIENT };
const LABELS = { solution: "Etiquetas", segment: "Criogenia" };
const EMAIL_ENV = { RESEND_API_KEY: "re_test_fake", QUOTE_EMAIL_FROM: "Site FolhaTec <site@folhatec.com.br>" };

function makeLead(overrides: Partial<Parameters<typeof buildLead>[0]> = {}, now = new Date("2026-10-28T13:45:30.000Z")) {
  return buildLead(
    {
      name: "Maria Teste",
      company: "Indústria Exemplo",
      phone: "(47) 99999-0000",
      email: "maria@example.com",
      message: "Preciso de etiquetas para tubos.\nQuantidade: 5 mil.",
      consent: true,
      solution: "etiquetas",
      segment: "criogenia",
      ...overrides,
    },
    sanitizeAttribution({
      origin_url: "https://folhatec-v3.vercel.app/?utm_source=google",
      conversion_page: "https://folhatec-v3.vercel.app/solicitar-cotacao?solucao=etiquetas&segmento=criogenia",
      referrer: "https://www.google.com/",
      last_touch: { landing_page: "https://folhatec-v3.vercel.app/", utm_source: "google", utm_medium: "cpc", referrer: null },
    }),
    now,
  );
}

type Call = { url: string; init: RequestInit };
function fakeFetch(response: () => Response | Promise<Response>, calls: Call[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test.describe("Configuração do e-mail", () => {
  test("sem variáveis: e-mail ausente", () => {
    expect(readEmailConfig({})).toEqual({ state: "absent" });
    // Só o destinatário (que já tem padrão) não ativa nem quebra o envio.
    expect(readEmailConfig({ QUOTE_EMAIL_TO: "folhatec@folhatec.com.br" })).toEqual({ state: "absent" });
  });

  test("destinatário padrão é folhatec@folhatec.com.br", () => {
    expect(DEFAULT_QUOTE_RECIPIENT).toBe("folhatec@folhatec.com.br");
    expect(readEmailConfig(EMAIL_ENV)).toEqual({ state: "ready", config: CONFIG });
  });

  test("QUOTE_EMAIL_TO sobrescreve o destinatário", () => {
    const result = readEmailConfig({ ...EMAIL_ENV, QUOTE_EMAIL_TO: "comercial@folhatec.com.br" });
    expect(result.state === "ready" && result.config.to).toBe("comercial@folhatec.com.br");
  });

  test("configuração parcial ou inválida é marcada como inválida", () => {
    expect(readEmailConfig({ RESEND_API_KEY: "re_x" })).toEqual({ state: "invalid" });
    expect(readEmailConfig({ QUOTE_EMAIL_FROM: "site@folhatec.com.br" })).toEqual({ state: "invalid" });
    expect(readEmailConfig({ ...EMAIL_ENV, QUOTE_EMAIL_FROM: "não é e-mail" })).toEqual({ state: "invalid" });
    expect(readEmailConfig({ ...EMAIL_ENV, QUOTE_EMAIL_TO: "inválido" })).toEqual({ state: "invalid" });
  });
});

test.describe("Conteúdo do e-mail", () => {
  test("assunto, remetente autenticado, destinatário e Reply-To do solicitante", () => {
    const email = buildQuoteEmail(makeLead(), LABELS, CONFIG);
    expect(email.subject).toBe(QUOTE_EMAIL_SUBJECT);
    expect(email.subject).toBe("Nova solicitação de cotação | FolhaTec");
    expect(email.from).toBe(CONFIG.from);
    expect(email.to).toEqual(["folhatec@folhatec.com.br"]);
    expect(email.reply_to).toBe("maria@example.com");
  });

  test("contém todos os campos preenchidos, legíveis em HTML e texto", () => {
    const email = buildQuoteEmail(makeLead(), LABELS, CONFIG);
    for (const body of [email.html, email.text]) {
      expect(body).toContain("Maria Teste");
      expect(body).toContain("Indústria Exemplo");
      expect(body).toContain("maria@example.com");
      expect(body).toContain("(47) 99999-0000");
      expect(body).toContain("Etiquetas");
      expect(body).toContain("Criogenia");
      expect(body).toContain("Preciso de etiquetas para tubos.");
      expect(body).toContain("28/10/2026 10:45 (horário de Brasília)");
      expect(body).toContain("https://folhatec-v3.vercel.app/solicitar-cotacao?solucao=etiquetas");
      expect(body).toContain("utm_source=google");
    }
  });

  test("campos opcionais vazios não aparecem", () => {
    const email = buildQuoteEmail(makeLead({ company: null, solution: null, segment: null, message: null }), { solution: null, segment: null }, CONFIG);
    expect(email.text).not.toContain("Empresa:");
    expect(email.text).not.toContain("Solução de interesse:");
    expect(email.text).not.toContain("Segmento:");
    expect(email.text).toContain("Mensagem: (não informada)");
  });

  test("conteúdo do visitante é escapado no HTML", () => {
    const email = buildQuoteEmail(makeLead({ name: '<script>alert("x")</script>', message: "<b>oi</b> & tchau" }), LABELS, CONFIG);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>oi</b>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; tchau");
  });
});

test.describe("Envio ao Resend (provedor simulado)", () => {
  test("requisição: endpoint, autenticação, idempotência e corpo", async () => {
    const calls: Call[] = [];
    const result = await sendQuoteEmail(makeLead(), LABELS, CONFIG, fakeFetch(() => json(200, { id: "abc-123" }), calls));
    expect(result).toEqual({ status: "delivered", id: "abc-123" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(RESEND_API_URL);
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_fake");
    expect(headers["idempotency-key"]).toMatch(/^folhatec-quote-[0-9a-f]{40}$/);
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body.to).toEqual(["folhatec@folhatec.com.br"]);
    expect(body.reply_to).toBe("maria@example.com");
    expect(body.subject).toBe(QUOTE_EMAIL_SUBJECT);
  });

  for (const status of [400, 401, 403, 422, 429, 500, 503]) {
    test(`recusa do provedor (HTTP ${status}) → falha, nunca sucesso`, async () => {
      const result = await sendQuoteEmail(makeLead(), LABELS, CONFIG, fakeFetch(() => json(status, { name: "validation_error", message: "x" })));
      expect(result).toEqual({ status: "failed", reason: "http_error", httpStatus: status });
    });
  }

  test("timeout e erro de rede → falha", async () => {
    const timeout = await sendQuoteEmail(makeLead(), LABELS, CONFIG, fakeFetch(() => Promise.reject(new DOMException("t", "TimeoutError"))));
    expect(timeout).toEqual({ status: "failed", reason: "timeout" });
    const network = await sendQuoteEmail(makeLead(), LABELS, CONFIG, fakeFetch(() => Promise.reject(new TypeError("fetch failed"))));
    expect(network).toEqual({ status: "failed", reason: "network_error" });
  });

  test("logs de falha não contêm dados pessoais", async () => {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => logged.push(args.join(" "));
    try {
      await sendQuoteEmail(makeLead(), LABELS, CONFIG, fakeFetch(() => json(403, { name: "validation_error", message: "maria@example.com" })));
    } finally {
      console.error = original;
    }
    expect(logged.join("\n")).toContain("HTTP 403 (validation_error)");
    expect(logged.join("\n")).not.toMatch(/maria|99999|Indústria Exemplo/);
  });

  test("idempotência: mesmo conteúdo no mesmo minuto → mesma chave", () => {
    const a = quoteIdempotencyKey(makeLead({}, new Date("2026-10-28T13:45:01Z")));
    const b = quoteIdempotencyKey(makeLead({}, new Date("2026-10-28T13:45:59Z")));
    const otherMinute = quoteIdempotencyKey(makeLead({}, new Date("2026-10-28T13:46:00Z")));
    const otherMessage = quoteIdempotencyKey(makeLead({ message: "Outra" }, new Date("2026-10-28T13:45:01Z")));
    expect(a).toBe(b);
    expect(a).not.toBe(otherMinute);
    expect(a).not.toBe(otherMessage);
  });
});

test.describe("Escolha do canal de entrega", () => {
  test("sem canal: stub fora de produção, erro em produção", async () => {
    expect(await deliverQuote(makeLead(), LABELS, { env: {}, siteEnv: "staging" })).toEqual({ status: "stub" });
    expect(await deliverQuote(makeLead(), LABELS, { env: {}, siteEnv: "production" })).toEqual({ status: "not_configured" });
  });

  test("configuração incorreta nunca vira stub silencioso (nem em homologação)", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch(() => json(200, { id: "1" }), calls);
    for (const env of [
      { RESEND_API_KEY: "re_x" },
      { QUOTE_EMAIL_FROM: "Site FolhaTec <site@folhatec.com.br>" },
      { ...EMAIL_ENV, QUOTE_EMAIL_FROM: "site arroba folhatec" },
      { QUOTE_WEBHOOK_URL: "não é url" },
    ]) {
      expect(await deliverQuote(makeLead(), LABELS, { env, siteEnv: "staging", fetchImpl })).toEqual({ status: "not_configured" });
    }
    expect(calls).toHaveLength(0);
  });

  test("webhook opcional inválido não bloqueia o e-mail válido", async () => {
    const calls: Call[] = [];
    const result = await deliverQuote(makeLead(), LABELS, {
      env: { ...EMAIL_ENV, QUOTE_WEBHOOK_URL: "não é url" },
      siteEnv: "staging",
      fetchImpl: fakeFetch(() => json(200, { id: "1" }), calls),
    });
    expect(result).toEqual({ status: "delivered" });
    expect(calls.map((call) => call.url)).toEqual([RESEND_API_URL]);
  });

  test("e-mail configurado: envia ao Resend e confirma só após o aceite", async () => {
    const calls: Call[] = [];
    const ok = await deliverQuote(makeLead(), LABELS, { env: EMAIL_ENV, siteEnv: "staging", fetchImpl: fakeFetch(() => json(200, { id: "1" }), calls) });
    expect(ok).toEqual({ status: "delivered" });
    expect(calls.map((call) => call.url)).toEqual([RESEND_API_URL]);

    const failed = await deliverQuote(makeLead(), LABELS, { env: EMAIL_ENV, siteEnv: "production", fetchImpl: fakeFetch(() => json(500, {})) });
    expect(failed.status).toBe("failed");
  });

  test("webhook sozinho continua funcionando como antes", async () => {
    const calls: Call[] = [];
    const result = await deliverQuote(makeLead(), LABELS, {
      env: { QUOTE_WEBHOOK_URL: "https://hooks.example.com/lead" },
      siteEnv: "production",
      fetchImpl: fakeFetch(() => new Response(null, { status: 204 }), calls),
    });
    expect(result).toEqual({ status: "delivered" });
    expect(calls.map((call) => call.url)).toEqual(["https://hooks.example.com/lead"]);
  });

  test("e-mail + webhook: e-mail decide o resultado", async () => {
    const env = { ...EMAIL_ENV, QUOTE_WEBHOOK_URL: "https://hooks.example.com/lead" };
    const byUrl = (emailStatus: number, hookStatus: number) =>
      (async (url: string | URL | Request) =>
        String(url) === RESEND_API_URL ? json(emailStatus, { id: "1" }) : new Response(null, { status: hookStatus })) as typeof fetch;
    expect(await deliverQuote(makeLead(), LABELS, { env, siteEnv: "staging", fetchImpl: byUrl(200, 500) })).toEqual({ status: "delivered" });
    expect((await deliverQuote(makeLead(), LABELS, { env, siteEnv: "staging", fetchImpl: byUrl(503, 204) })).status).toBe("failed");
  });
});
