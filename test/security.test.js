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

test("passwords are stored hashed (scrypt), never plaintext", async () => {
  const user = await registerUser(client, base);
  const db = require("../server/db").getDb();
  const stored = await db.collection("users").findOne({ email: user.payload.email });
  assert.ok(stored.passwordHash.startsWith("scrypt$"), "expected scrypt hash");
  assert.ok(!stored.passwordHash.includes(user.payload.password), "hash must not contain the password");
  assert.equal(stored.password, undefined);
});

test("two identical passwords produce different hashes (salting)", async () => {
  const { hashPassword } = require("../server/auth");
  const first = await hashPassword(USER_PASSWORD);
  const second = await hashPassword(USER_PASSWORD);
  assert.notEqual(first, second);
  const { verifyPassword } = require("../server/auth");
  assert.equal(await verifyPassword(USER_PASSWORD, first), true);
  assert.equal(await verifyPassword("autre-chose", first), false);
});

test("malicious inputs are rejected by validation", async () => {
  const rejected = [
    { body: { firstName: "A", lastName: "B", email: "x@example.com", password: "p".repeat(1000) } },
    { body: { firstName: "A", lastName: "B", email: "x".repeat(500) + "@example.com", password: USER_PASSWORD } },
  ];
  for (const body of rejected) {
    const response = await client.request("POST", "/api/auth/register", { body });
    assert.ok(response.status >= 400, `expected 4xx for ${JSON.stringify(body).slice(0, 60)}`);
  }
  const injectedRole = await client.request("POST", "/api/auth/register", {
    body: { firstName: "A", lastName: "B", email: `injected.${Date.now()}@example.com`, password: USER_PASSWORD, role: "superadmin" },
  });
  assert.equal(injectedRole.status, 201);
  assert.equal(injectedRole.json.user.role, "user");
  const protoAttempt = await client.request("POST", "/api/auth/register", {
    body: { firstName: "A", lastName: "B", email: `proto.${Date.now()}@example.com`, password: USER_PASSWORD, __proto__: { role: "admin" } },
  });
  assert.equal(protoAttempt.status, 201);
  assert.equal(protoAttempt.json.user.role, "user");
});

test("search endpoint tolerates regex metacharacters safely", async () => {
  const { registerAdmin } = require("./helpers");
  const adminClient = makeClient(base);
  await registerAdmin(adminClient, base);
  const response = await adminClient.request("GET", "/api/admin/users?search=.*%24%7B%7D%5B%5D%5E");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.json.users));
});

test("profile update ignores role changes", async () => {
  await registerUser(client, base);
  const response = await client.request("PATCH", "/api/me", {
    body: { firstName: "Nouvelle", role: "admin", status: "disabled" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.user.firstName, "Nouvelle");
  assert.equal(response.json.user.role, "user");
  assert.equal(response.json.user.status, "active");
});

test("error responses never leak stack traces", async () => {
  const anonymous = makeClient(base);
  const response = await anonymous.request("GET", "/api/me");
  const text = JSON.stringify(response.json);
  assert.ok(!text.includes("at "), "no stack frames in response");
  assert.ok(!text.includes("node_modules"), "no internal paths in response");
  expectError(response, "unauthorized");
});

test("oversized payloads are rejected", async () => {
  const response = await client.request("POST", "/api/auth/register", {
    body: { firstName: "A", lastName: "B", email: "x@example.com", password: USER_PASSWORD, junk: "a".repeat(100000) },
  });
  assert.equal(response.status, 413);
});

test("database documents store evaluation data with user attribution", async () => {
  await registerUser(client, base);
  const save = await client.request("POST", "/api/me/simulations", {
    body: {
      scenarioId: "communication",
      messages: [
        { role: "assistant", content: "Bonjour, j’ai du mal à comprendre l’affiche." },
        { role: "user", content: "Bonjour, préférez-vous le français simple ou une explication en darija ?" },
        { role: "assistant", content: "Le français simple, merci." },
        { role: "user", content: "Très bien. Regardons la première étape ensemble." },
      ],
      evaluation: {
        overall: "Synthèse",
        priority: "structure",
        nextPractice: "Pratiquer l’explication étape par étape",
        criteria: [
          { id: "preference", label: "Demander la préférence", score: 90, status: "acquis", evidence: "…", improvement: "…" },
          { id: "structure", label: "Expliquer étape par étape", score: 50, status: "a_renforcer", evidence: "…", improvement: "…" },
          { id: "verification", label: "Vérifier la compréhension", score: 40, status: "a_renforcer", evidence: "…", improvement: "…" },
        ],
      },
    },
  });
  assert.equal(save.status, 201);
  const me = await client.request("GET", "/api/me/simulations");
  assert.equal(me.status, 200);
  assert.equal(me.json.simulations.length, 1);
  assert.equal(me.json.simulations[0].evaluation.priority, "structure");
  assert.equal(me.json.evaluations.length, 1);
  const db = require("../server/db").getDb();
  const stored = await db.collection("simulationSessions").findOne({ scenarioId: "communication" });
  assert.ok(stored.userId, "simulation must be attributed to a user");
});
