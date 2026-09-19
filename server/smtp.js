"use strict";

const net = require("net");
const tls = require("tls");

const CONNECT_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 15000;
const OVERALL_TIMEOUT_MS = 60000;
const MAX_LINE_LENGTH = 998;

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "::ffff:127.0.0.1";
}

function encodedWord(value) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function foldLine(line) {
  const chunks = [];
  let remaining = line;
  while (Buffer.byteLength(remaining, "utf8") > MAX_LINE_LENGTH) {
    let cut = MAX_LINE_LENGTH;
    while (cut > 0 && (remaining.charCodeAt(cut) & 0xfc00) === 0xdc00) cut -= 1;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  chunks.push(remaining);
  return chunks.join("\r\n ");
}

function normalizeBody(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  return lines.map((line) => (line.startsWith(".") ? `.${line}` : line)).map(foldLine).join("\r\n");
}

class SmtpConnection {
  constructor(options) {
    this.options = options;
    this.socket = null;
    this.secured = false;
    this.buffer = "";
    this.pending = null;
    this.ehloFeatures = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const { host, port, secure } = this.options;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const onConnect = () => {
        if (settled) return;
        this.socket.setTimeout(COMMAND_TIMEOUT_MS, () => fail(new Error("smtp_timeout")));
        this.socket.on("data", (chunk) => this.onData(chunk));
        this.socket.on("error", (error) => fail(error));
        this.socket.on("close", () => fail(new Error("smtp_connection_closed")));
        resolve();
      };
      try {
        if (secure) {
          this.secured = true;
          this.socket = tls.connect(
            { host, port, servername: host, rejectUnauthorized: true },
            onConnect
          );
          this.socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error("smtp_timeout")));
          this.socket.on("error", (error) => fail(error));
        } else {
          this.socket = net.connect({ host, port }, onConnect);
          this.socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(new Error("smtp_timeout")));
          this.socket.on("error", (error) => fail(error));
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString("utf8");
    this.processBuffer();
  }

  processBuffer() {
    if (!this.pending) return;
    const { acceptedCodes, resolve, reject } = this.pending;
    while (true) {
      const end = this.buffer.indexOf("\r\n");
      if (end === -1) return;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      if (line.length < 3) continue;
      const code = line.slice(0, 3);
      const isContinuation = line[3] === "-";
      if (isContinuation) {
        if (code.startsWith("250") && line.length > 4) {
          const feature = line.slice(4).trim().toUpperCase().split(" ")[0];
          if (feature) this.ehloFeatures.add(feature);
        }
        continue;
      }
      if (acceptedCodes.includes(code)) {
        this.pending = null;
        resolve(line);
        return;
      }
      this.pending = null;
      reject(Object.assign(new Error(`smtp_unexpected_response: ${line}`), { response: line }));
      return;
    }
  }

  expect(acceptedCodes) {
    return new Promise((resolve, reject) => {
      this.pending = { acceptedCodes, resolve, reject };
      this.processBuffer();
    });
  }

  command(commandText, acceptedCodes = ["250"]) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error("smtp_connection_closed"));
        return;
      }
      this.pending = { acceptedCodes: Array.isArray(acceptedCodes) ? acceptedCodes : [acceptedCodes], resolve, reject };
      this.socket.write(`${commandText}\r\n`);
    });
  }

  write(message) {
    if (!this.socket || this.socket.destroyed) throw new Error("smtp_connection_closed");
    this.socket.write(message);
  }

  async ehlo() {
    await this.command("EHLO bp-learning.local");
  }

  async upgradeToTlsIfNeeded() {
    if (this.secured || !this.ehloFeatures.has("STARTTLS")) return;
    if (isLoopback(this.options.host)) return;
    await this.upgradeToTls();
  }

  upgradeToTls() {
    return new Promise((resolve, reject) => {
      const raw = this.socket;
      raw.removeAllListeners("data");
      this.pending = null;
      this.buffer = "";
      raw.once("data", (chunk) => {
        this.buffer += chunk.toString("utf8");
        const end = this.buffer.indexOf("\r\n");
        if (end === -1) {
          reject(new Error("smtp_starttls_failed"));
          return;
        }
        const line = this.buffer.slice(0, end);
        if (line.slice(0, 3) !== "220") {
          reject(Object.assign(new Error(`smtp_starttls_refused: ${line}`), { response: line }));
          return;
        }
        const tlsSocket = tls.connect(
          { socket: raw, servername: this.options.host, rejectUnauthorized: true },
          () => {
            this.socket = tlsSocket;
            this.secured = true;
            this.buffer = "";
            this.ehloFeatures = new Set();
            tlsSocket.setTimeout(COMMAND_TIMEOUT_MS, () => reject(new Error("smtp_timeout")));
            tlsSocket.on("data", (chunk) => this.onData(chunk));
            tlsSocket.on("error", (error) => reject(error));
            tlsSocket.on("close", () => reject(new Error("smtp_connection_closed")));
            resolve();
          }
        );
        tlsSocket.on("error", (error) => reject(error));
      });
      this.socket.write("STARTTLS\r\n");
    });
  }

  async authenticate() {
    if (!this.options.user) return;
    const credentials = Buffer.from(
      `\u0000${this.options.user}\u0000${this.options.password || ""}`,
      "utf8"
    ).toString("base64");
    const response = await this.command("AUTH PLAIN", ["235", "334"]);
    if (response.slice(0, 3) === "334") {
      await this.command(credentials, ["235"]);
    }
  }

  async send(fromEmail, to, headers, body) {
    await this.command(`MAIL FROM:<${fromEmail}>`);
    for (const recipient of to) {
      await this.command(`RCPT TO:<${recipient}>`);
    }
    await this.command("DATA", ["354"]);
    const message = `${headers.join("\r\n")}\r\n\r\n${normalizeBody(body)}`;
    this.write(`${message}\r\n.\r\n`);
    await this.expect(["250"]);
  }

  quit() {
    try {
      this.socket.write("QUIT\r\n");
    } catch { /* closing anyway */ }
    this.socket.end();
  }
}

