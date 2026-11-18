/**
 * Testes unitários (sem navegador) do envio das solicitações por SMTP
 * (E-mail Locaweb) e da escolha do canal de entrega. O SMTP é um servidor
 * simulado local (fake-smtp.ts) — nenhuma mensagem real é enviada.
 */
import { expect, test } from "@playwright/test";
import { sanitizeAttribution } from "../../src/features/quote/attribution";
import {
  allowedDeliveryHosts,
  buildLead,
  deliverQuote,
  hasDeliveryChannel,
  resetDeliveryMemory,
} from "../../src/features/quote/server/deliver";
import {
  DEFAULT_QUOTE_RECIPIENT,
  QUOTE_EMAIL_SUBJECT,
  buildQuoteEmail,
  classifySmtpError,
  readSmtpConfig,
  sendQuoteEmail,
  type SmtpConfig,
  type SmtpTestOverrides,
} from "../../src/features/quote/server/email";
import { createMemoryRateLimiter, getRateLimiter } from "../../src/features/quote/server/rate-limit";
import { closedPort, startFakeSmtp, type FakeSmtpMode } from "./fake-smtp";

const USER = "folhatec@folhatec.com.br";
const PASSWORD = "senha-de-teste";
const LABELS = { solution: "Etiquetas", segment: "Criogenia" };
/** Servidor simulado não usa TLS; produção usa SSL direto na porta 465. */
const TEST_TRANSPORT: SmtpTestOverrides = { ignoreTLS: true, requireTLS: false, connectionTimeout: 2000, greetingTimeout: 2000, socketTimeout: 3000 };
const LOCAWEB_ENV = { SMTP_HOST: "email-ssl.com.br", SMTP_USER: USER, SMTP_PASSWORD: PASSWORD };

function makeLead(overrides: Partial<Parameters<typeof buildLead>[0]> = {}, now = new Date("2026-11-18T13:45:30.000Z")) {
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
      origin_url: "https://www.folhatec.com.br/?utm_source=google",
      conversion_page: "https://www.folhatec.com.br/solicitar-cotacao?solucao=etiquetas&segmento=criogenia",
      referrer: "https://www.google.com/",
      last_touch: { landing_page: "https://www.folhatec.com.br/", utm_source: "google", utm_medium: "cpc", referrer: null },
    }),
    now,
  );
}

const smtpEnv = (port: number) => ({
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: String(port),
  SMTP_SECURE: "false",
  SMTP_USER: USER,
  SMTP_PASSWORD: PASSWORD,
});

function smtpConfig(port: number): SmtpConfig {
  const result = readSmtpConfig(smtpEnv(port));
  if (result.state !== "ready") throw new Error("config de teste inválida");
  return result.config;
}

async function withSmtp<T>(mode: FakeSmtpMode, run: (server: Awaited<ReturnType<typeof startFakeSmtp>>) => Promise<T>) {
  const server = await startFakeSmtp({ mode, user: USER, password: PASSWORD });
  try {
    return await run(server);
  } finally {
    await server.close();
  }
}

/** Cabeçalhos da mensagem (antes da 1ª linha em branco), com linhas dobradas unidas. */
function headersOf(data: string): string {
  return (data.split("\r\n\r\n")[0] ?? "").replace(/\r\n[ \t]+/g, " ");
}

function captureConsole() {
  const lines: string[] = [];
  const original = { error: console.error, info: console.info, warn: console.warn };
  for (const level of ["error", "info", "warn"] as const) console[level] = (...args: unknown[]) => lines.push(args.join(" "));
  return {
    lines,
    restore: () => Object.assign(console, original),
  };
}

test.beforeEach(() => resetDeliveryMemory());

