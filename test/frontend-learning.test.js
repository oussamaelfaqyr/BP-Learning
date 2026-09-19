"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { startTestServer, stopTestServer } = require("./helpers");

const ROOT = path.join(__dirname, "..", "public");

const COURSE = {
  title: "Conseil en dermocosmétique",
  objective: "Mieux conseiller les produits de soin au comptoir",
  estimatedDuration: "Environ 30 minutes",
  modules: [
    { id: "m1", title: "Analyser le besoin", description: "Poser les bonnes questions" },
    { id: "m2", title: "Proposer une recommandation", description: "Choisir le bon produit" },
    { id: "m3", title: "Expliquer la valeur", description: "Relier le produit au besoin" },
    { id: "m4", title: "Mise en pratique", description: "Simuler une situation client" },
  ],
};

const LESSON = {
  lessonTitle: "Analyser le besoin avant de recommander",
  objective: "Savoir poser les bonnes questions avant de proposer un produit",
  sections: [
    { type: "concept", title: "Pourquoi questionner d’abord ?", content: "Avant de recommander un produit, il faut comprendre la situation de la personne : son besoin, son contexte, ses contraintes." },
    { type: "example", title: "Exemple au comptoir", situation: "Bonjour, je ne sais pas trop lequel de ces soins choisir…", response: "Puis-je vous demander ce que vous recherchez exactement ?" },
    { type: "key_points", title: "À retenir", items: ["Poser une question ouverte", "Écouter sans interrompre", "Reformuler le besoin"] },
    { type: "question", title: "À vous de jouer", question: "Quelle question est la plus adaptée pour comprendre le besoin ?", options: ["Que recherchez-vous exactement pour votre peau ?", "Vous voulez celui-là ?", "C’est pour vous ou pour offrir ?"] },
  ],
};

const EVALUATION = {
  overall: "Bon accueil : vous avez bien demandé le besoin et reformulé. La valeur du produit reste à expliquer plus clairement.",
  criteria: [
    { id: "besoin", label: "Comprendre le besoin", score: 85, status: "acquis", evidence: "Vous avez posé une question ouverte dès le début.", improvement: "Continuez ainsi." },
    { id: "recommandation", label: "Recommandation pertinente", score: 60, status: "a_renforcer", evidence: "Vous avez proposé un produit sans le relier au besoin exprimé.", improvement: "Reliez toujours le produit au besoin de la personne." },
    { id: "clarte", label: "Clarté de l’explication", score: 45, status: "a_renforcer", evidence: "L’explication contenait plusieurs informations d’un coup.", improvement: "Expliquez une idée à la fois." },
    { id: "limites", label: "Respect des limites", score: 90, status: "acquis", evidence: "Vous avez orienté la question de santé vers le pharmacien.", improvement: "Continuez ainsi." },
  ],
  priority: "clarte",
  next_practice: "Expliquer le produit en une idée à la fois, avec un exemple concret.",
};

let base;
let dom;
let window;

