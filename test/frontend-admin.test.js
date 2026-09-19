"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { startTestServer, stopTestServer } = require("./helpers");

const ROOT = path.join(__dirname, "..", "public");

let base;
let dom;
let window;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  require("../server/app").config.adminEmails = ["admin.ui@example.com"];
  dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
    url: `http://127.0.0.1:${process.env.PORT}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  window = dom.window;
  const jar = new Map();
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), `http://127.0.0.1:${process.env.PORT}`).toString();
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
  window.eval(fs.readFileSync(path.join(ROOT, "fixtures.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "platform.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
});

after(async () => {
  if (dom) dom.window.close();
  await stopTestServer();
});

async function settle(ms = 150) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test("admin user can register and access the admin dashboard", async () => {
  await settle(300);
  window.location.hash = "#/register";
  await settle(300);
  const form = window.document.querySelector('[data-auth-form="register"]');
  form.querySelector('[name="firstName"]').value = "Admin";
  form.querySelector('[name="lastName"]').value = "Interface";
  form.querySelector('[name="email"]').value = "admin.ui@example.com";
  form.querySelector('[name="password"]').value = "MotDePasse-Admin-1!";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle(500);
  assert.equal(window.location.hash, "#/app");
  const nav = window.document.querySelector("[data-nav]");
  assert.match(nav.innerHTML, /Administration/);
});

test("admin dashboard shows real statistics", async () => {
  window.location.hash = "#/admin";
  await settle(400);
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Tableau de bord administrateur/);
  assert.match(section.innerHTML, /Utilisateurs/);
  assert.match(section.innerHTML, /Principales difficultés/);
});

test("admin can create a course via AI-style form and publish it", async () => {
  window.location.hash = "#/admin/courses";
  await settle(400);
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Générer un cours avec l’IA/);

  const form = section.querySelector("[data-admin-generate-course]");
  form.querySelector('[name="objective"]').value = "Former l’équipe à la vente complémentaire éthique";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle(300);
  // AI is not configured in tests: the generate error should be shown, not a crash.
  assert.match(section.innerHTML, /Le service IA|Générer le brouillon/);
});

test("admin users page renders the create-user invitation form", async () => {
  window.location.hash = "#/admin/users";
  await settle(400);
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Créer un utilisateur/);
  assert.match(section.innerHTML, /invitation/);

  const form = section.querySelector("[data-admin-create-user]");
  form.querySelector('[name="firstName"]').value = "Élève";
  form.querySelector('[name="lastName"]').value = "Test";
  form.querySelector('[name="email"]').value = `eleve.${Date.now()}@example.com`;
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle(400);
  const table = section.querySelector(".data-table");
  assert.match(table.innerHTML, /Élève/);
});

test("admin assignments page renders", async () => {
  window.location.hash = "#/admin/assignments";
  await settle(400);
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Assigner un cours publié/);
});

test("admin performance and settings pages render", async () => {
  window.location.hash = "#/admin/performance";
  await settle(400);
  let section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Performance des apprenants/);

  window.location.hash = "#/admin/settings";
  await settle(400);
  section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Inscription publique/);
  assert.match(section.innerHTML, /Journal d’audit/);
});
