"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { startTestServer, stopTestServer } = require("./helpers");

const ROOT = path.join(__dirname, "..", "public");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const fixturesJs = fs.readFileSync(path.join(ROOT, "fixtures.js"), "utf8");
const platformJs = fs.readFileSync(path.join(ROOT, "platform.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

let base;
let dom;
let window;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  dom = new JSDOM(indexHtml, {
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
  window.eval(fixturesJs);
  window.eval(platformJs);
  window.eval(appJs);
});

after(async () => {
  if (dom) dom.window.close();
  await stopTestServer();
});

async function settle(ms = 120) {
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

async function verifyRegisteredEmail(email) {
  const resend = await fetch(`${base}/api/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await resend.json();
  const token = data.devVerifyUrl.split("token=")[1];
  window.location.hash = `#/verify-email?token=${token}`;
  await waitFor(() => {
    const user = window.BP_PLATFORM && window.BP_PLATFORM.getUser();
    return user && user.emailVerified === true;
  }, 4000);
}

test("guest lands on the public landing page", async () => {
  await settle();
  const section = window.document.querySelector('[data-view="platform"]');
  assert.equal(section.hidden, false);
  assert.match(section.innerHTML, /Se connecter/);
  assert.match(section.innerHTML, /Créer un compte/);
  assert.match(section.innerHTML, /officine/i);
});

test("guest navigating to a learning route is redirected to login", async () => {
  window.location.hash = "#parcours";
  await settle(250);
  assert.equal(window.location.hash, "#/login");
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Se connecter/);
});

test("guest can register and lands on the dashboard", async () => {
  window.location.hash = "#/register";
  window.sessionStorage.removeItem("bp-next-route");
  await waitFor(() => window.document.querySelector('[data-auth-form="register"]'));
  const section = window.document.querySelector('[data-view="platform"]');
  const form = section.querySelector('[data-auth-form="register"]');
  form.querySelector('[name="firstName"]').value = "Leila";
  form.querySelector('[name="lastName"]').value = "Smoke";
  const email = `leila.${Date.now()}@example.com`;
  form.querySelector('[name="email"]').value = email;
  form.querySelector('[name="password"]').value = "MotDePasse-Smoke-1!";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.location.hash === "#/app");
  assert.equal(window.location.hash, "#/app");
  await verifyRegisteredEmail(email);
  window.location.hash = "#/app";
  await waitFor(() => /Bonjour, Leila/.test(section.innerHTML));
  assert.match(section.innerHTML, /Bonjour, Leila/);
});

test("dashboard renders user data from the API", async () => {
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Continuer mon parcours/);
  assert.match(section.innerHTML, /Faire une simulation/);
  const nav = window.document.querySelector("[data-nav]");
  assert.match(nav.innerHTML, /Tableau de bord/);
  assert.match(nav.innerHTML, /Mon parcours/);
  const authArea = window.document.querySelector("[data-auth-area]");
  assert.match(authArea.innerHTML, /Se déconnecter/);
});

test("profile page loads and updates", async () => {
  window.location.hash = "#/profile";
  await waitFor(() => window.document.querySelector("[data-profile-form]"));
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Mon profil/);
  assert.match(section.innerHTML, /Mot de passe/);
  const form = section.querySelector("[data-profile-form]");
  form.querySelector('[name="firstName"]').value = "Leyla";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => /Leyla/.test(window.document.querySelector("[data-auth-area]").innerHTML));
  const authArea = window.document.querySelector("[data-auth-area]");
  assert.match(authArea.innerHTML, /Leyla/);
});

test("learning route is accessible when authenticated", async () => {
  window.location.hash = "#parcours";
  await settle(250);
  assert.equal(window.location.hash, "#parcours");
  const view = window.document.querySelector('[data-view="parcours"]');
  assert.equal(view.hidden, false);
});

test("non-admin user gets forbidden page on admin routes", async () => {
  window.location.hash = "#/admin";
  await settle(300);
  assert.equal(window.location.hash, "#/admin");
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /403/);
});

test("logout returns to the landing page", async () => {
  const button = window.document.querySelector("[data-logout]");
  assert.ok(button, "logout button should exist");
  button.click();
  await settle(400);
  assert.equal(window.location.hash, "#/");
  const section = window.document.querySelector('[data-view="platform"]');
  assert.match(section.innerHTML, /Se connecter/);
  const nav = window.document.querySelector("[data-nav]");
  assert.match(nav.innerHTML, /data-scroll/, "guest nav shows landing scroll links");
  const authArea = window.document.querySelector("[data-auth-area]");
  assert.match(authArea.innerHTML, /Se connecter/);
  assert.match(authArea.innerHTML, /Créer un compte|Commencer/);
});
