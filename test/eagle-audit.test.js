"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { startTestServer, stopTestServer, registerAdmin } = require("./helpers");

const ROOT = path.join(__dirname, "..", "public");

const COURSE = {
  title: "Conseil en dermocosmétique",
  objective: "Mieux conseiller les produits de soin au comptoir",
  estimatedDuration: "Environ 30 minutes",
  modules: [
    { id: "m1", title: "Analyser le besoin", description: "Poser les bonnes questions" },
    { id: "m2", title: "Proposer une recommandation", description: "Choisir le bon produit" },
    { id: "m3", title: "Mise en pratique", description: "Simuler une situation client" },
  ],
};

const LESSON = {
  lessonTitle: "Analyser le besoin avant de recommander",
  objective: "Savoir poser les bonnes questions",
  sections: [
    { type: "concept", title: "Pourquoi questionner d’abord ?", content: "Comprendre avant de recommander." },
    { type: "question", title: "À vous de jouer", question: "Quelle question est la plus adaptée ?", options: ["Que recherchez-vous ?", "Vous voulez celui-là ?"] },
  ],
};

const BOUND_ATTRS = new Set([
  "data-route", "data-prep", "data-go-simulation", "data-choice", "data-retry-turn", "data-reset-dialogue",
  "data-module", "data-reset-all", "data-ai-start", "data-ai-input", "data-ai-retry", "data-ai-reset",
  "data-ai-analyze", "data-ai-replay", "data-sim-scenario", "data-sim-retry", "data-tts", "data-tts-toggle", "data-tts-stop", "data-path-create",
  "data-goal-chip", "data-path-retry", "data-path-open-lesson", "data-path-complete", "data-path-retry-lesson",
  "data-path-answer", "data-path-answer-input", "data-path-recommend", "data-coach-toggle", "data-coach-open",
  "data-coach-prompt", "data-exercise-retry", "data-course-structure", "data-formations-search", "data-logout",
  "data-user-menu-trigger", "data-reload-view", "data-error-retry", "data-continue-course", "data-course-focus",
  "data-admin-create-user", "data-user-performance", "data-user-reset", "data-user-disable", "data-user-enable",
  "data-user-make-admin", "data-user-make-user", "data-users-search", "data-users-role", "data-users-status",
  "data-admin-generate-course", "data-generate-button", "data-course-publish", "data-course-archive",
  "data-course-edit", "data-course-editor-close", "data-admin-assign", "data-unassign", "data-nav-toggle",
  "data-dialog-cancel", "data-dialog-confirm", "data-mobile-auth", "data-mobile-nav-links", "data-as-user-list",
  "data-password-toggle", "data-scroll", "data-verify-submit", "data-resend-verification", "data-showcase",
  "data-course-open", "data-catalogue-add", "data-formations-retry", "data-local-open",
]);

const KNOWN_ROUTES = new Set([
  "", "/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/app", "/profile", "/forbidden",
  "/admin", "/admin/users", "/admin/courses", "/admin/assignments", "/admin/performance", "/admin/messages", "/admin/settings",
  "start", "vorbereitung", "simulation", "ia", "abschluss", "lernplan",
  "accueil", "parcours", "formations", "simulations", "progression", "lecon",
]);

const ARTIFACTS = ["undefined", "NaN", "[object Object]", "null</", 'class="message${', 'class="chat-message${', "score-undefined", "false%", "  %"];

function auditButtons(window, route) {
  const offenders = [];
  window.document.querySelectorAll("button").forEach((button) => {
    if (button.disabled) return;
    const attrs = [...button.attributes].map((attr) => attr.name);
    const hasBound = attrs.some((name) => BOUND_ATTRS.has(name));
    if (hasBound) return;
    const isSubmitInBoundForm = button.type === "submit" && button.closest("form[data-ai-form], form[data-tutor-form], form[data-path-answer-form], form[data-auth-form], form[data-profile-form], form[data-objective-form], form[data-password-form], form[data-admin-create-user], form[data-admin-generate-course], form[data-course-edit-form], form[data-admin-assign], form[data-admin-message], form[data-path-create]");
    if (isSubmitInBoundForm) return;
    offenders.push(`button "${button.textContent.trim().slice(0, 40)}" (${route})`);
  });
  window.document.querySelectorAll('a.button, a.quick-action, a.nav-link, a.user-menu-item').forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (href.startsWith("#")) {
      const routePart = href.slice(1).split("?")[0];
      if (!KNOWN_ROUTES.has(routePart)) offenders.push(`anchor href="#${routePart}" (${route})`);
    } else if (!/^https?:\/\//.test(href)) {
      offenders.push(`anchor href="${href}" (${route})`);
    }
  });
  return offenders;
}

function auditArtifacts(window, route) {
  const found = [];
  ARTIFACTS.forEach((artifact) => {
    if (window.document.body.innerHTML.includes(artifact)) found.push(`${artifact} (${route})`);
  });
  return found;
}

