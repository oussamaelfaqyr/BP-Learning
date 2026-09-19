"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const net = require("net");

let smtpServer = null;
const openServers = [];

function startFakeSmtp() {
  return new Promise((resolve) => {
    const state = { messages: [], commands: [] };
    const server = net.createServer((socket) => {
      let buffer = "";
      let inData = false;
      socket.write("220 fake-smtp ESMTP ready\r\n");
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (inData) {
          const endIndex = buffer.indexOf("\r\n.\r\n");
          if (endIndex === -1) return;
          const message = buffer.slice(0, endIndex);
          state.messages.push(message);
          state.commands.push(message);
          buffer = buffer.slice(endIndex + 5);
          inData = false;
          socket.write("250 2.0.0 queued\r\n");
          return;
        }
        let end;
        while ((end = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          state.commands.push(line);
          const upper = line.toUpperCase();
          if (upper.startsWith("EHLO")) {
            socket.write("250-fake-smtp\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
          } else if (upper.startsWith("AUTH PLAIN")) {
            socket.write("334 \r\n");
          } else if (upper.startsWith("MAIL FROM")) {
            socket.write("250 2.1.0 ok\r\n");
          } else if (upper.startsWith("RCPT TO")) {
            socket.write("250 2.1.5 ok\r\n");
          } else if (upper.startsWith("DATA")) {
            socket.write("354 go ahead\r\n");
            inData = true;
          } else if (upper.startsWith("QUIT")) {
            socket.write("221 bye\r\n");
            socket.end();
          } else if (line.trim() === ".") {
            /* handled by inData branch above */
          } else {
            socket.write("235 2.7.0 ok\r\n");
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      smtpServer = server;
      openServers.push(server);
      resolve({ server, state, port: server.address().port });
    });
  });
}

after(() => {
  for (const server of openServers) {
    try { server.close(); } catch { /* already closed */ }
  }
});

test("smtp client delivers a message with UTF-8 headers and dot-stuffing", async () => {
  const { state, port } = await startFakeSmtp();
  process.env.EMAIL_TRANSPORT = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_USER = "sender@bp.local";
  process.env.SMTP_PASSWORD = "secret-app-password";
  process.env.SMTP_FROM_NAME = "BP Learning";
  process.env.EMAIL_FROM = "sender@bp.local";

  const { sendResetPasswordEmail } = require("../server/email");
  const result = await sendResetPasswordEmail({
    to: "user@example.com",
    firstName: "Sara",
    resetUrl: "http://127.0.0.1:8089/#/reset-password?token=abc",
  });

  assert.equal(result.delivered, true);
  assert.equal(result.transport, "smtp");
  assert.equal(state.messages.length, 1);

  const message = state.messages[0];
  assert.match(message, /From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <sender@bp\.local>/);
  assert.match(message, /To: user@example\.com/);
  assert.match(message, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.match(message, /http:\/\/127\.0\.0\.1:8089\/#\/reset-password\?token=abc/);

  const authLine = state.commands.find((line) => line.startsWith("AUTH PLAIN"));
  assert.ok(authLine, "client must authenticate");
  const credentialsLine = state.commands[state.commands.indexOf(authLine) + 1];
  assert.equal(
    Buffer.from(credentialsLine, "base64").toString("utf8"),
    "\u0000sender@bp.local\u0000secret-app-password"
  );
});

test("smtp client dot-stuffs lines starting with a dot", async () => {
  const { state, port } = await startFakeSmtp();
  process.env.SMTP_PORT = String(port);

  const { sendAdminMessageEmail } = require("../server/email");
  const result = await sendAdminMessageEmail({
    to: "user@example.com",
    firstName: "Sara",
    subject: "Point sécurité",
    text: ".début de ligne\nligne normale",
  });

  assert.equal(result.delivered, true);
  const message = state.messages[0];
  assert.match(message, /\r\n\.\.début de ligne/);
  assert.doesNotMatch(message, /\r\n\.début de ligne/);
});

test("smtp transport reports failure on a closed server", async () => {
  const { server, port } = await startFakeSmtp();
  const closed = new Promise((resolve) => server.close(resolve));
  await closed;
  smtpServer = null;
  process.env.SMTP_PORT = String(port);

  const { sendResetPasswordEmail } = require("../server/email");
  const result = await sendResetPasswordEmail({
    to: "user@example.com",
    firstName: "Sara",
    resetUrl: "http://example.com/#/reset?token=abc",
  });
  assert.equal(result.delivered, false);
});
