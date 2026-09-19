"use strict";

const { test, before, after, beforeEach } = require("node:test");
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
let anonymous;
let userClient;
let adminClient;
let adminEmail;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  anonymous = makeClient(base);
  userClient = makeClient(base);
  adminClient = makeClient(base);
  const admin = await registerAdmin(adminClient, base);
  adminEmail = admin.email;
});

after(async () => {
  await stopTestServer();
});

beforeEach(() => {
  resetRateLimits();
});

test("anonymous cannot access protected endpoints", async () => {
  const me = await anonymous.request("GET", "/api/me");
  expectError(me, "unauthorized");
  const dashboard = await anonymous.request("GET", "/api/me/dashboard");
  expectError(dashboard, "unauthorized");
  const adminUsers = await anonymous.request("GET", "/api/admin/users");
  expectError(adminUsers, "unauthorized");
  const adminStats = await anonymous.request("GET", "/api/admin/stats");
  expectError(adminStats, "unauthorized");
});

test("regular user cannot access admin APIs", async () => {
  await registerUser(userClient, base);
  const users = await userClient.request("GET", "/api/admin/users");
  expectError(users, "forbidden");
  assert.equal(users.status, 403);
  const stats = await userClient.request("GET", "/api/admin/stats");
  expectError(stats, "forbidden");
  const courses = await userClient.request("GET", "/api/admin/courses");
  expectError(courses, "forbidden");
  const audit = await userClient.request("GET", "/api/admin/audit");
  expectError(audit, "forbidden");
  const settings = await userClient.request("GET", "/api/admin/settings");
  expectError(settings, "forbidden");
});

test("regular user cannot modify other users via admin routes", async () => {
  await registerUser(userClient, base);
  const users = await adminClient.request("GET", "/api/admin/users");
  const target = users.json.users[0];
  const patch = await userClient.request("PATCH", `/api/admin/users/${target.id}`, {
    body: { status: "disabled" },
  });
  expectError(patch, "forbidden");
  const create = await userClient.request("POST", "/api/admin/users", {
    body: { firstName: "X", lastName: "Y", email: "x@example.com", role: "admin" },
  });
  expectError(create, "forbidden");
});

test("admin can access admin APIs", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  assert.equal(users.status, 200);
  assert.ok(Array.isArray(users.json.users));
  const stats = await adminClient.request("GET", "/api/admin/stats");
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.json.totalUsers, "number");
});

test("admin stats cannot be manipulated by query parameters", async () => {
  const stats = await adminClient.request("GET", "/api/admin/stats?totalUsers=999999");
  assert.equal(stats.status, 200);
  const users = await adminClient.request("GET", "/api/admin/users");
  assert.equal(typeof stats.json.totalUsers, "number");
  assert.ok(stats.json.totalUsers <= users.json.total + 1000);
});

test("user cannot complete lessons on a course they do not own or are not assigned to", async () => {
  await registerUser(userClient, base);
  const otherClient = makeClient(base);
  await registerUser(otherClient, base);
  const created = await otherClient.request("POST", "/api/me/courses", {
    body: {
      title: "Parcours privé",
      objective: "Objectif privé de l’autre utilisateur",
      modules: [
        { id: "m1", title: "Module 1", description: "Description 1" },
        { id: "m2", title: "Module 2", description: "Description 2" },
        { id: "m3", title: "Module 3", description: "Description 3" },
      ],
    },
  });
  const courseId = created.json.course.id;
  const attempt = await userClient.request(
    "POST",
    `/api/me/courses/${courseId}/modules/m1/complete`
  );
  expectError(attempt, "forbidden");
});

test("user cannot save simulation results against someone else's course", async () => {
  await registerUser(userClient, base);
  const otherClient = makeClient(base);
  await registerUser(otherClient, base);
  const created = await otherClient.request("POST", "/api/me/courses", {
    body: {
      title: "Parcours privé 2",
      objective: "Un autre objectif privé",
      modules: [
        { id: "m1", title: "Module 1", description: "Description 1" },
        { id: "m2", title: "Module 2", description: "Description 2" },
        { id: "m3", title: "Module 3", description: "Description 3" },
      ],
    },
  });
  const attempt = await userClient.request("POST", "/api/me/simulations", {
    body: {
      scenarioId: "communication",
      courseId: created.json.course.id,
      moduleId: "m1",
      messages: [
        { role: "assistant", content: "Bonjour, je voudrais des renseignements." },
        { role: "user", content: "Bonjour, puis-je vous aider ?" },
      ],
    },
  });
  expectError(attempt, "forbidden");
});

test("cross-origin state-changing requests are rejected (CSRF)", async () => {
  const response = await anonymous.request("POST", "/api/auth/login", {
    body: { email: adminEmail, password: USER_PASSWORD },
    origin: "https://evil.example",
  });
  expectError(response, "forbidden");
  assert.equal(response.status, 403);
});

test("same-origin state-changing requests are accepted", async () => {
  const response = await anonymous.request("POST", "/api/auth/login", {
    body: { email: adminEmail, password: USER_PASSWORD },
    origin: base,
  });
  assert.equal(response.status, 200);
});

test("malformed user ids are rejected cleanly", async () => {
  const bad = await adminClient.request("GET", "/api/admin/users/not-a-valid-id/performance");
  assert.equal(bad.status, 404);
  const injection = await adminClient.request("GET", "/api/admin/users/%24%7Bgt%7D/performance");
  assert.equal(injection.status, 404);
  const patch = await adminClient.request("PATCH", "/api/admin/users/zzz", { body: { status: "disabled" } });
  assert.equal(patch.status, 404);
});

test("admin API responses never include password hashes", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  for (const user of users.json.users) {
    assert.equal(user.passwordHash, undefined);
    assert.equal(user.password, undefined);
  }
});
