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
let userId;
let userEmail;

const COURSE = {
  title: "Conseil en dermocosmétique",
  objective: "Mieux conseiller les produits de soin",
  estimatedDuration: "Environ 30 minutes",
  modules: [
    { id: "m1", title: "Analyser le besoin", description: "Poser les bonnes questions" },
    { id: "m2", title: "Proposer une recommandation", description: "Choisir le bon produit" },
    { id: "m3", title: "Mise en pratique", description: "Simuler une situation client" },
  ],
};

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  client = makeClient(base);
  const user = await registerUser(client, base);
  userId = user.json.user.id;
  userEmail = user.payload.email;
});

after(async () => {
  await stopTestServer();
});

beforeEach(() => {
  resetRateLimits();
});

test("dashboard is available and starts empty", async () => {
  const response = await client.request("GET", "/api/me/dashboard");
  assert.equal(response.status, 200);
  assert.equal(response.json.user.id, userId);
  assert.equal(response.json.overallProgress, 0);
  assert.equal(response.json.courses.length, 0);
  assert.equal(response.json.nextLesson, null);
  assert.deepEqual(response.json.weakPoints, []);
});

test("create a personal course and see it in my courses", async () => {
  const created = await client.request("POST", "/api/me/courses", { body: COURSE });
  assert.equal(created.status, 201);
  assert.equal(created.json.course.status, "draft");
  assert.equal(created.json.course.origin, "personal");

  const courses = await client.request("GET", "/api/me/courses");
  assert.equal(courses.json.courses.length, 1);
  assert.equal(courses.json.courses[0].title, COURSE.title);
  assert.equal(courses.json.courses[0].progress.percent, 0);
});

test("creating a second personal course archives the previous one", async () => {
  const first = await client.request("POST", "/api/me/courses", { body: COURSE });
  const second = await client.request("POST", "/api/me/courses", {
    body: { ...COURSE, title: "Nouveau parcours" },
  });
  assert.equal(second.status, 201);
  const courses = await client.request("GET", "/api/me/courses");
  const firstCourse = courses.json.courses.find((course) => course.id === first.json.course.id);
  assert.equal(firstCourse.status, "archived");
});

test("completing lessons updates progress and dashboard next lesson", async () => {
  await client.request("POST", "/api/me/courses", { body: COURSE });
  const courses = await client.request("GET", "/api/me/courses");
  const courseId = courses.json.courses[0].id;

  const complete = await client.request("POST", `/api/me/courses/${courseId}/modules/m1/complete`);
  assert.equal(complete.status, 200);

  const updated = await client.request("GET", "/api/me/courses");
  const course = updated.json.courses[0];
  assert.equal(course.progress.completed, 1);
  assert.equal(course.progress.percent, 33);

  const dashboard = await client.request("GET", "/api/me/dashboard");
  assert.equal(dashboard.json.nextLesson.module.id, "m2");
});

test("completing unknown module ids is rejected", async () => {
  const courses = await client.request("GET", "/api/me/courses");
  const courseId = courses.json.courses[0].id;
  const response = await client.request("POST", `/api/me/courses/${courseId}/modules/inexistant/complete`);
  assert.equal(response.status, 400);
});

test("quiz results are persisted", async () => {
  const courses = await client.request("GET", "/api/me/courses");
  const courseId = courses.json.courses[0].id;
  const save = await client.request("POST", `/api/me/courses/${courseId}/modules/m1/quiz`, {
    body: { assessment: "appropriate", explanation: "Bien vu.", keyPoint: "Poser une question ouverte." },
  });
  assert.equal(save.status, 200);

  const progress = await client.request("GET", "/api/me/progress");
  assert.equal(progress.status, 200);
  assert.equal(progress.json.lessonsCompleted, 1);
  assert.equal(typeof progress.json.skills.Communication, "number");
});

