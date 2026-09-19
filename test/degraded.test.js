"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { makeClient, expectError } = require("./helpers");

process.env.LOG_HTTP = "quiet";
process.env.SESSION_SECRET = "degraded-test-secret";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://127.0.0.1:59999/?serverSelectionTimeoutMS=800";
process.env.PORT = String(8100 + Math.floor(Math.random() * 500));

let server;
let base;
let client;

before(async () => {
  const app = require("../server/app");
  server = await app.start();
  base = `http://127.0.0.1:${process.env.PORT}`;
  client = makeClient(base);
});

after(async () => {
  const app = require("../server/app");
  await app.stop(server);
});

test("health stays available when the database is down", async () => {
  const response = await client.request("GET", "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
});

test("auth-protected endpoints return 503 db_unavailable when the database is down", async () => {
  const me = await client.request("GET", "/api/me");
  expectError(me, "db_unavailable");
  assert.equal(me.status, 503);
  const register = await client.request("POST", "/api/auth/register", {
    body: { firstName: "A", lastName: "B", email: "x@example.com", password: "MotDePasse-123!" },
  });
  expectError(register, "db_unavailable");
});

test("legacy mode: AI endpoints remain reachable without a database", async () => {
  const course = await client.request("POST", "/api/course/generate", {
    body: { objective: "Mieux conseiller les clients en dermocosmétique" },
  });
  assert.equal(course.status, 503);
  assert.equal(course.json.error, "ai_unavailable");
  const scenarios = await client.request("GET", "/api/scenarios");
  assert.equal(scenarios.status, 200);
  assert.ok(scenarios.json.scenarios.length > 1);
});

test("static files are still served when the database is down", async () => {
  const response = await client.request("GET", "/");
  assert.equal(response.status, 200);
  assert.match(response.text, /BP Learning/);
});
