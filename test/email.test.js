"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  startTestServer,
  stopTestServer,
  makeClient,
  expectError,
  registerUser,
  registerAdmin,
  resetRateLimits,
  USER_PASSWORD,
} = require("./helpers");

let base;

before(async () => {
  const started = await startTestServer();
  base = started.baseUrl;
});

after(async () => {
  await stopTestServer();
});

function tokenFromUrl(url) {
  return new URL(url).hash.split("?")[1].split("=")[1];
}

test("registration sends verification info and marks the user unverified", async () => {
  resetRateLimits();
  const client = makeClient(base);
  const user = await registerUser(client, base);
  assert.equal(user.json.user.emailVerified, false);
  assert.equal(user.json.verification.sent, true);
  assert.ok(user.json.verification.devVerifyUrl, "devVerifyUrl must be present outside production");
});

test("verification link confirms the email exactly once", async () => {
  resetRateLimits();
  const client = makeClient(base);
  const user = await registerUser(client, base);
  const token = tokenFromUrl(user.json.verification.devVerifyUrl);

  const ok = await client.request("POST", "/api/auth/verify-email", { body: { token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.user.emailVerified, true);

  const me = await client.request("GET", "/api/me");
  assert.equal(me.json.user.emailVerified, true);

  const reuse = await client.request("POST", "/api/auth/verify-email", { body: { token } });
  expectError(reuse, "verification_invalid");
});

test("verification rejects malformed and unknown tokens", async () => {
  resetRateLimits();
  const client = makeClient(base);
  const bad = await client.request("POST", "/api/auth/verify-email", { body: { token: "abc" } });
  expectError(bad, "invalid_token");
  const unknown = await client.request("POST", "/api/auth/verify-email", {
    body: { token: "f".repeat(64) },
  });
  expectError(unknown, "verification_invalid");
});

test("resend-verification returns 202 and does not leak account existence", async () => {
  resetRateLimits();
  const client = makeClient(base);
  const user = await registerUser(client, base);
  const resend = await client.request("POST", "/api/auth/resend-verification", {
    body: { email: user.payload.email },
  });
  assert.equal(resend.status, 202);
  assert.ok(resend.json.devVerifyUrl);

  const missing = await client.request("POST", "/api/auth/resend-verification", {
    body: { email: "unknown@example.com" },
  });
  assert.equal(missing.status, 202);
  assert.equal(missing.json.devVerifyUrl, undefined);
});

test("password reset also verifies the email address", async () => {
  resetRateLimits();
  const client = makeClient(base);
  const user = await registerUser(client, base);
  assert.equal(user.json.user.emailVerified, false);

  const forgot = await client.request("POST", "/api/auth/forgot-password", {
    body: { email: user.payload.email },
  });
  assert.equal(forgot.status, 202);
  const token = tokenFromUrl(forgot.json.devResetUrl);

  const reset = await client.request("POST", "/api/auth/reset-password", {
    body: { token, password: "NouveauMotDePasse-456!" },
  });
  assert.equal(reset.status, 200);

  const login = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: "NouveauMotDePasse-456!" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.emailVerified, true);
});

test("admin can send a message to all active users", async () => {
  resetRateLimits();
  const adminClient = makeClient(base);
  const userClient = makeClient(base);
  await registerAdmin(adminClient, base);
  await registerUser(userClient, base);
  await registerUser(userClient, base);

  const sent = await adminClient.request("POST", "/api/admin/messages", {
    body: { subject: "Nouvelle formation", text: "Une nouvelle formation est disponible.", recipients: "all" },
  });
  assert.equal(sent.status, 200);
  assert.ok(sent.json.total >= 3, "at least the admin and two fresh users are targeted");
  assert.equal(sent.json.sent, sent.json.total);
  assert.equal(sent.json.failed, 0);

  const audit = await adminClient.request("GET", "/api/admin/audit");
  const messageLog = audit.json.logs.find((log) => log.event === "MESSAGE_SENT");
  assert.ok(messageLog, "MESSAGE_SENT must be recorded in the audit log");
  assert.equal(messageLog.details.recipients, sent.json.total);
});

test("admin message endpoint validates input and supports explicit recipients", async () => {
  resetRateLimits();
  const adminClient = makeClient(base);
  const userClient = makeClient(base);
  await registerAdmin(adminClient, base);
  const target = await registerUser(userClient, base);

  const noSubject = await adminClient.request("POST", "/api/admin/messages", {
    body: { subject: "  ", text: "Bonjour", recipients: "all" },
  });
  expectError(noSubject, "invalid_subject");

  const noRecipients = await adminClient.request("POST", "/api/admin/messages", {
    body: { subject: "Bonjour", text: "Contenu", recipients: [] },
  });
  expectError(noRecipients, "invalid_recipients");

  const selected = await adminClient.request("POST", "/api/admin/messages", {
    body: { subject: "Message ciblé", text: "Pour vous.", recipients: [target.json.user.id] },
  });
  assert.equal(selected.status, 200);
  assert.equal(selected.json.total, 1);
  assert.equal(selected.json.sent, 1);
});

test("non-admin cannot send messages", async () => {
  resetRateLimits();
  const client = makeClient(base);
  await registerUser(client, base);
  const response = await client.request("POST", "/api/admin/messages", {
    body: { subject: "x", text: "y", recipients: "all" },
  });
  assert.equal(response.status, 403);
});

test("admin-created users are verified after setting their password", async () => {
  resetRateLimits();
  const adminClient = makeClient(base);
  const admin = await registerAdmin(adminClient, base);

  const created = await adminClient.request("POST", "/api/admin/users", {
    body: { firstName: "Nadia", lastName: "Invitee", email: `nadia.${Date.now()}@example.com`, role: "user" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.user.emailVerified, false);

  const token = tokenFromUrl(created.json.devResetUrl);
  const freshClient = makeClient(base);
  const reset = await freshClient.request("POST", "/api/auth/reset-password", {
    body: { token, password: USER_PASSWORD },
  });
  assert.equal(reset.status, 200);

  const login = await freshClient.request("POST", "/api/auth/login", {
    body: { email: created.json.user.email, password: USER_PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.emailVerified, true);
});
