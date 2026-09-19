"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer, makeClient, expectError, registerUser } = require("./helpers");

process.env.LOGIN_RATE_MAX_PER_IP = "5";
process.env.LOGIN_RATE_MAX_PER_EMAIL = "3";
process.env.AUTH_RATE_MAX_PER_IP = "4";

let base;
let client;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  client = makeClient(base);
});

after(async () => {
  await stopTestServer();
});

test("excessive login attempts are rate limited", async () => {
  const user = await registerUser(client, base);
  await client.request("POST", "/api/auth/logout");

  let limited = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await client.request("POST", "/api/auth/login", {
      body: { email: user.payload.email, password: "mauvaisdemodepassedebis" },
    });
    if (response.status === 429) {
      limited = true;
      assert.equal(response.json.error.code, "RATE_LIMITED");
      break;
    }
    assert.ok(response.status === 401, `expected 401 or 429, got ${response.status}`);
  }
  assert.ok(limited, "expected the limiter to kick in after repeated failures");
});

test("rate limiting applies per email even from different IPs", async () => {
  const user = await registerUser(client, base);
  const otherClient = makeClient(base);
  otherClient.extraHeaders = { "X-Forwarded-For": "203.0.113.7" };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await otherClient.request("POST", "/api/auth/login", {
      body: { email: user.payload.email, password: "mauvaisdemodepassedebis" },
      headers: otherClient.extraHeaders,
    });
    if (response.status === 429) return;
  }
  assert.fail("expected rate limiting by email");
});

test("forgot-password endpoint is rate limited", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await client.request("POST", "/api/auth/forgot-password", {
      body: { email: `spam${attempt}@example.com` },
    });
    if (response.status === 429) {
      assert.equal(response.json.error.code, "RATE_LIMITED");
      return;
    }
    assert.ok(response.status === 202 || response.status === 400);
  }
  assert.fail("expected the auth limiter to trigger");
});
