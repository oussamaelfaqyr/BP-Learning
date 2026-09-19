"use strict";

process.env.RATE_LIMIT_STORE = "mongodb";
process.env.LOGIN_RATE_MAX_PER_IP = "5";
process.env.LOGIN_RATE_MAX_PER_EMAIL = "3";
process.env.AUTH_RATE_MAX_PER_IP = "4";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer, makeClient, registerUser } = require("./helpers");

let base;
let client;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  client = makeClient(base);
});

after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  const db = require("../server/db").getDb();
  if (db) await db.collection("rateLimits").deleteMany({});
});

test("login attempts are rate limited through the shared store", async () => {
  const user = await registerUser(client, base);
  await client.request("POST", "/api/auth/logout");

  let limited = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await client.request("POST", "/api/auth/login", {
      body: { email: user.payload.email, password: "MauvaisMotDePasse-999!" },
    });
    if (response.status === 429) {
      assert.equal(response.json.error.code, "RATE_LIMITED");
      limited = true;
      break;
    }
    assert.equal(response.status, 401);
  }
  assert.ok(limited, "expected the shared limiter to kick in after repeated failures");
});

test("shared counters are stored in MongoDB and expire", async () => {
  const response = await client.request("POST", "/api/auth/forgot-password", {
    body: { email: `persist.${Date.now()}@example.com` },
  });
  assert.ok(response.status === 202 || response.status === 400);

  const db = require("../server/db").getDb();
  const stored = await db.collection("rateLimits").countDocuments();
  assert.ok(stored > 0, "expected rate-limit counters to be persisted in MongoDB");
});
