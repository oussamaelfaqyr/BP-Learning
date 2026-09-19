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
let adminClient;
let admin;
let userClient;
let user;

const COURSE = {
  title: "Vente complémentaire éthique",
  objective: "Proposer des compléments utiles sans pression",
  estimatedDuration: "Environ 25 minutes",
  modules: [
    { id: "m1", title: "Comprendre l’achat", description: "Explorer le contexte" },
    { id: "m2", title: "Proposer avec pertinence", description: "Lier la suggestion au besoin" },
    { id: "m3", title: "Mise en pratique", description: "Simulation client" },
  ],
};

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  adminClient = makeClient(base);
  admin = await registerAdmin(adminClient, base);
  userClient = makeClient(base);
  user = await registerUser(userClient, base);
});

after(async () => {
  await stopTestServer();
});

beforeEach(() => {
  resetRateLimits();
});

test("admin can create users by invitation (no password stored by admin)", async () => {
  const response = await adminClient.request("POST", "/api/admin/users", {
    body: {
      firstName: "Invité",
      lastName: "Exemple",
      email: `invite.${Date.now()}@example.com`,
      role: "user",
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.json.user.status, "active");
  assert.ok(response.json.devResetUrl, "dev reset url expected in test env");
  const db = require("../server/db").getDb();
  const stored = await db.collection("users").findOne({ email: response.json.user.email });
  assert.equal(stored.passwordHash, null);
});

test("invited user can set a password through the reset flow and log in", async () => {
  const created = await adminClient.request("POST", "/api/admin/users", {
    body: {
      firstName: "Invité",
      lastName: "Deux",
      email: `invite2.${Date.now()}@example.com`,
      role: "user",
    },
  });
  const token = created.json.devResetUrl.split("token=")[1];
  const invitedClient = makeClient(base);
  const reset = await invitedClient.request("POST", "/api/auth/reset-password", {
    body: { token, password: "premiermodepassedemo" },
  });
  assert.equal(reset.status, 200);
  const login = await invitedClient.request("POST", "/api/auth/login", {
    body: { email: created.json.user.email, password: "premiermodepassedemo" },
  });
  assert.equal(login.status, 200);
});

test("admin cannot create a user with invalid data", async () => {
  const badRole = await adminClient.request("POST", "/api/admin/users", {
    body: { firstName: "A", lastName: "B", email: "x@example.com", role: "superuser" },
  });
  expectError(badRole, "invalid_role");
  const badEmail = await adminClient.request("POST", "/api/admin/users", {
    body: { firstName: "A", lastName: "B", email: "nope", role: "user" },
  });
  expectError(badEmail, "invalid_email");
});

test("last active admin cannot be disabled or demoted", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  const adminUser = users.json.users.find((item) => item.id === admin.json.user.id);
  const disable = await adminClient.request("PATCH", `/api/admin/users/${adminUser.id}`, {
    body: { status: "disabled" },
  });
  expectError(disable, "last_admin");
  const demote = await adminClient.request("PATCH", `/api/admin/users/${adminUser.id}`, {
    body: { role: "user" },
  });
  expectError(demote, "last_admin");
});

test("admin cannot disable their own account", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  const self = users.json.users.find((item) => item.id === admin.json.user.id);
  const disable = await adminClient.request("PATCH", `/api/admin/users/${self.id}`, {
    body: { status: "disabled" },
  });
  expectError(disable, "last_admin");
});

test("disabling a user kills their sessions", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  const target = users.json.users.find((item) => item.id === user.json.user.id);
  const disable = await adminClient.request("PATCH", `/api/admin/users/${target.id}`, {
    body: { status: "disabled" },
  });
  assert.equal(disable.status, 200);
  const me = await userClient.request("GET", "/api/me");
  expectError(me, "unauthorized");
  const enable = await adminClient.request("PATCH", `/api/admin/users/${target.id}`, {
    body: { status: "active" },
  });
  assert.equal(enable.status, 200);
  const login = await userClient.request("POST", "/api/auth/login", {
    body: { email: user.payload.email, password: user.payload.password },
  });
  assert.equal(login.status, 200);
});

