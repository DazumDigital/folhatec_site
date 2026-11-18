/**
 * Servidor SMTP simulado para os testes (sem TLS, sem rede externa).
 * Fala o suficiente do protocolo para o Nodemailer: EHLO, AUTH PLAIN/LOGIN,
 * MAIL FROM, RCPT TO, DATA, RSET, QUIT. Nenhuma mensagem sai da máquina.
 */
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

export type FakeSmtpMode = "accept" | "auth-fail" | "reject-rcpt" | "reject-data" | "silent";

export interface FakeSmtpMessage {
  authUser: string | null;
  mailFrom: string;
  rcptTo: string[];
  data: string;
}

export interface FakeSmtp {
  port: number;
  messages: FakeSmtpMessage[];
  connections: number;
  close(): Promise<void>;
}

const b64 = (value: string) => Buffer.from(value, "base64").toString("utf8");

export async function startFakeSmtp(options: { mode?: FakeSmtpMode; user?: string; password?: string } = {}): Promise<FakeSmtp> {
  const mode = options.mode ?? "accept";
  const user = options.user ?? "folhatec@folhatec.com.br";
  const password = options.password ?? "senha-de-teste";
  const messages: FakeSmtpMessage[] = [];
  const sockets = new Set<Socket>();
  const state = { connections: 0 };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    state.connections += 1;
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (mode === "silent") return; // nunca envia o 220 → timeout no cliente

    const write = (line: string) => socket.write(`${line}\r\n`);
    let buffer = "";
    let inData = false;
    let dataLines: string[] = [];
    let authStep: "none" | "login-user" | "login-pass" = "none";
    let loginUser = "";
    let authUser: string | null = null;
    let current: { mailFrom: string; rcptTo: string[] } = { mailFrom: "", rcptTo: [] };

    const checkAuth = (u: string, p: string) => {
      if (mode === "auth-fail" || u !== user || p !== password) return write("535 5.7.8 Authentication failed");
      authUser = u;
      write("235 2.7.0 Authentication successful");
    };

    const handle = (line: string) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          if (mode === "reject-data") return write("554 5.7.1 Message rejected");
          messages.push({ authUser, mailFrom: current.mailFrom, rcptTo: current.rcptTo, data: dataLines.join("\r\n") });
          dataLines = [];
          return write("250 2.0.0 OK queued");
        }
        dataLines.push(line.startsWith("..") ? line.slice(1) : line);
        return;
      }
      if (authStep === "login-user") {
        loginUser = b64(line);
        authStep = "login-pass";
        return write("334 UGFzc3dvcmQ6");
      }
      if (authStep === "login-pass") {
        authStep = "none";
        return checkAuth(loginUser, b64(line));
      }
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        return socket.write("250-fake.smtp.local\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n");
      }
      if (upper.startsWith("AUTH PLAIN")) {
        const [, , token] = line.split(" ");
        const [, u = "", p = ""] = b64(token ?? "").split("\u0000");
        return checkAuth(u, p);
      }
      if (upper.startsWith("AUTH LOGIN")) {
        const initial = line.split(" ")[2];
        if (initial) {
          loginUser = b64(initial);
          authStep = "login-pass";
          return write("334 UGFzc3dvcmQ6");
        }
        authStep = "login-user";
        return write("334 VXNlcm5hbWU6");
      }
      if (upper.startsWith("MAIL FROM:")) {
        if (!authUser) return write("530 5.7.0 Authentication required");
        current = { mailFrom: /<([^>]*)>/.exec(line)?.[1] ?? "", rcptTo: [] };
        return write("250 2.1.0 OK");
      }
      if (upper.startsWith("RCPT TO:")) {
        if (mode === "reject-rcpt") return write("550 5.1.1 Mailbox unavailable");
        current.rcptTo.push(/<([^>]*)>/.exec(line)?.[1] ?? "");
        return write("250 2.1.5 OK");
      }
      if (upper === "DATA") {
        inData = true;
        return write("354 End data with <CR><LF>.<CR><LF>");
      }
      if (upper === "RSET" || upper === "NOOP") return write("250 2.0.0 OK");
      if (upper === "QUIT") {
        write("221 2.0.0 Bye");
        return socket.end();
      }
      write("502 5.5.2 Command not implemented");
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\r\n");
      while (index >= 0) {
        handle(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\r\n");
      }
    });
    write("220 fake.smtp.local ESMTP pronto");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    get connections() {
      return state.connections;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Porta local livre e fechada (para simular conexão recusada). */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