test.describe("Configuração SMTP", () => {
  test("sem variáveis: SMTP ausente", () => {
    expect(readSmtpConfig({})).toEqual({ state: "absent" });
    // Remetente/destinatário sozinhos não ativam nem quebram o envio.
    expect(readSmtpConfig({ QUOTE_EMAIL_FROM: `FolhaTec - Site <${USER}>`, QUOTE_EMAIL_TO: USER })).toEqual({ state: "absent" });
  });

  test("Locaweb: padrões porta 465 / SSL / remetente e destinatário folhatec@folhatec.com.br", () => {
    expect(DEFAULT_QUOTE_RECIPIENT).toBe("folhatec@folhatec.com.br");
    expect(readSmtpConfig(LOCAWEB_ENV)).toEqual({
      state: "ready",
      config: {
        host: "email-ssl.com.br",
        port: 465,
        secure: true,
        user: USER,
        password: PASSWORD,
        from: `FolhaTec - Site <${USER}>`,
        to: USER,
      },
    });
  });

  test("variáveis completas como na Vercel", () => {
    const result = readSmtpConfig({
      ...LOCAWEB_ENV,
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      QUOTE_EMAIL_FROM: `FolhaTec - Site <${USER}>`,
      QUOTE_EMAIL_TO: USER,
    });
    expect(result.state).toBe("ready");
    expect(result.state === "ready" && [result.config.port, result.config.secure, result.config.from, result.config.to]).toEqual([
      465,
      true,
      `FolhaTec - Site <${USER}>`,
      USER,
    ]);
  });

  test("configuração incompleta ou inconsistente é inválida", () => {
    const cases = [
      { SMTP_HOST: "email-ssl.com.br" },
      { SMTP_USER: USER, SMTP_PASSWORD: PASSWORD },
      { ...LOCAWEB_ENV, SMTP_PASSWORD: "" },
      { ...LOCAWEB_ENV, SMTP_PORT: "abc" },
      { ...LOCAWEB_ENV, SMTP_SECURE: "talvez" },
      { ...LOCAWEB_ENV, SMTP_USER: "não é e-mail" },
      // Remetente diferente da conta autenticada (ex.: e-mail do visitante).
      { ...LOCAWEB_ENV, QUOTE_EMAIL_FROM: "Visitante <maria@example.com>" },
      { ...LOCAWEB_ENV, QUOTE_EMAIL_TO: "inválido" },
    ];
    const log = captureConsole();
    try {
      for (const env of cases) expect(readSmtpConfig(env), JSON.stringify(Object.keys(env))).toEqual({ state: "invalid" });
    } finally {
      log.restore();
    }
    expect(log.lines.join("\n")).not.toContain(PASSWORD);
  });

  test("hasDeliveryChannel só com SMTP/webhook (válido ou não)", () => {
    expect(hasDeliveryChannel({})).toBe(false);
    expect(hasDeliveryChannel({ QUOTE_EMAIL_TO: USER })).toBe(false);
    const log = captureConsole();
    try {
      expect(hasDeliveryChannel(LOCAWEB_ENV)).toBe(true);
      expect(hasDeliveryChannel({ SMTP_HOST: "email-ssl.com.br" })).toBe(true);
    } finally {
      log.restore();
    }
  });
});

test.describe("Conteúdo do e-mail", () => {
  const config = { from: `FolhaTec - Site <${USER}>`, to: USER, user: USER };

  test("assunto, remetente, destinatário, Reply-To e Message-ID", () => {
    const email = buildQuoteEmail(makeLead(), LABELS, config);
    expect(email.subject).toBe("Nova solicitação de cotação | Site FolhaTec");
    expect(email.subject).toBe(QUOTE_EMAIL_SUBJECT);
    expect(email.from).toBe("FolhaTec - Site <folhatec@folhatec.com.br>");
    expect(email.to).toBe("folhatec@folhatec.com.br");
    expect(email.replyTo).toBe("maria@example.com");
    expect(email.messageId).toMatch(/^<cotacao-[0-9a-f]{40}@folhatec\.com\.br>$/);
  });

  test("contém todos os campos preenchidos, em HTML e texto", () => {
    const email = buildQuoteEmail(makeLead(), LABELS, config);
    for (const body of [email.html, email.text]) {
      expect(body).toContain("Maria Teste");
      expect(body).toContain("Indústria Exemplo");
      expect(body).toContain("maria@example.com");
      expect(body).toContain("(47) 99999-0000");
      expect(body).toContain("Etiquetas");
      expect(body).toContain("Criogenia");
      expect(body).toContain("Preciso de etiquetas para tubos.");
      expect(body).toContain("18/11/2026 10:45 (horário de Brasília)");
      expect(body).toContain("https://www.folhatec.com.br/solicitar-cotacao?solucao=etiquetas");
      expect(body).toContain("utm_source=google");
      expect(body).toContain("Aceite da Política de Privacidade registrado");
    }
  });

  test("campos opcionais vazios não aparecem", () => {
    const email = buildQuoteEmail(makeLead({ company: null, solution: null, segment: null, message: null }), { solution: null, segment: null }, config);
    expect(email.text).not.toContain("Empresa:");
    expect(email.text).not.toContain("Solução de interesse:");
    expect(email.text).not.toContain("Segmento:");
    expect(email.text).toContain("Mensagem: (não informada)");
  });

  test("HTML malicioso é escapado", () => {
    const email = buildQuoteEmail(makeLead({ name: '<script>alert("x")</script>', message: "<b>oi</b> & <img src=x onerror=1>" }), LABELS, config);
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>oi</b>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; &lt;img");
  });

  test("Message-ID estável: mesmo conteúdo no mesmo minuto", () => {
    const a = buildQuoteEmail(makeLead({}, new Date("2026-11-18T13:45:01Z")), LABELS, config).messageId;
    const b = buildQuoteEmail(makeLead({}, new Date("2026-11-18T13:45:59Z")), LABELS, config).messageId;
    const other = buildQuoteEmail(makeLead({ message: "Outra" }, new Date("2026-11-18T13:45:01Z")), LABELS, config).messageId;
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });
});