test("course lifecycle: draft → publish → assign → learner sees it → unassign", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: COURSE });
  assert.equal(created.status, 201);
  assert.equal(created.json.course.status, "draft");
  const courseId = created.json.course.id;

  const assignDraft = await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, userIds: [user.json.user.id] },
  });
  expectError(assignDraft, "course_not_published");

  const published = await adminClient.request("POST", `/api/admin/courses/${courseId}/publish`);
  assert.equal(published.json.course.status, "published");

  const assign = await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, userIds: [user.json.user.id] },
  });
  assert.equal(assign.status, 200);
  assert.equal(assign.json.assigned, 1);

  const myCourses = await userClient.request("GET", "/api/me/courses");
  const assignedCourse = myCourses.json.courses.find((course) => course.id === courseId);
  assert.ok(assignedCourse, "assigned course should appear for the learner");
  assert.equal(assignedCourse.origin, "assigned");

  const assignments = await adminClient.request("GET", "/api/admin/assignments");
  const assignment = assignments.json.assignments.find((item) => item.courseId === courseId);
  assert.ok(assignment);

  const unassign = await adminClient.request("DELETE", `/api/admin/assignments/${assignment.id}`);
  assert.equal(unassign.status, 200);

  const after = await userClient.request("GET", "/api/me/courses");
  assert.equal(after.json.courses.some((course) => course.id === courseId), false);
});

test("assign to all users works", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: { ...COURSE, title: "Cours collectif" } });
  const courseId = created.json.course.id;
  await adminClient.request("POST", `/api/admin/courses/${courseId}/publish`);
  const assign = await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, allUsers: true },
  });
  assert.equal(assign.status, 200);
  assert.ok(assign.json.assigned >= 2, `expected at least admin+user, got ${assign.json.assigned}`);
});

test("deadline is persisted when provided", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: { ...COURSE, title: "Cours avec échéance" } });
  await adminClient.request("POST", `/api/admin/courses/${created.json.course.id}/publish`);
  const assign = await adminClient.request("POST", "/api/admin/assignments", {
    body: {
      courseId: created.json.course.id,
      userIds: [user.json.user.id],
      deadline: "2027-03-15",
    },
  });
  assert.equal(assign.status, 200);
  const myCourses = await userClient.request("GET", "/api/me/courses");
  const course = myCourses.json.courses.find((item) => item.id === created.json.course.id);
  assert.ok(course.assignment.deadline);
  assert.match(course.assignment.deadline, /^2027-03-15/);
});

test("admin can update a draft course before publishing", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: COURSE });
  const courseId = created.json.course.id;
  const updated = await adminClient.request("PATCH", `/api/admin/courses/${courseId}`, {
    body: { ...COURSE, title: "Titre corrigé après relecture", modules: [...COURSE.modules, { id: "m4", title: "Révision", description: "Points clés" }] },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.course.title, "Titre corrigé après relecture");
  assert.equal(updated.json.course.modules.length, 4);
});

test("learner completing an assigned course flips assignment to completed", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: COURSE });
  const courseId = created.json.course.id;
  await adminClient.request("POST", `/api/admin/courses/${courseId}/publish`);
  await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, userIds: [user.json.user.id] },
  });
  for (const module of COURSE.modules) {
    const response = await userClient.request(
      "POST",
      `/api/me/courses/${courseId}/modules/${module.id}/complete`
    );
    assert.equal(response.status, 200, `completing ${module.id}`);
  }
  const assignments = await adminClient.request("GET", "/api/admin/assignments");
  const assignment = assignments.json.assignments.find((item) => item.courseId === courseId);
  assert.equal(assignment.status, "completed");
});