test("simulations with evaluations appear in history and dashboard", async () => {
  const save = await client.request("POST", "/api/me/simulations", {
    body: {
      scenarioId: "objection-prix",
      messages: [
        { role: "assistant", content: "Ce produit me plaît mais il est trop cher." },
        { role: "user", content: "Je comprends votre préoccupation de budget." },
        { role: "assistant", content: "Vous comprenez ?" },
        { role: "user", content: "Oui. Voyons ce qui compte le plus pour vous." },
      ],
      evaluation: {
        overall: "Bonne écoute",
        priority: "valeur",
        nextPractice: "Relier la valeur au besoin",
        criteria: [
          { id: "ecoute", label: "Écoute", score: 85, status: "acquis", evidence: "…", improvement: "…" },
          { id: "valeur", label: "Valeur", score: 45, status: "a_renforcer", evidence: "…", improvement: "…" },
          { id: "objection", label: "Objection", score: 60, status: "a_renforcer", evidence: "…", improvement: "…" },
          { id: "pression", label: "Pression", score: 90, status: "acquis", evidence: "…", improvement: "…" },
          { id: "pertinence", label: "Pertinence", score: 70, status: "a_renforcer", evidence: "…", improvement: "…" },
        ],
      },
    },
  });
  assert.equal(save.status, 201);

  const dashboard = await client.request("GET", "/api/me/dashboard");
  assert.equal(dashboard.json.recentSimulations.length, 1);
  assert.equal(dashboard.json.recentSimulations[0].scenarioTitle, "Objection sur le prix");
  assert.ok(dashboard.json.weakPoints.length >= 1);
});

test("invalid simulation payloads are rejected", async () => {
  const noMessages = await client.request("POST", "/api/me/simulations", {
    body: { scenarioId: "communication", messages: [] },
  });
  assert.equal(noMessages.status, 400);
  const badScenario = await client.request("POST", "/api/me/simulations", {
    body: { scenarioId: "intrusion; drop()", messages: [{ role: "user", content: "x" }] },
  });
  assert.equal(badScenario.status, 400);
});

test("migration endpoint accepts validated local state", async () => {
  const migrate = await client.request("POST", "/api/me/migrate", {
    body: {
      course: {
        title: "Parcours migré",
        objective: "Objectif issu du stockage local",
        estimatedDuration: "Environ 20 minutes",
        modules: [
          { id: "m1", title: "Module A", description: "Description A" },
          { id: "m2", title: "Module B", description: "Description B" },
          { id: "m3", title: "Module C", description: "Description C" },
        ],
      },
      completedModules: ["m2"],
      quizResults: {
        m2: { assessment: "partial", explanation: "Presque.", keyPoint: "Reformuler." },
      },
      simulations: [
        {
          scenarioId: "communication",
          messages: [
            { role: "assistant", content: "Bonjour." },
            { role: "user", content: "Bonjour, comment puis-je vous aider ?" },
          ],
        },
      ],
    },
  });
  assert.equal(migrate.status, 200);
  assert.equal(migrate.json.migrated.lessons, 1);
  assert.equal(migrate.json.migrated.simulations, 1);
});

test("migration rejects malformed blobs", async () => {
  const response = await client.request("POST", "/api/me/migrate", {
    body: { course: { title: 42 }, completedModules: "not-an-array" },
  });
  assert.equal(response.status, 400);
});

test("profile update validates names and objective", async () => {
  const ok = await client.request("PATCH", "/api/me", {
    body: { firstName: "Salma", lastName: "Ouahbi", learningObjective: "Mieux conseiller" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.firstName, "Salma");

  const badObjective = await client.request("PATCH", "/api/me", {
    body: { learningObjective: "x".repeat(700) },
  });
  expectError(badObjective, "invalid_objective");

  const badName = await client.request("PATCH", "/api/me", { body: { firstName: "1234" } });
  expectError(badName, "invalid_first_name");
});

test("password change: wrong current password rejected, correct one works", async () => {
  const wrong = await client.request("PUT", "/api/me/password", {
    body: { currentPassword: "FauxMotDePasse-999", newPassword: "nouveaumodepassedemobis" },
  });
  expectError(wrong, "password_mismatch");

  const ok = await client.request("PUT", "/api/me/password", {
    body: { currentPassword: USER_PASSWORD, newPassword: "nouveaumodepassedemobis" },
  });
  assert.equal(ok.status, 200);

  await client.request("POST", "/api/auth/logout");
  const login = await client.request("POST", "/api/auth/login", {
    body: { email: userEmail, password: "nouveaumodepassedemobis" },
  });
  assert.equal(login.status, 200);
});