test.describe("Envio SMTP (servidor simulado)", () => {
  test("aceito: autentica, remetente/destinatário/Reply-To corretos", async () => {
    await withSmtp("accept", async (server) => {
      const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), TEST_TRANSPORT);
      expect(result.status).toBe("delivered");
      expect(server.messages).toHaveLength(1);
      const message = server.messages[0]!;
      expect(message.authUser).toBe(USER);
      expect(message.mailFrom).toBe(USER);
      expect(message.rcptTo).toEqual([USER]);
      const headers = headersOf(message.data);
      expect(headers).toMatch(/^From: "?FolhaTec - Site"? <folhatec@folhatec\.com\.br>$/m);
      expect(headers).toMatch(/^To: folhatec@folhatec\.com\.br$/m);
      expect(headers).toMatch(/^Reply-To: maria@example\.com$/m);
      expect(headers).toMatch(/^Message-ID: <cotacao-[0-9a-f]{40}@folhatec\.com\.br>$/m);
      // Assunto com acentos vai codificado (RFC 2047) e decodifica para o texto esperado.
      const subject = /^Subject: (.+)$/m.exec(headers)?.[1] ?? "";
      const decoded = subject
        .split(" ")
        .map((word) => /^=\?UTF-8\?Q\?(.*)\?=$/i.exec(word)?.[1] ?? null)
        .filter((word): word is string => word !== null)
        .map((word) => decodeURIComponent(word.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, "%$1")))
        .join("");
      expect(decoded || subject).toBe(QUOTE_EMAIL_SUBJECT);
      expect(message.data).not.toContain(PASSWORD);
    });
  });

  test("tentativa de injeção de cabeçalho não cria destinatários nem cabeçalhos", async () => {
    await withSmtp("accept", async (server) => {
      const lead = makeLead({ name: "Maria\r\nBcc: invasor@example.com", company: "X\nCc: outro@example.com" });
      const result = await sendQuoteEmail(lead, LABELS, smtpConfig(server.port), TEST_TRANSPORT);
      expect(result.status).toBe("delivered");
      const message = server.messages[0]!;
      expect(message.rcptTo).toEqual([USER]);
      // Nenhum cabeçalho Bcc/Cc; o texto digitado fica apenas no corpo.
      expect(headersOf(message.data)).not.toMatch(/^(Bcc|Cc):/im);
      expect(headersOf(message.data)).not.toContain("invasor@example.com");
    });
  });

  test("senha errada → falha de autenticação, sem vazar a senha nos logs", async () => {
    await withSmtp("auth-fail", async (server) => {
      const log = captureConsole();
      let result;
      try {
        result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), TEST_TRANSPORT);
      } finally {
        log.restore();
      }
      expect(result).toMatchObject({ status: "failed", reason: "auth" });
      expect(server.messages).toHaveLength(0);
      const text = log.lines.join("\n");
      expect(text).toContain("auth");
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toMatch(/maria|99999|Indústria Exemplo/);
    });
  });

  test("destinatário recusado → falha (rejected)", async () => {
    await withSmtp("reject-rcpt", async (server) => {
      const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), TEST_TRANSPORT);
      expect(result).toMatchObject({ status: "failed", reason: "rejected" });
    });
  });

  test("mensagem recusada no DATA → falha (rejected)", async () => {
    await withSmtp("reject-data", async (server) => {
      const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), TEST_TRANSPORT);
      expect(result).toMatchObject({ status: "failed", reason: "rejected" });
      expect(server.messages).toHaveLength(0);
    });
  });

  test("servidor mudo → timeout", async () => {
    await withSmtp("silent", async (server) => {
      const started = Date.now();
      const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), { ...TEST_TRANSPORT, greetingTimeout: 400 });
      expect(result).toMatchObject({ status: "failed", reason: "timeout" });
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });

  test("teto total do envio → timeout", async () => {
    await withSmtp("silent", async (server) => {
      const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(server.port), {
        ...TEST_TRANSPORT,
        greetingTimeout: 60000,
        deadlineMs: 400,
      });
      expect(result).toMatchObject({ status: "failed", reason: "timeout" });
    });
  });

  test("conexão recusada → erro de conexão", async () => {
    const port = await closedPort();
    const result = await sendQuoteEmail(makeLead(), LABELS, smtpConfig(port), TEST_TRANSPORT);
    expect(result).toMatchObject({ status: "failed", reason: "network_error" });
  });

  test("classificação de erros SMTP", () => {
    expect(classifySmtpError({ code: "EAUTH", responseCode: 535 }).reason).toBe("auth");
    expect(classifySmtpError({ code: "ETIMEDOUT" }).reason).toBe("timeout");
    expect(classifySmtpError({ code: "ECONNECTION" }).reason).toBe("network_error");
    expect(classifySmtpError({ code: "ESOCKET" }).reason).toBe("network_error");
    expect(classifySmtpError({ code: "EENVELOPE", responseCode: 550 }).reason).toBe("rejected");
    expect(classifySmtpError({ responseCode: 451 }).reason).toBe("rejected");
    expect(classifySmtpError(new Error("?")).reason).toBe("unknown");
  });
});