test("admin stats are computed from real data", async () => {
  const stats = await adminClient.request("GET", "/api/admin/stats");
  assert.equal(stats.status, 200);
  const data = stats.json;
  assert.ok(data.totalUsers >= 2);
  assert.ok(data.publishedCourses >= 1);
  assert.ok(data.assignedCourses >= 1);
  assert.equal(typeof data.averageProgress, "number");
  assert.ok(Array.isArray(data.weaknesses));
  assert.ok(Array.isArray(data.recentActivity));
});

test("per-user performance is available to admins only", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  const target = users.json.users.find((item) => item.id === user.json.user.id);
  const performance = await adminClient.request("GET", `/api/admin/users/${target.id}/performance`);
  assert.equal(performance.status, 200);
  assert.equal(performance.json.user.id, target.id);
  assert.ok(Array.isArray(performance.json.courses));
});

test("audit log records sensitive admin events", async () => {
  const logs = await adminClient.request("GET", "/api/admin/audit");
  assert.equal(logs.status, 200);
  const events = logs.json.logs.map((log) => log.event);
  assert.ok(events.includes("COURSE_PUBLISHED"));
  assert.ok(events.includes("COURSE_ASSIGNED"));
  assert.ok(events.includes("USER_CREATED"));
  for (const log of logs.json.logs) {
    assert.equal(log.details.password, undefined);
    assert.equal(log.details.passwordHash, undefined);
  }
});

test("archive a course and verify it disappears from learner courses", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: { ...COURSE, title: "Cours à archiver" } });
  const courseId = created.json.course.id;
  await adminClient.request("POST", `/api/admin/courses/${courseId}/publish`);
  await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, userIds: [user.json.user.id] },
  });
  const archive = await adminClient.request("POST", `/api/admin/courses/${courseId}/archive`);
  assert.equal(archive.status, 200);
  const myCourses = await userClient.request("GET", "/api/me/courses");
  assert.equal(myCourses.json.courses.some((course) => course.id === courseId), false);
});

test("admin can permanently delete a user and their data", async () => {
  const targetClient = makeClient(base);
  const target = await registerUser(targetClient, base);
  const usersBefore = await adminClient.request("GET", "/api/admin/users");
  assert.ok(usersBefore.json.users.some((item) => item.id === target.json.user.id));

  const deleted = await adminClient.request("DELETE", `/api/admin/users/${target.json.user.id}`);
  assert.equal(deleted.status, 200);

  const usersAfter = await adminClient.request("GET", "/api/admin/users");
  assert.equal(usersAfter.json.users.some((item) => item.id === target.json.user.id), false);

  const me = await targetClient.request("GET", "/api/me");
  expectError(me, "unauthorized");
});

test("admin cannot delete their own account", async () => {
  const users = await adminClient.request("GET", "/api/admin/users");
  const self = users.json.users.find((item) => item.id === admin.json.user.id);
  const deleted = await adminClient.request("DELETE", `/api/admin/users/${self.id}`);
  expectError(deleted, "cannot_delete_self");
});

test("admin can delete a course and its assignments", async () => {
  const created = await adminClient.request("POST", "/api/admin/courses", { body: { ...COURSE, title: "Cours à supprimer" } });
  const courseId = created.json.course.id;
  await adminClient.request("POST", `/api/admin/courses/${courseId}/publish`);
  await adminClient.request("POST", "/api/admin/assignments", {
    body: { courseId, userIds: [user.json.user.id] },
  });

  const deleted = await adminClient.request("DELETE", `/api/admin/courses/${courseId}`);
  assert.equal(deleted.status, 200);

  const courses = await adminClient.request("GET", "/api/admin/courses");
  assert.equal(courses.json.courses.some((course) => course.id === courseId), false);

  const myCourses = await userClient.request("GET", "/api/me/courses");
  assert.equal(myCourses.json.courses.some((course) => course.id === courseId), false);
});