async function sendMailSmtp(options) {
  const {
    host,
    port,
    secure = false,
    user = "",
    password = "",
    fromName = "",
    fromEmail,
    to,
    subject,
    text,
  } = options;
  if (!host || !port) return { delivered: false, reason: "transport_not_configured" };
  if (!fromEmail || !Array.isArray(to) || !to.length) {
    return { delivered: false, reason: "invalid_recipients" };
  }

  const connection = new SmtpConnection({ host, port, secure, user, password });
  const overallTimer = setTimeout(() => {
    try { connection.socket && connection.socket.destroy(); } catch { /* already closed */ }
  }, OVERALL_TIMEOUT_MS);

  try {
    await connection.connect();
    await connection.expect(["220"]);
    await connection.ehlo();
    await connection.upgradeToTlsIfNeeded();
    if (connection.secured || isLoopback(host)) {
      await connection.authenticate();
    } else if (user) {
      return { delivered: false, reason: "tls_required" };
    }
    const subjectHeader = encodedWord(subject || "");
    const fromHeader = fromName ? `${encodedWord(fromName)} <${fromEmail}>` : fromEmail;
    const headers = [
      `From: ${fromHeader}`,
      `To: ${to.join(", ")}`,
      `Subject: ${subjectHeader}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: 8bit",
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(16).slice(2)}@bp-learning>`,
    ];
    await connection.send(fromEmail, to, headers, text || "");
    return { delivered: true, transport: "smtp" };
  } catch (error) {
    console.error(`[smtp] delivery failed: ${error.message}`);
    return { delivered: false, reason: "delivery_failed" };
  } finally {
    clearTimeout(overallTimer);
    connection.quit();
  }
}

module.exports = { sendMailSmtp };