test.describe("Escolha do canal de entrega", () => {
  test("sem canal: stub fora de produção, erro em produção", async () => {
    expect(await deliverQuote(makeLead(), LABELS, { env: {}, siteEnv: "staging" })).toEqual({ status: "stub" });
    expect(await deliverQuote(makeLead(), LABELS, { env: {}, siteEnv: "production" })).toEqual({ status: "not_configured" });
  });

  test("configuração incorreta nunca vira stub silencioso (nem em homologação)", async () => {
    await withSmtp("accept", async (server) => {
      const log = captureConsole();
      try {
        for (const env of [
          { SMTP_HOST: "127.0.0.1" },
          { ...smtpEnv(server.port), SMTP_PASSWORD: "" },
          { ...smtpEnv(server.port), QUOTE_EMAIL_FROM: "Visitante <maria@example.com>" },
          { QUOTE_WEBHOOK_URL: "não é url" },
        ]) {
          expect(await deliverQuote(makeLead(), LABELS, { env, siteEnv: "staging", smtpOverrides: TEST_TRANSPORT })).toEqual({ status: "not_configured" });
        }
      } finally {
        log.restore();
      }
      expect(server.connections).toBe(0);
    });
  });

  test("SMTP configurado: entrega e confirma só após o aceite", async () => {
    await withSmtp("accept", async (server) => {
      const result = await deliverQuote(makeLead(), LABELS, { env: smtpEnv(server.port), siteEnv: "production", smtpOverrides: TEST_TRANSPORT });
      expect(result).toEqual({ status: "delivered" });
      expect(server.messages).toHaveLength(1);
    });
    await withSmtp("auth-fail", async (server) => {
      const result = await deliverQuote(makeLead({ message: "outra" }), LABELS, {
        env: smtpEnv(server.port),
        siteEnv: "production",
        smtpOverrides: TEST_TRANSPORT,
      });
      expect(result).toEqual({ status: "failed", reason: "auth" });
    });
  });

  test("hosts: envio real só no domínio oficial (www e sem www)", async () => {
    expect(allowedDeliveryHosts({}, "https://www.folhatec.com.br")).toEqual(["www.folhatec.com.br", "folhatec.com.br"]);
    expect(allowedDeliveryHosts({}, "https://folhatec.com.br")).toEqual(["folhatec.com.br", "www.folhatec.com.br"]);
    expect(allowedDeliveryHosts({ QUOTE_ALLOWED_HOSTS: " www.folhatec.com.br , folhatec.com.br " }, "https://folhatec-v3.vercel.app")).toEqual([
      "www.folhatec.com.br",
      "folhatec.com.br",
    ]);

    await withSmtp("accept", async (server) => {
      const options = { env: smtpEnv(server.port), siteEnv: "production", siteUrl: "https://www.folhatec.com.br", smtpOverrides: TEST_TRANSPORT };
      const log = captureConsole();
      try {
        expect(await deliverQuote(makeLead({ message: "a" }), LABELS, { ...options, host: "folhatec-v3.vercel.app" })).toEqual({ status: "stub" });
        expect(await deliverQuote(makeLead({ message: "b" }), LABELS, { ...options, host: null })).toEqual({ status: "stub" });
      } finally {
        log.restore();
      }
      expect(server.connections).toBe(0);
      expect(await deliverQuote(makeLead({ message: "c" }), LABELS, { ...options, host: "www.folhatec.com.br" })).toEqual({ status: "delivered" });
      expect(await deliverQuote(makeLead({ message: "d" }), LABELS, { ...options, host: "folhatec.com.br" })).toEqual({ status: "delivered" });
      expect(server.messages).toHaveLength(2);
    });
  });

  test("duplicidade: envios idênticos simultâneos ou repetidos geram um único e-mail", async () => {
    await withSmtp("accept", async (server) => {
      const options = { env: smtpEnv(server.port), siteEnv: "production", smtpOverrides: TEST_TRANSPORT };
      const lead = makeLead();
      const [a, b] = await Promise.all([deliverQuote(lead, LABELS, options), deliverQuote(lead, LABELS, options)]);
      expect([a, b]).toEqual([{ status: "delivered" }, { status: "delivered" }]);
      expect(await deliverQuote(makeLead({}, new Date("2026-11-18T13:45:50Z")), LABELS, options)).toEqual({ status: "delivered" });
      expect(server.messages).toHaveLength(1);
      // Conteúdo diferente é outra solicitação.
      expect(await deliverQuote(makeLead({ message: "Outra necessidade" }), LABELS, options)).toEqual({ status: "delivered" });
      expect(server.messages).toHaveLength(2);
    });
  });

  test("falha não é memorizada: nova tentativa pode entregar", async () => {
    const port = await closedPort();
    const lead = makeLead();
    expect((await deliverQuote(lead, LABELS, { env: smtpEnv(port), siteEnv: "production", smtpOverrides: TEST_TRANSPORT })).status).toBe("failed");
    await withSmtp("accept", async (server) => {
      expect(await deliverQuote(lead, LABELS, { env: smtpEnv(server.port), siteEnv: "production", smtpOverrides: TEST_TRANSPORT })).toEqual({
        status: "delivered",
      });
    });
  });

  test("webhook sozinho continua funcionando; com SMTP, o e-mail decide", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    expect(
      await deliverQuote(makeLead(), LABELS, { env: { QUOTE_WEBHOOK_URL: "https://hooks.example.com/lead" }, siteEnv: "production", fetchImpl }),
    ).toEqual({ status: "delivered" });
    expect(calls).toEqual(["https://hooks.example.com/lead"]);

    await withSmtp("auth-fail", async (server) => {
      const env = { ...smtpEnv(server.port), QUOTE_WEBHOOK_URL: "https://hooks.example.com/lead" };
      const result = await deliverQuote(makeLead({ message: "x" }), LABELS, { env, siteEnv: "production", fetchImpl, smtpOverrides: TEST_TRANSPORT });
      expect(result.status).toBe("failed");
    });
  });
});

test.describe("Limite de requisições", () => {
  test("por IP e global, com janela deslizante", async () => {
    let clock = 0;
    const limiter = createMemoryRateLimiter({ perKey: 2, global: 3, windowMs: 1000, now: () => clock });
    expect((await limiter.check("a")).allowed).toBe(true);
    expect((await limiter.check("a")).allowed).toBe(true);
    const blocked = await limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect((await limiter.check("b")).allowed).toBe(true);
    expect((await limiter.check("c")).allowed).toBe(false); // teto global
    clock = 1500;
    expect((await limiter.check("a")).allowed).toBe(true);
  });

  test("sem canal real configurado, não limita", async () => {
    const limiter = getRateLimiter(false);
    for (let i = 0; i < 20; i += 1) expect((await limiter.check("x")).allowed).toBe(true);
    expect(getRateLimiter(true).name).toBe("memory");
  });
});