before(async () => {
  ({ baseUrl: base } = await startTestServer());
  dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
    url: `http://127.0.0.1:${process.env.PORT}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  window = dom.window;
  window.localStorage.setItem("bp-learning-path-v1", JSON.stringify({
    objective: COURSE.objective,
    status: "ready",
    course: COURSE,
    lessons: { m1: LESSON },
    completedLessons: {},
  }));
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
  window.eval(fs.readFileSync(path.join(ROOT, "icons.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "fixtures.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "platform.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
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

async function registerAsLearner() {
  window.location.hash = "#/register";
  await waitFor(() => window.document.querySelector('[data-auth-form="register"]'));
  const form = window.document.querySelector('[data-auth-form="register"]');
  form.querySelector('[name="firstName"]').value = "Salma";
  form.querySelector('[name="lastName"]').value = "Test";
  form.querySelector('[name="email"]').value = `salma.${Date.now()}@example.com`;
  form.querySelector('[name="password"]').value = "MotDePasse-Test-1!";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.location.hash === "#/app");
}

test("learning path shows module nodes with states", async () => {
  await settle(300);
  await registerAsLearner();
  window.location.hash = "#parcours-detail";
  await settle(300);
  const view = window.document.querySelector('[data-view="parcours-detail"]');
  assert.equal(view.hidden, false);
  const nodes = view.querySelectorAll(".module-node");
  assert.equal(nodes.length, 4);
  assert.match(view.innerHTML, /Conseil en dermocosmétique/);
  assert.match(view.innerHTML, /Objectif → leçons → mise en pratique/);
  assert.match(view.innerHTML, /Mise en pratique/);
});

test("opening a module shows the lesson environment with outline and coach", async () => {
  window.location.hash = "#parcours-detail";
  await settle(250);
  const view = window.document.querySelector('[data-view="parcours-detail"]');
  view.querySelector('[data-path-open-lesson="m1"]').click();
  await settle(400);
  const lessonView = window.document.querySelector('[data-view="lecon"]');
  assert.equal(lessonView.hidden, false);
  assert.match(lessonView.innerHTML, /Analyser le besoin avant de recommander/);
  assert.match(lessonView.innerHTML, /Module 1 sur 4/);
  assert.ok(lessonView.querySelector(".lesson-outline"), "outline should be present");
  assert.ok(lessonView.querySelector(".coach-panel"), "coach panel should be present");
  assert.match(lessonView.innerHTML, /Exemple au comptoir/);
  assert.match(lessonView.innerHTML, /À retenir/);
  assert.match(lessonView.innerHTML, /À vous de jouer/);
});

test("lesson sections render distinct visual blocks", async () => {
  const view = window.document.querySelector('[data-view="lecon"]');
  assert.ok(view.querySelector(".section-block.example"), "example block");
  assert.ok(view.querySelector(".key-points"), "key points block");
  assert.ok(view.querySelector(".exercise-box"), "exercise block");
});

test("coach panel collapses and reopens", async () => {
  const view = window.document.querySelector('[data-view="lecon"]');
  const toggle = view.querySelector("[data-coach-toggle]");
  toggle.click();
  await settle(150);
  const collapsed = window.document.querySelector('[data-view="lecon"]');
  assert.ok(collapsed.querySelector(".lesson-shell.coach-collapsed"), "coach should collapse");
  assert.ok(collapsed.querySelector("[data-coach-open]"), "float button should appear");
  collapsed.querySelector("[data-coach-open]").click();
  await settle(150);
  assert.ok(window.document.querySelector('[data-view="lecon"] .coach-panel'));
});

test("coach question shows a visible error when the AI is unreachable", async () => {
  const view = window.document.querySelector('[data-view="lecon"]');
  const input = view.querySelector("[data-tutor-input]");
  input.value = "Test";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  view.querySelector("[data-tutor-form]").dispatchEvent(new window.Event("submit", { bubbles: true }));
  await waitFor(() => /Réessayer/.test(window.document.querySelector('[data-view="lecon"]').innerHTML), 6000);
  const lessonView = window.document.querySelector('[data-view="lecon"]');
  assert.match(lessonView.innerHTML, /Réessayer/);
});

test("submitting an exercise shows visible feedback when the AI is unreachable", async () => {
  const view = window.document.querySelector('[data-view="lecon"]');
  view.querySelector('[data-path-answer="0"]').click();
  await waitFor(() => {
    const lessonView = window.document.querySelector('[data-view="lecon"]');
    return lessonView.querySelectorAll("[data-path-answer]").length >= 3;
  }, 6000);
  const lessonView = window.document.querySelector('[data-view="lecon"]');
  assert.match(lessonView.innerHTML, /Réessayer|Le service IA/);
  assert.ok(lessonView.querySelectorAll("[data-path-answer]").length >= 3, "answers should still be visible to retry");
});

test("completing the lesson reveals the next-step card", async () => {
  const view = window.document.querySelector('[data-view="lecon"]');
  view.querySelector("[data-path-complete]").click();
  await settle(200);
  const lessonView = window.document.querySelector('[data-view="lecon"]');
  assert.match(lessonView.innerHTML, /Vous avez terminé cette leçon/);
  assert.match(lessonView.innerHTML, /Leçon suivante/);
});

test("simulation hub lists scenarios and the simulation environment opens", async () => {
  window.location.hash = "#simulations";
  await waitFor(() => window.document.querySelectorAll("[data-sim-scenario]").length > 0);
  const hub = window.document.querySelector('[data-view="simulations"]');
  assert.match(hub.innerHTML, /Mise en pratique/);
  assert.ok(hub.querySelector(".scenario-card"));
  hub.querySelector('[data-sim-scenario="communication"]').click();
  await settle(350);
  const simView = window.document.querySelector('[data-view="ia"]');
  assert.equal(simView.hidden, false);
  assert.match(simView.innerHTML, /Communication avec un client/);
  assert.ok(simView.querySelector(".sim-aside"));
  assert.ok(simView.querySelector("[data-ai-start]"));
});

test("starting the simulation without AI shows a recovery panel", async () => {
  const view = window.document.querySelector('[data-view="ia"]');
  view.querySelector("[data-ai-start]").click();
  await settle(800);
  const simView = window.document.querySelector('[data-view="ia"]');
  assert.match(simView.innerHTML, /Réessayer/);
  assert.ok(simView.querySelector("[data-ai-retry]"));
});

test("simulation result screen presents criteria, priority and targeted practice", async () => {
  const resultDom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), {
    url: `http://127.0.0.1:${process.env.PORT}/`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const resultWindow = resultDom.window;
  resultWindow.localStorage.setItem("bp-learning-path-v1", JSON.stringify({
    objective: COURSE.objective,
    status: "ready",
    course: COURSE,
    lessons: { m1: LESSON },
    completedLessons: {},
  }));
  resultWindow.localStorage.setItem("bp-ai-simulation-v1", JSON.stringify({
    scenarioId: "conseil-produit",
    status: "complete",
    messages: [
      { role: "assistant", content: "Bonjour, je ne sais pas trop lequel choisir…" },
      { role: "user", content: "Que recherchez-vous exactement pour votre peau ?" },
    ],
    evaluation: { status: "done", data: EVALUATION },
    practiceTarget: null,
  }));
  const jar = new Map();
  resultWindow.fetch = async (input, options = {}) => {
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
  resultWindow.eval(fs.readFileSync(path.join(ROOT, "icons.js"), "utf8"));
  resultWindow.eval(fs.readFileSync(path.join(ROOT, "fixtures.js"), "utf8"));
  resultWindow.eval(fs.readFileSync(path.join(ROOT, "platform.js"), "utf8"));
  resultWindow.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));
  await settle(400);
  resultWindow.location.hash = "#/register";
  await waitFor(() => resultWindow.document.querySelector('[data-auth-form="register"]'));
  const form = resultWindow.document.querySelector('[data-auth-form="register"]');
  form.querySelector('[name="firstName"]').value = "Yassine";
  form.querySelector('[name="lastName"]').value = "Result";
  form.querySelector('[name="email"]').value = `yassine.${Date.now()}@example.com`;
  form.querySelector('[name="password"]').value = "MotDePasse-Result-1!";
  form.dispatchEvent(new resultWindow.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => resultWindow.location.hash === "#/app");
  resultWindow.location.hash = "#ia";
  await settle(400);
  const simView = resultWindow.document.querySelector('[data-view="ia"]');
  assert.match(simView.innerHTML, /Votre performance/);
  assert.match(simView.innerHTML, /Ce qui s’est passé, et quoi travailler ensuite/);
  assert.ok(simView.querySelectorAll(".criterion-card").length >= 4);
  assert.match(simView.innerHTML, /Suite recommandée/);
  assert.match(simView.innerHTML, /Travailler ce point/);
  assert.ok(simView.querySelector(".score-ring"));
  resultDom.window.close();
});

test("progress page aggregates metrics and skills from the server", async () => {
  window.location.hash = "#progression";
  await waitFor(() => /Compétences/.test(window.document.querySelector('[data-view="progression"]').innerHTML));
  const view = window.document.querySelector('[data-view="progression"]');
  assert.match(view.innerHTML, /Votre progression/);
  assert.ok(view.querySelector(".metric-tile"));
  assert.match(view.innerHTML, /Points à renforcer/);
});

test("parcours page renders the list with search", async () => {
  window.location.hash = "#parcours";
  await waitFor(() => window.document.querySelector("[data-formations-search]"));
  const view = window.document.querySelector('[data-view="parcours"]');
  assert.match(view.innerHTML, /Mes parcours/);
  assert.ok(view.querySelector("[data-formations-search]"));
  assert.ok(view.querySelector(".course-card"));
});