function makeDom(base, { legacy = false, seedState = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
    url: `${base}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  if (seedState) {
    window.localStorage.setItem("bp-learning-path-v1", JSON.stringify({
      objective: COURSE.objective,
      status: "ready",
      course: COURSE,
      lessons: { m1: LESSON },
      completedLessons: {},
    }));
  }
  const jar = new Map();
  const errors = [];
  window.addEventListener("error", (event) => errors.push(event.message || "window error"));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason && event.reason.message || event.reason)));
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), base).toString();
    if (legacy && /\/api\/me|\/api\/auth\/config/.test(url)) {
      return new Response(JSON.stringify({ error: { code: "DB_UNAVAILABLE", message: "La base de données est momentanément indisponible." } }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    const headers = { ...(options.headers || {}) };
    const cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    headers.Connection = "close";
    const response = await fetch(url, { ...options, headers });
    if (response.headers.getSetCookie) {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(";");
        const separator = pair.indexOf("=");
        if (separator === -1) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (!value) jar.delete(name);
        else jar.set(name, value);
      }
    }
    return response;
  };
  window.eval(fs.readFileSync(path.join(ROOT, "icons.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "fixtures.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "platform.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
  return { dom, window, errors };
}

async function settle(ms = 100) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await settle(50);
  }
  return predicate();
}

async function visit(window, hash, opts = {}) {
  if (window.location.hash === hash) {
    window.location.hash = hash === "#/" ? "#" : hash;
  }
  window.location.hash = hash;
  await settle(opts.extra || 200);
}

async function register(window, emailPrefix, isAdmin = false) {
  await visit(window, "#/register");
  await waitFor(() => window.document.querySelector('[data-auth-form="register"]'));
  const form = window.document.querySelector('[data-auth-form="register"]');
  form.querySelector('[name="firstName"]').value = isAdmin ? "Adm" : "User";
  form.querySelector('[name="lastName"]').value = "Audit";
  form.querySelector('[name="email"]').value = `${emailPrefix}.${Date.now()}.${Math.floor(Math.random() * 9999)}@example.com`;
  form.querySelector('[name="password"]').value = "MotDePasse-Audit-1!";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.location.hash === "#/app");
}

let base;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
});

after(async () => {
  await stopTestServer();
});

test("guest: every public route renders visibly without errors or dead buttons", async () => {
  const { dom, window, errors } = makeDom(base);
  const routes = ["#/", "#/login", "#/register", "#/forgot-password", "#/verify-email?token=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"];
  for (const hash of routes) {
    await visit(window, hash, { extra: 250 });
    const platform = window.document.querySelector('[data-view="platform"]');
    assert.equal(platform.hidden, false, `${hash}: platform section must be visible`);
    assert.equal(errors.length, 0, `${hash}: JS errors ${errors.join(" | ")}`);
    const offenders = auditButtons(window, hash);
    assert.deepEqual(offenders, [], `${hash}: dead controls`);
    assert.deepEqual(auditArtifacts(window, hash), [], `${hash}: artifacts`);
  }
  dom.window.close();
});

test("guest: reset-password link with token renders the reset page (not bounced)", async () => {
  const { dom, window, errors } = makeDom(base);
  await visit(window, "#/reset-password?token=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", { extra: 250 });
  assert.equal(window.location.hash, "#/reset-password?token=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  const platform = window.document.querySelector('[data-view="platform"]');
  assert.equal(platform.hidden, false, "reset page must stay visible");
  assert.match(platform.innerHTML, /Nouveau mot de passe/);
  assert.equal(errors.length, 0);
  dom.window.close();
});

test("guest: learning route redirects to login which stays visible", async () => {
  const { dom, window, errors } = makeDom(base);
  await visit(window, "#parcours", { extra: 250 });
  assert.equal(window.location.hash, "#/login");
  const platform = window.document.querySelector('[data-view="platform"]');
  assert.equal(platform.hidden, false, "login must be visible after redirect");
  assert.match(platform.innerHTML, /Se connecter/);
  assert.equal(errors.length, 0);
  dom.window.close();
});

test("authed user: every app route renders without errors or dead buttons", async () => {
  const { dom, window, errors } = makeDom(base, { seedState: true });
  await settle(300);
  await register(window, "user.audit");
  const routes = [
    { hash: "#/app", type: "platform" },
    { hash: "#/profile", type: "platform" },
    { hash: "#accueil", type: "learning" },
    { hash: "#parcours", type: "learning" },
    { hash: "#parcours-detail", type: "learning" },
    { hash: "#simulations", type: "learning" },
    { hash: "#progression", type: "learning" },
    { hash: "#lecon", type: "learning" },
    { hash: "#start", type: "learning" },
    { hash: "#vorbereitung", type: "learning" },
    { hash: "#simulation", type: "learning" },
    { hash: "#abschluss", type: "learning" },
    { hash: "#lernplan", type: "learning" },
  ];
  for (const entry of routes) {
    const hash = entry.hash;
    await visit(window, hash, { extra: 400 });
    const platform = window.document.querySelector('[data-view="platform"]');
    const routeName = hash.slice(1).split("?")[0];
    if (entry.type === "platform") {
      assert.equal(platform.hidden, false, `${hash}: platform section must be visible`);
    } else {
      const view = window.document.querySelector(`[data-view="${routeName}"]`);
      assert.equal(view && view.hidden, false, `${hash}: learning view must be visible`);
      assert.equal(platform.hidden, true, `${hash}: platform section must be hidden`);
    }
    assert.equal(errors.length, 0, `${hash}: JS errors ${errors.join(" | ")}`);
    const offenders = auditButtons(window, hash);
    assert.deepEqual(offenders, [], `${hash}: dead controls`);
    assert.deepEqual(auditArtifacts(window, hash), [], `${hash}: artifacts`);
  }
  dom.window.close();
});

test("non-admin: /admin routes show a visible 403", async () => {
  const { dom, window, errors } = makeDom(base);
  await settle(300);
  await register(window, "nonadmin.audit");
  await visit(window, "#/admin", { extra: 250 });
  const platform = window.document.querySelector('[data-view="platform"]');
  assert.equal(platform.hidden, false);
  assert.match(platform.innerHTML, /403/);
  assert.equal(errors.length, 0);
  dom.window.close();
});

test("admin: every admin route renders visibly without errors or dead buttons", async () => {
  const { dom, window, errors } = makeDom(base);
  await settle(300);
  require("../server/app").config.adminEmails = ["admin.audit@example.com"];
  await register(window, "admin.audit", true);
  const routes = ["#/admin", "#/admin/users", "#/admin/courses", "#/admin/assignments", "#/admin/messages", "#/admin/performance", "#/admin/settings"];
  for (const hash of routes) {
    await visit(window, hash, { extra: 500 });
    const platform = window.document.querySelector('[data-view="platform"]');
    assert.equal(platform.hidden, false, `${hash}: platform section must be visible`);
    assert.equal(errors.length, 0, `${hash}: JS errors ${errors.join(" | ")}`);
    const offenders = auditButtons(window, hash);
    assert.deepEqual(offenders, [], `${hash}: dead controls`);
    assert.deepEqual(auditArtifacts(window, hash), [], `${hash}: artifacts`);
  }
  dom.window.close();
});

test("legacy mode: landing banner, learning routes, and db-down notices", async () => {
  const { dom, window, errors } = makeDom(base, { legacy: true, seedState: true });
  await settle(400);
  const platform = window.document.querySelector('[data-view="platform"]');
  assert.equal(platform.hidden, false);
  assert.match(platform.innerHTML, /Mode démonstration sans compte/);

  await visit(window, "#/login", { extra: 200 });
  assert.match(window.document.querySelector('[data-view="platform"]').innerHTML, /base de données n’est pas configurée/);

  await visit(window, "#parcours", { extra: 300 });
  const parcours = window.document.querySelector('[data-view="parcours"]');
  assert.equal(parcours.hidden, false, "legacy learning route must render");
  assert.equal(errors.length, 0, `legacy JS errors: ${errors.join(" | ")}`);
  assert.deepEqual(auditButtons(window, "#parcours"), []);
  dom.window.close();
});

test("landing showcase tabs switch panels and CTAs behave", async () => {
  const { dom, window, errors } = makeDom(base);
  await settle(400);
  assert.match(window.document.querySelector('[data-view="platform"]').innerHTML, /Apprenez/);
  const activate = () => {
    const tab = window.document.querySelector('[data-showcase="simuler"]');
    if (tab) tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    const panel = window.document.querySelector('[data-panel="simuler"]');
    return Boolean(panel && panel.classList.contains("active"));
  };
  assert.ok(await waitFor(activate), "clicking Simuler should activate its panel");
  assert.equal(window.document.querySelector('[data-showcase="simuler"]').getAttribute("aria-selected"), "true");
  const scrollCta = window.document.querySelector('[data-scroll="showcase"]');
  assert.ok(scrollCta, "landing has a scroll CTA");
  scrollCta.click();
  await settle(150);
  assert.deepEqual(errors, [], `JS errors: ${errors.join(" | ")}`);
  dom.window.close();
});

test("dashboard: continue button deep-links to the lesson (one click resume)", async () => {
  const { dom, window, errors } = makeDom(base, { seedState: true });
  await settle(300);
  await register(window, "resume.audit");
  await visit(window, "#/app", { extra: 400 });
  await waitFor(() => window.document.querySelector("[data-continue-course]"), 8000);
  const continueButton = window.document.querySelector("[data-continue-course]");
  assert.ok(continueButton, "continue card should appear (after migration re-render)");
  continueButton.click();
  await settle(400);
  assert.equal(window.location.hash, "#lecon", "continue should open the lesson directly");
  const lecon = window.document.querySelector('[data-view="lecon"]');
  assert.equal(lecon.hidden, false);
  assert.match(lecon.innerHTML, /Analyser le besoin avant de recommander/);
  assert.equal(errors.length, 0);
  dom.window.close();
});
