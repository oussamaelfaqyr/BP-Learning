"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  startTestServer,
  stopTestServer,
  makeClient,
  expectError,
  registerUser,
  resetRateLimits,
  USER_PASSWORD,
} = require("./helpers");

let base;
let client;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  client = makeClient(base);
});

after(async () => {
  await stopTestServer();
});

beforeEach(() => {
  resetRateLimits();
});

test("health endpoint is public", async () => {
  const response = await client.request("GET", "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
});

test("registration creates a user and sets an HttpOnly session cookie", async () => {
  const response = await registerUser(client, base);
  assert.equal(response.status, 201);
  assert.equal(response.json.user.email, response.payload.email);
  assert.equal(response.json.user.role, "user");
  assert.equal(response.json.user.passwordHash, undefined);
  const cookie = client.cookies.get("bp_session");
  assert.ok(cookie, "session cookie should be set");
});

test("registration rejects weak passwords", async () => {
  const response = await client.request("POST", "/api/auth/register", {
    body: { firstName: "Ali", lastName: "Test", email: "weak@example.com", password: "court" },
  });
  expectError(response, "weak_password");
});

test("registration rejects invalid emails and names", async () => {
  const badEmail = await client.request("POST", "/api/auth/register", {
    body: { firstName: "Ali", lastName: "Test", email: "not-an-email", password: USER_PASSWORD },
  });
  expectError(badEmail, "invalid_email");
  const badName = await client.request("POST", "/api/auth/register", {
    body: { firstName: "<script>alert(1)</script>", lastName: "Test", email: "x@example.com", password: USER_PASSWORD },
  });
  expectError(badName, "invalid_first_name");
});

test("duplicate email is rejected with 409", async () => {
  const first = await registerUser(client, base);
  const second = await client.request("POST", "/api/auth/register", {
    body: { firstName: "Autre", lastName: "Personne", email: first.payload.email, password: USER_PASSWORD },
  });
  expectError(second, "email_taken");
  assert.equal(second.status, 409);
});

test("injected role field is ignored on registration", async () => {
  const response = await client.request("POST", "/api/auth/register", {
    body: {
      firstName: "Maya",
      lastName: "Rôle",
      email: `maya.${Date.now()}@example.com`,
      password: USER_PASSWORD,
      role: "admin",
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.json.user.role, "user");
});

test("login succeeds with correct credentials and fails with wrong password", async () => {
  const user = await registerUser(client, base);
  await client.request("POST", "/api/auth/logout");

  const wrong = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: "mauvaisdemodepassedemo" },
  });
  expectError(wrong, "invalid_credentials");

  const ok = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: user.payload.password },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.email, user.payload.email);

  const me = await client.request("GET", "/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, user.payload.email);
});

test("unknown email login returns the same generic error", async () => {
  const response = await client.request("POST", "/api/auth/login", {
    body: { email: "unknown@example.com", password: "quelconquedemodepassedemo" },
  });
  expectError(response, "invalid_credentials");
});

test("logout clears the session", async () => {
  await registerUser(client, base);
  let me = await client.request("GET", "/api/me");
  assert.equal(me.status, 200);
  const logout = await client.request("POST", "/api/auth/logout");
  assert.equal(logout.status, 200);
  me = await client.request("GET", "/api/me");
  expectError(me, "unauthorized");
});

test("forgot password returns a generic 202 and dev reset link in test env", async () => {
  const user = await registerUser(client, base);
  const response = await client.request("POST", "/api/auth/forgot-password", {
    body: { email: user.payload.email },
  });
  assert.equal(response.status, 202);
  assert.ok(response.json.devResetUrl, "dev reset url expected outside production");
  assert.match(response.json.devResetUrl, /token=[a-f0-9]{64}/);
});

test("password reset flow: token works once and enables login with new password", async () => {
  const user = await registerUser(client, base);
  const forgot = await client.request("POST", "/api/auth/forgot-password", {
    body: { email: user.payload.email },
  });
  const token = forgot.json.devResetUrl.split("token=")[1];
  const newPassword = "nouveaumodepassedemo";

  const reset = await client.request("POST", "/api/auth/reset-password", {
    body: { token, password: newPassword },
  });
  assert.equal(reset.status, 200);

  const reuse = await client.request("POST", "/api/auth/reset-password", {
    body: { token, password: newPassword },
  });
  expectError(reuse, "invalid_token");

  await client.request("POST", "/api/auth/logout");
  const oldPassword = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: user.payload.password },
  });
  expectError(oldPassword, "invalid_credentials");

  const newLogin = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: newPassword },
  });
  assert.equal(newLogin.status, 200);
});

test("reset password invalidates existing sessions", async () => {
  const user = await registerUser(client, base);
  const forgot = await client.request("POST", "/api/auth/forgot-password", {
    body: { email: user.payload.email },
  });
  const token = forgot.json.devResetUrl.split("token=")[1];
  await client.request("POST", "/api/auth/reset-password", {
    body: { token, password: "encoreunmodepassededemo" },
  });
  const me = await client.request("GET", "/api/me");
  expectError(me, "unauthorized");
});

test("invalid reset tokens are rejected", async () => {
  const garbage = await client.request("POST", "/api/auth/reset-password", {
    body: { token: "deadbeef".repeat(8), password: USER_PASSWORD },
  });
  expectError(garbage, "invalid_token");
  const malformed = await client.request("POST", "/api/auth/reset-password", {
    body: { token: "zzzz<script>", password: USER_PASSWORD },
  });
  expectError(malformed, "invalid_token");
});

test("session tampering is rejected", async () => {
  client.cookies.set("bp_session", "a".repeat(64));
  const me = await client.request("GET", "/api/me");
  expectError(me, "unauthorized");
  client.cookies.delete("bp_session");
});

test("session cookie flags: HttpOnly and SameSite", async () => {
  const user = await registerUser(client, base);
  await client.request("POST", "/api/auth/logout");
  const login = await client.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: user.payload.password },
  });
  const cookieHeader = login.headers.get("set-cookie");
  assert.ok(cookieHeader, "login response must set the session cookie");
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
});
