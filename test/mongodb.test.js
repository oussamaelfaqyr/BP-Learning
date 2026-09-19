"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, stopTestServer, makeClient, expectError, registerUser } = require("./helpers");

let base;
let client;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  client = makeClient(base);
});

after(async () => {
  await stopTestServer();
});

test("duplicate email unique index is enforced at the database level", async () => {
  const user = await registerUser(client, base);
  const db = require("../server/db").getDb();
  const users = db.collection("users");
  await assert.rejects(
    users.insertOne({
      email: user.payload.email,
      firstName: "X",
      lastName: "Y",
      role: "user",
      status: "active",
      passwordHash: "scrypt$1$1$1$aa$bb",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    (error) => error.code === 11000
  );
});

test("malformed course ids are rejected without crashing", async () => {
  await client.request("POST", "/api/me/courses", {
    body: {
      title: "Parcours test",
      objective: "Objectif test",
      modules: [
        { id: "m1", title: "M", description: "D" },
        { id: "m2", title: "M", description: "D" },
        { id: "m3", title: "M", description: "D" },
      ],
    },
  });
  const bad = await client.request("POST", "/api/me/courses/zzz/modules/m1/complete");
  assert.equal(bad.status, 404);
});

test("missing documents produce 404 instead of 500", async () => {
  const missing = await client.request("POST", "/api/me/courses/000000000000000000000000/modules/m1/complete");
  expectError(missing, "course_not_found");
});
