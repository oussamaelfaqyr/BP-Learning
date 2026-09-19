(() => {
  "use strict";

  const DATA = window.BP_FIXTURES;
  const ICON = (name, className = "icon") => (window.BP_ICONS ? window.BP_ICONS.icon(name, className) : "");
  const ROUTES = new Set(["start", "vorbereitung", "simulation", "ia", "abschluss", "lernplan", "accueil", "parcours", "parcours-detail", "formations", "simulations", "progression", "lecon"]);
  const STORE_KEY = "bp-historic-frontend-morocco-fr-v1";
  const defaultState = {
    prep: [],
    dialogueStep: 0,
    dialogueAnswers: [],
    quizAnswers: {},
  };
  const AI_STORE_KEY = "bp-ai-simulation-v1";
  const AI_MAX_TURNS = 4;
  const AI_STATUSES = ["idle", "starting", "waiting", "active", "complete", "error"];
  const defaultAiState = { scenarioId: "communication", messages: [], draft: "", status: "idle", error: null, evaluation: null, practiceTarget: null, previousEvaluation: null };
  const PATH_STORE_KEY = "bp-learning-path-v1";

  function freshPathState() {
    return {
      objective: "",
      status: "idle",
      course: null,
      error: null,
      activeModuleId: null,
      activeCourseId: null,
      lessons: {},
      lessonLoading: {},
      completedLessons: {},
      tutor: {},
      tutorBusy: false,
      tutorError: null,
      quizBusy: false,
      quizResults: {},
      recommendation: null,
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return { ...defaultState };
      const prepIds = new Set(DATA.preparation.map((item) => item.id));
      const prep = Array.isArray(parsed.prep) ? [...new Set(parsed.prep.filter((id) => prepIds.has(id)))] : [];
      const dialogueAnswers = [];
      if (Array.isArray(parsed.dialogueAnswers)) {
        for (let index = 0; index < DATA.dialogue.length; index += 1) {
          const answer = parsed.dialogueAnswers[index];
          const choiceCount = DATA.dialogue[index].choices.length;
          if (!Number.isInteger(answer) || answer < 0 || answer >= choiceCount) break;
          dialogueAnswers.push(answer);
        }
      }
      const quizAnswers = {};
      if (parsed.quizAnswers && typeof parsed.quizAnswers === "object" && !Array.isArray(parsed.quizAnswers)) {
        DATA.learningModules.forEach((module) => {
          const answer = parsed.quizAnswers[module.id];
          if (Number.isInteger(answer) && answer >= 0 && answer < module.answers.length) quizAnswers[module.id] = answer;
        });
      }
      return { prep, dialogueAnswers, dialogueStep: dialogueAnswers.length, quizAnswers };
    } catch {
      return { ...defaultState };
    }
  }

  function loadAiState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(AI_STORE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return { ...defaultAiState };
      const messages = [];
      if (Array.isArray(parsed.messages)) {
        parsed.messages.slice(0, 40).forEach((message) => {
          if (!message || typeof message !== "object") return;
          if (message.role !== "user" && message.role !== "assistant") return;
          if (typeof message.content !== "string" || !message.content.trim()) return;
          messages.push({ role: message.role, content: message.content.slice(0, 4000) });
        });
      }
      let status = AI_STATUSES.includes(parsed.status) ? parsed.status : "idle";
      if (status === "waiting" || status === "starting") status = messages.length ? "active" : "idle";
      const draft = typeof parsed.draft === "string" ? parsed.draft.slice(0, 2000) : "";
      let error =
        parsed.error && typeof parsed.error.message === "string"
          ? { code: typeof parsed.error.code === "string" ? parsed.error.code : "ai_error", message: parsed.error.message.slice(0, 300) }
          : null;
      if (status === "active" && messages.length && messages[messages.length - 1].role === "user") {
        status = "error";
        if (!error) error = { code: "ai_error", message: "La conversation a été interrompue. Votre réponse est conservée : vous pouvez réessayer." };
      }
      const evaluation = parsed.evaluation && typeof parsed.evaluation === "object" ? parsed.evaluation : null;
      let restoredEvaluation = null;
      if (evaluation && evaluation.status === "done" && isValidAiEvaluation(evaluation.data)) {
        restoredEvaluation = { status: "done", data: evaluation.data, error: null };
      } else if (evaluation && evaluation.status === "error" && evaluation.error && typeof evaluation.error === "object") {
        restoredEvaluation = {
          status: "error",
          data: null,
          error: {
            code: typeof evaluation.error.code === "string" ? evaluation.error.code : "ai_error",
            message: typeof evaluation.error.message === "string" ? evaluation.error.message.slice(0, 300) : aiErrorMessage("ai_error"),
          },
        };
      }
      const practiceTarget = typeof parsed.practiceTarget === "string" && parsed.practiceTarget ? parsed.practiceTarget.slice(0, 40) : null;
      const scenarioId = typeof parsed.scenarioId === "string" && parsed.scenarioId ? parsed.scenarioId.slice(0, 40) : "communication";
      const previousEvaluation = parsed.previousEvaluation && isValidAiEvaluation(parsed.previousEvaluation) ? parsed.previousEvaluation : null;
      return { scenarioId, messages, draft, status, error, evaluation: restoredEvaluation, practiceTarget, previousEvaluation };
    } catch {
      return { ...defaultAiState };
    }
  }

  function saveAiState() {
    try {
      localStorage.setItem(AI_STORE_KEY, JSON.stringify(aiState));
    } catch {
      /* storage unavailable: keep the in-memory session */
    }
  }

  function isValidAiEvaluation(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (typeof value.overall !== "string" || typeof value.priority !== "string" || typeof value.next_practice !== "string") return false;
    if (!Array.isArray(value.criteria) || value.criteria.length === 0) return false;
    return value.criteria.every((criterion) =>
      criterion && typeof criterion === "object" &&
      typeof criterion.id === "string" &&
      typeof criterion.label === "string" &&
      typeof criterion.score === "number" &&
      typeof criterion.status === "string" &&
      typeof criterion.evidence === "string" &&
      typeof criterion.improvement === "string"
    );
  }

  function loadPathState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PATH_STORE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return freshPathState();
      const course =
        parsed.course && typeof parsed.course === "object" && typeof parsed.course.title === "string" && Array.isArray(parsed.course.modules)
          ? {
              title: String(parsed.course.title).slice(0, 200),
              objective: typeof parsed.course.objective === "string" ? parsed.course.objective.slice(0, 500) : "",
              estimatedDuration: typeof parsed.course.estimatedDuration === "string" ? parsed.course.estimatedDuration.slice(0, 60) : "",
              thumbnail:
                parsed.course.thumbnail && typeof parsed.course.thumbnail === "object" && typeof parsed.course.thumbnail.label === "string"
                  ? {
                      label: String(parsed.course.thumbnail.label).slice(0, 40),
                      from: typeof parsed.course.thumbnail.from === "string" ? parsed.course.thumbnail.from : "",
                      to: typeof parsed.course.thumbnail.to === "string" ? parsed.course.thumbnail.to : "",
                      iconPath: typeof parsed.course.thumbnail.iconPath === "string" ? parsed.course.thumbnail.iconPath : "",
                    }
                  : null,
              modules: parsed.course.modules
                .filter((module) => module && typeof module.id === "string" && typeof module.title === "string")
                .slice(0, 5)
                .map((module) => ({
                  id: String(module.id),
                  title: String(module.title),
                  description: typeof module.description === "string" ? module.description : "",
                  image:
                    module.image && typeof module.image === "object" && typeof module.image.url === "string" && typeof module.image.alt === "string"
                      ? { url: String(module.image.url), alt: String(module.image.alt).slice(0, 200) }
                      : null,
                })),
            }
          : null;
      const lessons = {};
      if (parsed.lessons && typeof parsed.lessons === "object") {
        Object.keys(parsed.lessons).slice(0, 10).forEach((id) => {
          const lesson = parsed.lessons[id];
          if (lesson && typeof lesson.lessonTitle === "string" && Array.isArray(lesson.sections)) lessons[id] = lesson;
        });
      }
      const completedLessons = {};
      if (parsed.completedLessons && typeof parsed.completedLessons === "object") {
        Object.keys(parsed.completedLessons).forEach((id) => {
          if (parsed.completedLessons[id] === true) completedLessons[id] = true;
        });
      }
      const tutor = {};
      if (parsed.tutor && typeof parsed.tutor === "object") {
        Object.keys(parsed.tutor).slice(0, 10).forEach((id) => {
          if (Array.isArray(parsed.tutor[id])) {
            tutor[id] = parsed.tutor[id]
              .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
              .slice(0, 24);
          }
        });
      }
      const quizResults = {};
      if (parsed.quizResults && typeof parsed.quizResults === "object") {
        Object.keys(parsed.quizResults).forEach((id) => {
          if (parsed.quizResults[id] && typeof parsed.quizResults[id].explanation === "string") quizResults[id] = parsed.quizResults[id];
        });
      }
      let status = parsed.status === "ready" || parsed.status === "error" ? parsed.status : "idle";
      const error = parsed.error && typeof parsed.error.message === "string"
        ? { code: typeof parsed.error.code === "string" ? parsed.error.code : "ai_error", message: String(parsed.error.message).slice(0, 300) }
        : null;
      if (status === "error" && !error) status = "idle";
      const recommendation =
        parsed.recommendation && typeof parsed.recommendation.moduleId === "string"
          ? { moduleId: String(parsed.recommendation.moduleId), reason: typeof parsed.recommendation.reason === "string" ? parsed.recommendation.reason : "" }
          : null;
      return {
        objective: typeof parsed.objective === "string" ? parsed.objective.slice(0, 600) : "",
        status,
        course,
        error,
        activeModuleId: typeof parsed.activeModuleId === "string" ? parsed.activeModuleId : null,
        activeCourseId: typeof parsed.activeCourseId === "string" ? parsed.activeCourseId : null,
        lessons,
        lessonLoading: {},
        completedLessons,
        tutor,
        tutorBusy: false,
        tutorError: null,
        quizBusy: false,
        quizResults,
        recommendation,
      };
    } catch {
      return freshPathState();
    }
  }

  function savePathState() {
    try {
      localStorage.setItem(PATH_STORE_KEY, JSON.stringify(pathState));
    } catch {
      /* storage unavailable */
    }
  }

  let state = loadState();
  let aiState = loadAiState();
  let pathState = loadPathState();
  let aiFocus = null;
  const views = [...document.querySelectorAll("[data-view]")].filter((view) => view.dataset.view !== "platform");
  const toast = document.querySelector(".toast");

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function notify(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function routeFromHash() {
    let value = location.hash.replace(/^#/, "");
    if (value === "formations") value = "parcours";
    return ROUTES.has(value) ? value : "platform";
  }

  function progress() {
    const prep = state.prep.length / DATA.preparation.length;
    const dialogue = state.dialogueAnswers.length / DATA.dialogue.length;
    const quiz = Object.keys(state.quizAnswers).length / DATA.learningModules.length;
    return Math.round(((prep + dialogue + quiz) / 3) * 100);
  }

  function routeLink(route, label, kind = "button-primary") {
    return `<a class="button ${kind}" href="#${route}" data-route="${route}">${escapeHTML(label)}</a>`;
  }

  function renderStart() {
    const value = progress();
    const preparationComplete = state.prep.length === DATA.preparation.length;
    return `
      <div class="page-shell narrow">
        <div class="page-head-row">
          <div>
            <p class="eyebrow">${escapeHTML(DATA.course.eyebrow)}</p>
            <h1 id="start-title" tabindex="-1">${escapeHTML(DATA.course.title)}</h1>
            <p class="lede">${escapeHTML(DATA.course.description)}</p>
            <div class="course-meta" style="margin-top:.8rem"><span>${ICON("clock")}${escapeHTML(DATA.course.duration)}</span><span>${ICON("cap")}${escapeHTML(DATA.course.level)}</span><span>${ICON("user")}${escapeHTML(DATA.learner.context)}</span><span>${ICON("shield")}Scénario fictif</span></div>
          </div>
        </div>
        <div class="continue-card">
          <div>
            <p class="eyebrow" style="color:rgba(255,255,255,.75)">Votre progression</p>
            <h2>${value}%</h2>
            <p class="lede">Préparation · Dialogue · Vérifications — trois activités de même poids.</p>
            <div class="meter"><progress class="progress-track" max="100" value="${value}" aria-label="Progression globale : ${value} %"></progress><span class="meter-value" style="color:rgba(255,255,255,.85)">${value}%</span></div>
          </div>
          <div class="continue-actions">
            ${routeLink(preparationComplete ? "simulation" : "vorbereitung", preparationComplete ? "Continuer la formation" : "Commencer la formation", "button-primary")}
            ${routeLink("lernplan", "Voir ma progression", "button-secondary")}
          </div>
        </div>
        <div class="section-heading"><div><p class="eyebrow">Votre parcours</p><h2>Un parcours complet de communication</h2></div><span class="section-note">Progression enregistrée dans ce navigateur</span></div>
        <div class="card-grid">
          ${stageCard("01", "Préparation", "Trois principes de communication et une courte liste de préparation.", `${state.prep.length}/${DATA.preparation.length} préparés`, "vorbereitung", state.prep.length === DATA.preparation.length)}
          ${stageCard("02", "Simulation", "Un échange en trois étapes pour pratiquer vos réponses.", `${state.dialogueAnswers.length}/${DATA.dialogue.length} réponses`, "simulation", state.dialogueAnswers.length === DATA.dialogue.length)}
          ${stageCard("03", "Modules", "Trois vérifications courtes avec retour immédiat.", `${Object.keys(state.quizAnswers).length}/${DATA.learningModules.length} terminés`, "abschluss", Object.keys(state.quizAnswers).length === DATA.learningModules.length)}
        </div>
      </div>`;
  }

  function stageCard(number, title, body, status, route, done) {
    return `<article class="card ${done ? "active" : ""}"><div class="card-top"><span class="tag ${done ? "success" : ""}">${done ? `${ICON("checkCircle")}Terminé` : `Étape ${number}`}</span><span class="small subtle">${status}</span></div><h3>${title}</h3><p class="subtle">${body}</p><div class="button-row tight">${routeLink(route, done ? "Revoir" : "Ouvrir", "button-secondary button-sm")}</div></article>`;
  }

  function renderPreparation() {
    const allDone = state.prep.length === DATA.preparation.length;
    return `<div class="page-shell split-layout">
      <aside class="sidebar card"><p class="eyebrow">Étape 1</p><h2>Préparation</h2><p class="subtle">Lisez les trois points et indiquez que vous êtes prêt à les appliquer.</p><ol class="step-list">${DATA.preparation.map((item, index) => `<li><span class="step-dot">${index + 1}</span><span><b>${escapeHTML(item.title)}</b><br><span class="small">${state.prep.includes(item.id) ? `${ICON("checkCircle", "icon")}Prêt` : "ì faire"}</span></span></li>`).join("")}</ol></aside>
      <div>
        <p class="eyebrow">Communication en officine</p>
        <h1 id="prep-title" tabindex="-1">Se préparer à l’échange</h1>
        <p class="lede">Préparez trois habitudes utiles avant de commencer le scénario d’exercice dans un contexte marocain fictif.</p>
        <div aria-label="Liste de préparation">${DATA.preparation.map((item) => `<label class="card prep-card"><input type="checkbox" data-prep="${item.id}" ${state.prep.includes(item.id) ? "checked" : ""}/><span><strong>${escapeHTML(item.title)}</strong><br><span class="subtle">${escapeHTML(item.body)}</span></span></label>`).join("")}</div>
        <div class="button-row">${routeLink("start", "Retour à la vue d’ensemble", "button-secondary")}<button class="button button-primary" type="button" data-go-simulation ${allDone ? "" : "disabled"}>${ICON("play")}Démarrer la simulation</button></div>
        ${allDone ? "" : '<p class="small subtle">Validez les trois points pour démarrer la simulation.</p>'}
      </div>
    </div>`;
  }

  function renderTurnFeedback(turn, answer, index) {
    const isBest = answer === turn.best;
    const perChoice = Array.isArray(turn.choiceFeedback) ? turn.choiceFeedback[answer] : "";
    const label = isBest ? "Choix recommandé" : "ì améliorer";
    const tagClass = isBest ? "success" : "warning";
    const recommended = isBest ? "" : `<p class="small"><strong>Approche recommandée :</strong> « ${escapeHTML(turn.choices[turn.best])} »</p>`;
    const rationale = isBest ? "" : `<p class="small subtle">${escapeHTML(turn.feedback)}</p>`;
    return `<div class="turn-feedback ${isBest ? "recommended" : "weaker"}" data-feedback-turn="${index}" tabindex="-1"><p><span class="tag ${tagClass}">${label}</span></p><p class="small">${escapeHTML(perChoice)}</p>${recommended}${rationale}<button class="button button-secondary" type="button" data-retry-turn="${index}" aria-label="Recommencer cette étape ${index + 1} sur ${DATA.dialogue.length}">Recommencer cette étape</button></div>`;
  }

  function focusFeedback(index) {
    document.querySelector(`[data-feedback-turn="${index}"]`)?.focus();
  }

  function renderSimulation() {
    const completed = state.dialogueAnswers.length;
    const current = DATA.dialogue[Math.min(state.dialogueStep, DATA.dialogue.length - 1)];
    const done = completed >= DATA.dialogue.length;
    const messages = [];
    DATA.dialogue.forEach((turn, index) => {
      if (index <= state.dialogueStep || done) {
        messages.push(`<div class="chat-message"><span class="chat-avatar" aria-hidden="true">CL</span><div class="bubble">${escapeHTML(turn.text)}</div></div>`);
      }
      const answer = state.dialogueAnswers[index];
      if (answer !== undefined) {
        messages.push(`<div class="chat-message own"><span class="chat-avatar" aria-hidden="true">VO</span><div class="bubble">${escapeHTML(turn.choices[answer])}</div></div>`);
        messages.push(renderTurnFeedback(turn, answer, index));
      }
    });
    return `<div class="page-shell">
      <div class="page-head-row"><div><p class="eyebrow">Entraînement guidé · Étape 2</p><h1 id="sim-title" tabindex="-1">Simulation de communication</h1></div></div>
      <div class="sim-shell">
        <aside class="sim-aside">
          <div class="sim-person">
            <span class="scenario-person" aria-hidden="true">CF</span>
            <div><h2>${escapeHTML(DATA.scenario.customer)}</h2><p>Entraînement guidé</p></div>
          </div>
          <div class="sim-block"><h3>${ICON("compass")}Situation</h3><p>${escapeHTML(DATA.scenario.context)}</p></div>
          <div class="sim-block"><h3>${ICON("target")}Votre objectif</h3><p>${escapeHTML(DATA.scenario.goal)}</p></div>
          <div class="sim-block"><span class="tag neutral">${ICON("flask")}Scénario fictif</span></div>
        </aside>
        <div class="sim-conversation">
          <div class="sim-header"><h2>Dialogue</h2><span class="sim-turn-counter">${Math.min(completed + 1, DATA.dialogue.length)} sur ${DATA.dialogue.length}</span></div>
          <div class="sim-messages" data-messages>${messages.join("")}${done ? '<div class="feedback">Simulation terminée. Vos décisions sont résumées dans le résultat.</div>' : ""}</div>
          <div class="sim-composer">${done ? `<div class="button-row">${routeLink("abschluss", "Voir le résultat")}<button class="button button-secondary" type="button" data-reset-dialogue>${ICON("refresh")}Recommencer</button></div>` : `<p class="small strong">Que répondez-vous ?</p><div class="answer-list">${current.choices.map((choice, index) => `<button class="answer" type="button" data-choice="${index}">${ICON("chat")}<span>${escapeHTML(choice)}</span></button>`).join("")}</div>`}</div>
        </div>
      </div>
    </div>`;
  }

  async function apiPost(path, body, options = {}) {
    const attempt = async () => {
      let response;
      try {
        response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        throw { code: "service_unavailable" };
      }
      let data = null;
      let isJson = false;
      try {
        data = await response.json();
        isJson = true;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const code = isJson && data && typeof data.error === "string"
          ? data.error
          : response.status === 429 || response.status >= 500
            ? "service_busy"
            : "request_failed";
        throw { code, status: response.status };
      }
      if (!isJson) throw { code: "service_unavailable", status: response.status };
      return data || {};
    };
    const transient = (code) => ["service_unavailable", "service_busy", "ai_unavailable", "ai_timeout", "ai_rate_limited", "ai_error", "evaluation_invalid", "course_invalid", "lesson_invalid", "exercise_invalid"].includes(code);
    try {
      return await attempt();
    } catch (error) {
      if (options.retry === false || !transient(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700));
      try {
        return await attempt();
      } catch (secondError) {
        throw secondError;
      }
    }
  }

  async function apiGet(path) {
    let response;
    try {
      response = await fetch(path);
    } catch {
      throw { code: "service_unavailable" };
    }
    if (!response.ok) throw { code: "service_unavailable", status: response.status };
    try {
      return await response.json();
    } catch {
      throw { code: "service_unavailable" };
    }
  }

  function aiErrorMessage(code, operation) {
    const ops = {
      customer: ["La cliente IA n’a pas répondu.", "Votre réponse est conservée."],
      evaluate: ["L’analyse n’a pas pu aboutir.", "Votre conversation est conservée."],
      course: ["Le parcours n’a pas pu être créé.", ""],
      lesson: ["La leçon n’a pas pu être générée.", ""],
      tutor: ["Le coach IA n’a pas pu répondre.", "Votre question est conservée."],
      exercise: ["La correction n’a pas pu être générée.", ""],
      tts: ["L’audio n’est pas disponible.", ""],
    };
    const fallback = ops[operation] || ["Le service IA a rencontré une erreur.", "Vos données sont conservées."];
    let line = fallback[0];
    if (code === "ai_timeout") line = "Le service IA met trop de temps à répondre.";
    if (code === "ai_rate_limited" || code === "service_busy") line = "Le service IA est très sollicité. Réessayez dans un instant.";
    if (code === "service_unavailable" || code === "ai_unavailable") line = "Le service IA n’est pas joignable. Vérifiez que le serveur est démarré (node server.js).";
    if (code === "evaluation_invalid" || code === "course_invalid" || code === "lesson_invalid" || code === "exercise_invalid") line = "Le service IA n’a pas produit un résultat valide.";
    if (code === "tts_unavailable" || code === "tts_failed") line = "L’audio n’est pas disponible pour le moment.";
    const parts = [line, fallback[1], "Vous pouvez réessayer."];
    return [...new Set(parts.filter(Boolean))].join(" ");
  }

  let scenarioList = null;
  let scenariosLoading = false;

  function scenarioById(id) {
    return (scenarioList || []).find((scenario) => scenario.id === id) || null;
  }

  function currentScenario() {
    return scenarioById(aiState.scenarioId);
  }

  function scenarioDisplay() {
    const scenario = currentScenario();
    if (scenario) return scenario;
    return {
      id: "communication",
      title: "Communication avec un client",
      objective: DATA.scenario.goal,
      context: DATA.scenario.context,
      difficulty: "Fondamental",
      customerLabel: DATA.scenario.customer,
      topic: "communication",
      topicLabel: "Communication",
      criteria: [],
    };
  }

  async function loadScenarios() {
    if (scenarioList || scenariosLoading) return;
    scenariosLoading = true;
    try {
      const data = await apiGet("/api/scenarios");
      scenarioList = Array.isArray(data.scenarios) ? data.scenarios : [];
    } catch {
      scenarioList = [];
    }
    scenariosLoading = false;
    if (routeFromHash() === "simulations" || routeFromHash() === "ia") render(routeFromHash());
  }

  function aiLearnerTurns() {
    return aiState.messages.filter((message) => message.role === "user").length;
  }

  const ttsCache = new Map();

  const ttsPlayer = {
    segments: [],
    index: 0,
    status: "idle", // idle | loading | playing | paused | error | ended
    route: null,
    audio: null,
    url: null,
    session: 0,
    timer: null,
  };

  function pushTtsSegments(text, label, segments) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    const MAX = 1300;
    if (cleaned.length <= MAX) {
      segments.push({ text: cleaned, label });
      return;
    }
    let rest = cleaned;
    while (rest.length > MAX) {
      const cut = Math.max(rest.lastIndexOf(". ", MAX), rest.lastIndexOf("! ", MAX), rest.lastIndexOf("? ", MAX), rest.lastIndexOf("; ", MAX), rest.lastIndexOf(", ", MAX), rest.lastIndexOf(" ", MAX));
      const end = cut > MAX * 0.6 ? cut : MAX;
      segments.push({ text: rest.slice(0, end).trim(), label });
      rest = rest.slice(end).trim();
    }
    if (rest) segments.push({ text: rest, label });
  }

  function collectLessonTtsSegments(lesson, moduleId) {
    const segments = [];
    const add = (text, label) => pushTtsSegments(text, label, segments);
    (lesson.sections || []).forEach((section) => {
      const label = section.title || "Leçon";
      if (section.type === "concept") {
        add(section.content, label);
      } else if (section.type === "example" || section.type === "scenario") {
        add(section.situation, "Le client");
        add(section.response, "Le pharmacien");
      } else if (section.type === "key_points") {
        add((section.items || []).map((item, index) => `Point ${index + 1} : ${item}`).join(". "), label);
      } else if (section.type === "checklist") {
        add((section.items || []).join(". "), label);
      } else if (section.type === "warning") {
        add(section.content, label);
      } else if (section.type === "summary") {
        add([section.content, ...(section.items || [])].filter(Boolean).join(". "), label);
      } else if (section.type === "comparison") {
        (section.items || []).forEach((item) => add(`${item.label} : privilégier ${item.left}. Éviter ${item.right}.`, label));
      } else if (section.type === "process") {
        (section.steps || []).forEach((step, index) => add(`Étape ${index + 1}. ${step.title}${step.description ? ` : ${step.description}` : ""}`, label));
      } else if (section.type === "timeline") {
        (section.items || []).forEach((item) => add(`${item.label}${item.text ? ` : ${item.text}` : ""}`, label));
      } else if (section.type === "diagram") {
        (section.nodes || []).forEach((node) => add(`${node.label}${node.text ? ` : ${node.text}` : ""}`, label));
      } else if (section.type === "chart") {
        add((section.data || []).map((entry) => `${entry.label} : ${entry.value} pour cent`).join(". "), label);
      } else if (section.type === "question") {
        let text = section.question;
        if (section.options && section.options.length) text += ` Options : ${section.options.join(" ; ")}`;
        add(text, label);
        const quiz = moduleId ? pathState.quizResults[moduleId] : null;
        if (quiz && quiz.explanation) add(quiz.explanation, "Analyse du coach");
      }
    });
    return segments;
  }

  function collectTtsSegments(route) {
    const segments = [];
    if (route === "ia") {
      aiState.messages.forEach((message) => {
        if (message.role === "assistant") pushTtsSegments(message.content, "La cliente", segments);
      });
    } else if (route === "simulation") {
      if (DATA.scenario.context) pushTtsSegments(DATA.scenario.context, "Situation", segments);
      if (DATA.scenario.goal) pushTtsSegments(DATA.scenario.goal, "Votre objectif", segments);
      DATA.dialogue.forEach((turn, index) => {
        if (index <= state.dialogueStep) pushTtsSegments(turn.text, "La cliente", segments);
        const answer = state.dialogueAnswers[index];
        if (answer !== undefined) pushTtsSegments(turn.choices[answer], "Votre réponse", segments);
      });
    } else if (route === "lecon") {
      const moduleId = pathState.activeModuleId;
      const lesson = pathState.lessons[moduleId];
      if (lesson && Array.isArray(lesson.sections)) {
        collectLessonTtsSegments(lesson, moduleId).forEach((segment) => segments.push(segment));
      }
      (pathState.tutor[moduleId] || []).forEach((message) => {
        if (message.role === "assistant") pushTtsSegments(message.content, "Le coach", segments);
      });
    }
    return segments;
  }

  function ttsPlayerHtml() {
    const count = ttsPlayer.segments.length;
    return `<div class="tts-player" data-tts-player>
      <button class="tts-toggle" type="button" data-tts-toggle aria-label="Écouter toute la page">${ICON("play", "tts-icon")}</button>
      <button class="tts-stop" type="button" data-tts-stop aria-label="Arrêter la lecture" disabled>${ICON("square", "tts-icon")}</button>
      <div class="tts-track" data-tts-track role="progressbar" aria-label="Avancement de la lecture" aria-valuemin="0" aria-valuemax="${count}" aria-valuenow="0">
        <div class="tts-fill" data-tts-fill></div>
      </div>
      <span class="tts-label" data-tts-label>Écouter toute la page</span>
      <span class="tts-count" data-tts-count>${count} extraits</span>
    </div>`;
  }

  function findTtsBar() {
    if (!ttsPlayer.route) return null;
    return document.querySelector(`[data-view="${ttsPlayer.route}"] [data-tts-player]`);
  }

  function ttsReset() {
    ttsPlayer.session += 1;
    if (ttsPlayer.audio) {
      ttsPlayer.audio.onended = null;
      ttsPlayer.audio.onerror = null;
      try { ttsPlayer.audio.pause(); } catch { /* audio already stopped */ }
    }
    if (ttsPlayer.url) {
      URL.revokeObjectURL(ttsPlayer.url);
      ttsPlayer.url = null;
    }
    if (ttsPlayer.timer) {
      window.clearInterval(ttsPlayer.timer);
      ttsPlayer.timer = null;
    }
    ttsPlayer.audio = null;
    ttsPlayer.status = "idle";
    ttsPlayer.index = 0;
  }

  function attachTtsPlayer(route) {
    ttsReset();
    document.querySelectorAll("[data-tts-player]").forEach((player) => player.remove());
    const segments = collectTtsSegments(route);
    if (!segments.length) {
      ttsPlayer.route = null;
      return;
    }
    ttsPlayer.route = route;
    ttsPlayer.segments = segments;
    const shell = document.querySelector(`[data-view="${route}"] .page-shell`);
    if (!shell) return;
    shell.insertAdjacentHTML("afterbegin", ttsPlayerHtml());
    bindTtsControls(shell.querySelector("[data-tts-player]"));
  }

  function bindTtsControls(player) {
    player.querySelector("[data-tts-toggle]").addEventListener("click", toggleTtsPlayback);
    player.querySelector("[data-tts-stop]").addEventListener("click", () => {
      ttsReset();
      updateTtsUi(findTtsBar());
    });
  }

  async function fetchTtsAudio(text) {
    const cached = ttsCache.get(text);
    if (cached) return cached;
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1500), voice: "fr-FR-DeniseNeural" }),
    });
    if (!response.ok) throw new Error("tts_failed");
    const blob = await response.blob();
    if (!blob.size) throw new Error("tts_empty");
    ttsCache.set(text, blob);
    return blob;
  }

  async function playTtsBlob(blob) {
    if (ttsPlayer.audio) {
      ttsPlayer.audio.onended = null;
      ttsPlayer.audio.onerror = null;
      try { ttsPlayer.audio.pause(); } catch { /* audio already stopped */ }
    }
    if (ttsPlayer.url) URL.revokeObjectURL(ttsPlayer.url);
    ttsPlayer.url = URL.createObjectURL(blob);
    const audio = new Audio(ttsPlayer.url);
    ttsPlayer.audio = audio;
    audio.onended = () => {
      if (ttsPlayer.status !== "playing") return;
      const bar = findTtsBar();
      if (!bar) return;
      if (ttsPlayer.index + 1 < ttsPlayer.segments.length) {
        playTtsFrom(ttsPlayer.index + 1);
      } else {
        ttsPlayer.status = "ended";
        updateTtsUi(bar);
      }
    };
    audio.onerror = () => {
      if (ttsPlayer.status !== "playing" && ttsPlayer.status !== "loading") return;
      ttsPlayer.status = "error";
      const bar = findTtsBar();
      if (bar) updateTtsUi(bar);
    };
    await audio.play();
  }

  async function playTtsFrom(index) {
    const bar = findTtsBar();
    if (!bar) return;
    const segment = ttsPlayer.segments[index];
    if (!segment) {
      ttsPlayer.status = "ended";
      updateTtsUi(bar);
      return;
    }
    ttsPlayer.index = index;
    ttsPlayer.status = "loading";
    updateTtsUi(bar);
    const session = ttsPlayer.session;
    let blob;
    try {
      blob = await fetchTtsAudio(segment.text);
    } catch {
      if (session !== ttsPlayer.session) return;
      ttsPlayer.status = "error";
      updateTtsUi(bar);
      return;
    }
    if (session !== ttsPlayer.session) return;
    try {
      await playTtsBlob(blob);
      if (session !== ttsPlayer.session) return;
    } catch {
      if (session !== ttsPlayer.session) return;
      ttsPlayer.status = "error";
      updateTtsUi(bar);
      return;
    }
    ttsPlayer.status = "playing";
    updateTtsUi(bar);
    startTtsProgress(bar);
  }

  function toggleTtsPlayback() {
    if (ttsPlayer.status === "playing") {
      if (ttsPlayer.audio) ttsPlayer.audio.pause();
      ttsPlayer.status = "paused";
      updateTtsUi(findTtsBar());
      return;
    }
    if (ttsPlayer.status === "paused") {
      if (ttsPlayer.audio) {
        ttsPlayer.audio.play().catch(() => {});
        ttsPlayer.status = "playing";
        const bar = findTtsBar();
        if (bar) {
          updateTtsUi(bar);
          startTtsProgress(bar);
        }
      }
      return;
    }
    if (ttsPlayer.status === "ended") ttsPlayer.index = 0;
    playTtsFrom(ttsPlayer.index);
  }

  function startTtsProgress(bar) {
    if (ttsPlayer.timer) window.clearInterval(ttsPlayer.timer);
    ttsPlayer.timer = window.setInterval(() => {
      if (ttsPlayer.status !== "playing" && ttsPlayer.status !== "paused") {
        window.clearInterval(ttsPlayer.timer);
        ttsPlayer.timer = null;
        return;
      }
      updateTtsUi(findTtsBar());
    }, 250);
  }

  function updateTtsUi(bar) {
    if (!bar || !ttsPlayer.route) return;
    const total = ttsPlayer.segments.length;
    const index = total ? Math.min(ttsPlayer.index, total - 1) : 0;
    const segment = ttsPlayer.segments[index];
    const fill = bar.querySelector("[data-tts-fill]");
    const track = bar.querySelector("[data-tts-track]");
    if (fill && track && total) {
      let ratio = 0;
      if (ttsPlayer.status === "ended") ratio = 1;
      else if (ttsPlayer.status !== "idle") {
        let current = 0;
        if (ttsPlayer.audio && ttsPlayer.audio.duration > 0) {
          current = Math.min(1, ttsPlayer.audio.currentTime / ttsPlayer.audio.duration);
        }
        ratio = (index + current) / total;
      }
      fill.style.width = `${Math.round(ratio * 100)}%`;
      track.setAttribute("aria-valuenow", Math.round(ratio * total).toString());
    }
    const label = bar.querySelector("[data-tts-label]");
    const statusLabel = {
      loading: "Chargement de l’audio…",
      playing: segment ? `En lecture : ${segment.label}` : "En lecture",
      paused: segment ? `En pause : ${segment.label}` : "En pause",
      error: "Audio indisponible pour le moment",
      ended: "Lecture terminée",
      idle: "Écouter toute la page",
    }[ttsPlayer.status];
    if (label) label.textContent = statusLabel;
    const count = bar.querySelector("[data-tts-count]");
    if (count) count.textContent = ttsPlayer.status === "idle" ? `${total} extraits` : `${index + 1} / ${total}`;
    const toggle = bar.querySelector("[data-tts-toggle]");
    if (toggle) {
      const playing = ttsPlayer.status === "playing";
      toggle.innerHTML = ICON(playing ? "pause" : "play", "tts-icon");
      toggle.setAttribute("aria-label", playing ? "Mettre en pause" : ttsPlayer.status === "paused" ? "Reprendre la lecture" : "Écouter toute la page");
    }
    const stop = bar.querySelector("[data-tts-stop]");
    if (stop) stop.disabled = ttsPlayer.status === "idle" || ttsPlayer.status === "ended" || ttsPlayer.status === "error";
  }

  function renderAiMessage(message) {
    const isCustomer = message.role === "assistant";
    return `<div class="chat-message${isCustomer ? "" : " own"}">
      <span class="chat-avatar" aria-hidden="true">${isCustomer ? "CL" : "VO"}</span>
      <div class="bubble">${escapeHTML(message.content)}</div>
    </div>`;
  }

  function renderAiErrorPanel() {
    const message = aiState.error ? aiState.error.message : aiErrorMessage("ai_error", "customer");
    return `<div class="ai-error" role="alert" tabindex="-1" data-ai-error>${ICON("alert", "icon")}<div><p class="small">${escapeHTML(message)}</p><div class="button-row tight"><button class="button button-primary button-sm" type="button" data-ai-retry>${ICON("refresh")}Réessayer</button>${routeLink("simulations", "Choisir une autre simulation", "button-ghost button-sm")}</div></div></div>`;
  }

  function findCriterion(id) {
    const scenario = currentScenario();
    const fromScenario = scenario ? scenario.criteria.find((criterion) => criterion.id === id) || null : null;
    if (aiState.evaluation && aiState.evaluation.data) {
      const fromEval = aiState.evaluation.data.criteria.find((criterion) => criterion.id === id);
      if (fromEval) return { ...fromScenario, ...fromEval };
    }
    return fromScenario;
  }

  function scenarioAsideHTML(scenario, criteriaNotes) {
    const criteria = (scenario.criteria || []).slice(0, 6);
    return `<aside class="sim-aside">
      <div class="sim-person">
        <span class="scenario-person" aria-hidden="true">${escapeHTML((scenario.customerLabel || "Client").replace(/\s/g, "").slice(0, 2).toUpperCase())}</span>
        <div><h2>${escapeHTML(scenario.customerLabel || "Client simulé")}</h2><p>Personne simulée par IA</p></div>
      </div>
      <div class="sim-block"><h3>${ICON("compass")}Situation</h3><p>${escapeHTML(scenario.context)}</p></div>
      <div class="sim-block"><h3>${ICON("target")}Votre objectif</h3><p>${escapeHTML(scenario.objective)}</p></div>
      ${criteria.length ? `<div class="sim-block"><h3>${ICON("check")}Critères observés</h3><ul class="sim-criteria">${criteria.map((criterion) => `<li>${ICON("checkCircle")}<span>${escapeHTML(criterion.label)}</span></li>`).join("")}</ul></div>` : ""}
      <div class="sim-block"><span class="tag neutral">${ICON("flask")}Scénario fictif — aucun conseil médical</span></div>
      ${criteriaNotes || ""}
    </aside>`;
  }

  function renderAiIntro(extra, canStart) {
    const scenario = scenarioDisplay();
    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Simulation · ${escapeHTML(scenario.difficulty)}</p>
          <h1 id="ia-title" tabindex="-1">${escapeHTML(scenario.title)}</h1>
          <p class="lede">Dialoguez avec une personne simulée par IA. Elle réagit comme une vraie personne — vous répondez librement, sans risque pour vos vrais clients.</p>
        </div>
      </div>
      ${renderPracticeBanner()}
      <div class="sim-shell">
        ${scenarioAsideHTML(scenario)}
        <div class="sim-conversation">
          <div class="sim-messages" data-ai-messages>
            <div class="empty-state" style="border:0;background:transparent;margin:auto">
              ${ICON("chat", "icon icon-xl")}
              <h3>${escapeHTML(scenario.customerLabel)} va engager la conversation</h3>
              <p>Répondez naturellement, comme au comptoir. Après ${AI_MAX_TURNS} réponses, l’IA analysera votre pratique.</p>
              <div class="button-row">
                ${canStart ? `<button class="button button-primary" type="button" data-ai-start>${ICON("play")}Démarrer la simulation</button>` : ""}
                <a class="button button-secondary" href="#simulations">Choisir un autre scénario</a>
              </div>
              ${extra}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function renderAi() {
    const turns = aiLearnerTurns();
    const last = aiState.messages[aiState.messages.length - 1];
    const lastIsUser = Boolean(last && last.role === "user");
    const waiting = aiState.status === "waiting" || aiState.status === "starting";
    const done = aiState.status === "complete";
    const scenario = scenarioDisplay();
    const analyzeLabel = scenario.topic === "communication" ? "votre communication" : "votre pratique";
    const analyzeButton = scenario.topic === "communication" ? "Analyser ma communication" : "Analyser ma pratique";

    if (!aiState.messages.length) {
      if (aiState.status === "starting") return renderAiIntro('<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>La personne arrive…</div>', false);
      if (aiState.status === "error") return renderAiIntro(renderAiErrorPanel(), false);
      return renderAiIntro("", true);
    }

    const messages = aiState.messages.map(renderAiMessage).join("");
    const typing = waiting
      ? `<div class="chat-message" role="status"><span class="chat-avatar" aria-hidden="true">CL</span><div class="bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div></div>`
      : "";
    const error = aiState.status === "error" && lastIsUser ? renderAiErrorPanel() : "";
    const disabled = waiting || lastIsUser;
    const composer = done
      ? ""
      : `<form class="composer" data-ai-form>
      <textarea id="ai-input" class="composer-input" data-ai-input rows="3" placeholder="Écrivez votre réponse…" aria-label="Votre réponse" ${disabled ? "disabled" : ""}>${escapeHTML(aiState.draft)}</textarea>
      <div class="composer-foot">
        <span class="char-count">${turns}/${AI_MAX_TURNS} réponses · Entrée pour envoyer</span>
        <button class="button button-primary" type="submit" ${disabled ? "disabled" : ""}>${ICON("send")}Envoyer</button>
      </div>
    </form>`;
    const evaluation = aiState.evaluation;
    let completion = "";
    if (done) {
      if (evaluation && evaluation.status === "loading") {
        completion = `<div class="sim-end-panel" role="status"><h3>${ICON("sparkles")}Analyse en cours…</h3><p class="small subtle">L’IA relit la conversation et évalue vos réflexes. Quelques instants.</p></div>`;
      } else if (evaluation && evaluation.status === "error") {
        completion = `<div class="sim-end-panel"><h3>${ICON("alert")}L’analyse a échoué</h3>${renderAiEvalError()}</div>`;
      } else if (evaluation && evaluation.status === "done") {
        completion = `<div class="sim-end-panel"><h3>${ICON("checkCircle")}Analyse terminée</h3><p class="small subtle">Votre résultat est affiché sous la conversation.</p><div class="button-row tight"><button class="button button-secondary button-sm" type="button" data-ai-reset>${ICON("refresh")}Recommencer cette simulation</button><a class="button button-ghost button-sm" href="#progression">Voir ma progression</a></div></div>`;
      } else {
        completion = `<div class="sim-end-panel"><h3>${ICON("check")}Conversation terminée</h3><p class="small subtle">Vous avez répondu ${turns} fois. Lancez l’analyse pour découvrir ${analyzeLabel}.</p><div class="button-row tight"><button class="button button-primary" type="button" data-ai-analyze>${ICON("sparkles")}${analyzeButton}</button><button class="button button-secondary button-sm" type="button" data-ai-reset>${ICON("refresh")}Recommencer</button></div></div>`;
      }
    }
    const result = done && evaluation && evaluation.status === "done" ? renderAiResult() : "";
    const practiceBanner = renderPracticeBanner();

    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Simulation · ${escapeHTML(scenario.difficulty)}</p>
          <h1 id="ia-title" tabindex="-1">${escapeHTML(scenario.title)}</h1>
        </div>
      </div>
      ${practiceBanner}
      <div class="sim-shell">
        ${scenarioAsideHTML(scenario)}
        <div class="sim-conversation">
          <div class="sim-header"><h2>Conversation</h2><span class="sim-turn-counter">${done ? "Terminée" : `${turns}/${AI_MAX_TURNS} réponses`}</span></div>
          <div class="sim-messages" data-ai-messages>${messages}${typing}</div>
          <div class="sim-composer">${done ? completion : `${error}${composer}`}</div>
        </div>
      </div>
      ${result}
      <div class="mode-switch">${routeLink("simulations", "Choisir un autre scénario", "button-secondary")}</div>
    </div>`;
  }

  function renderAiEvalError() {
    const message = aiState.evaluation && aiState.evaluation.error ? aiState.evaluation.error.message : aiErrorMessage("ai_error", "evaluate");
    return `<div class="ai-error" role="alert" tabindex="-1" data-ai-error>${ICON("alert", "icon")}<div><p class="small">${escapeHTML(message)}</p><div class="button-row tight"><button class="button button-primary button-sm" type="button" data-ai-analyze>${ICON("refresh")}Réessayer l’analyse</button><button class="button button-secondary button-sm" type="button" data-ai-reset>Recommencer cette simulation</button></div></div></div>`;
  }

  function renderAiResult() {
    const evaluation = aiState.evaluation.data;
    const scenario = scenarioDisplay();
    const score = Math.round(evaluation.criteria.reduce((sum, criterion) => sum + criterion.score, 0) / Math.max(1, evaluation.criteria.length));
    const cards = evaluation.criteria.map((criterion) => {
      const statusText = criterion.status === "acquis" ? "Acquis" : criterion.status === "a_renforcer" ? "ì renforcer" : "Non évalué";
      const tagClass = criterion.status === "acquis" ? "success" : criterion.status === "a_renforcer" ? "warning" : "neutral";
      const statusIcon = criterion.status === "acquis" ? "checkCircle" : criterion.status === "a_renforcer" ? "target" : "eye";
      const evidenceLabel = criterion.status === "non_evalue" ? "Constat" : "Ce que vous avez fait";
      const isPriority = evaluation.priority === criterion.id;
      return `<article class="card criterion-card ${isPriority ? "is-priority" : ""}">
        <div class="criterion-head"><h3>${escapeHTML(criterion.label)}</h3><span class="tag ${tagClass}">${ICON(statusIcon)}${statusText}</span></div>
        <div class="meter"><progress class="progress-track thin" max="100" value="${criterion.score}" aria-label="${escapeHTML(criterion.label)} : ${criterion.score} sur 100"></progress><span class="meter-value">${criterion.score}</span></div>
        <p class="criterion-detail"><strong>${evidenceLabel} :</strong> ${escapeHTML(criterion.evidence)}</p>
        <p class="criterion-detail"><strong>Pour progresser :</strong> ${escapeHTML(criterion.improvement)}</p>
        ${isPriority ? `<span class="tag">${ICON("zap")}Priorité</span>` : ""}
      </article>`;
    }).join("");
    const priorityCriterion = evaluation.criteria.find((criterion) => criterion.id === evaluation.priority) || { label: evaluation.priority };
    const attemptCriterion = aiState.practiceTarget ? evaluation.criteria.find((criterion) => criterion.id === aiState.practiceTarget) : null;
    const attemptNote = attemptCriterion
      ? `<p class="small"><strong>Lors de cette nouvelle tentative :</strong> ${attemptCriterion.status === "acquis" ? "Acquis" : attemptCriterion.status === "a_renforcer" ? "ì renforcer" : "Non évalué"} (${escapeHTML(attemptCriterion.label)})</p>`
      : "";
    const replayLabel = "Rejouer ce critère";
    return `<section class="ai-result" data-ai-result aria-labelledby="ai-result-title">
      <div class="result-hero">
        <div>
          <p class="eyebrow" style="color:rgba(255,255,255,.75)">Votre performance</p>
          <h1 id="ai-result-title" tabindex="-1">${escapeHTML(evaluation.overall)}</h1>
          <p class="lede">Analyse générée par IA à partir de votre conversation — chaque critère s’appuie sur ce que vous avez réellement dit.</p>
          <div class="button-row">
            <button class="button button-primary" type="button" data-ai-replay>${ICON("target")}${replayLabel}</button>
            <button class="button button-secondary" type="button" data-ai-reset>${ICON("refresh")}Recommencer</button>
          </div>
        </div>
        <div class="score-ring" style="--score:${score}" role="img" aria-label="Score moyen : ${score} sur 100"><div><strong>${score}</strong><small>/ 100</small></div></div>
      </div>
      <div class="section-heading"><div><p class="eyebrow">Critères</p><h2>Ce qui s’est passé, et quoi travailler ensuite</h2></div><span class="section-note">Évaluation par l’IA · personne et situation fictives</span></div>
      <div class="card-grid">${cards}</div>
      <div class="section-heading"><div><p class="eyebrow">Votre priorité</p><h2>Le prochain point à travailler</h2></div></div>
      <div class="card priority-card">
        <div>
          <h3>${ICON("target")}${escapeHTML(priorityCriterion.label)}</h3>
          <p class="small"><strong>Prochaine pratique :</strong> ${escapeHTML(evaluation.next_practice)}</p>
          ${attemptNote}
        </div>
        <button class="button button-primary" type="button" data-ai-replay>${ICON("play")}Travailler ce point</button>
      </div>
      ${renderNextStep(evaluation)}
    </section>`;
  }

  function renderNextStep(evaluation) {
    if (!pathState.course || !evaluation || !evaluation.priority) return "";
    const index = Math.max(0, (evaluation.criteria || []).findIndex((criterion) => criterion.id === evaluation.priority));
    const module = pathState.course.modules[Math.min(index, pathState.course.modules.length - 1)];
    return `<div class="section-heading"><div><p class="eyebrow">Suite recommandée</p><h2>Votre prochaine étape</h2></div></div>
      <div class="card reco-card">
        <p class="reco-reason">${escapeHTML(evaluation.next_practice || "")}</p>
        <div class="reco-topic"><strong class="small">Leçon recommandée : ${escapeHTML(module.title)}</strong></div>
        <div class="button-row tight"><button class="button button-primary" type="button" data-path-recommend="${escapeHTML(module.id)}">${ICON("play")}Commencer cette leçon</button></div>
      </div>`;
  }

  async function aiAnalyze() {
    if (aiState.status !== "complete") return;
    if (aiState.evaluation && aiState.evaluation.status === "loading") return;
    aiState.evaluation = { status: "loading", data: null, error: null };
    aiFocus = null;
    saveAiState();
    render("ia");
    try {
      const data = await apiPost("/api/evaluate", { scenarioId: aiState.scenarioId, messages: aiState.messages });
      if (!isValidAiEvaluation(data)) throw { code: "evaluation_invalid" };
      aiState.evaluation = { status: "done", data, error: null };
      aiFocus = "result";
      if (window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated()) {
        window.BP_PLATFORM.saveSimulation({
          scenarioId: aiState.scenarioId,
          messages: aiState.messages,
          evaluation: data,
          practiceTarget: aiState.practiceTarget || null,
          courseId: window.BP_PLATFORM.courseId() || null,
          moduleId: pathState.activeModuleId || null,
        });
      }
    } catch (error) {
      aiState.evaluation = { status: "error", data: null, error: { code: error.code || "ai_error", message: aiErrorMessage(error.code, "evaluate") } };
      aiFocus = "error";
    }
    saveAiState();
    render("ia");
  }

  function renderPracticeBanner() {
    if (!aiState.practiceTarget) return "";
    const criterion = findCriterion(aiState.practiceTarget);
    const label = criterion ? criterion.label : aiState.practiceTarget;
    const objective = criterion ? criterion.objective : "";
    return `<div class="banner info-banner">${ICON("target")}<p><strong>Pratique ciblée : ${escapeHTML(label)}</strong>${objective ? ` — ${escapeHTML(objective)}` : ""}</p></div>`;
  }

  function aiCustomerBody(extra) {
    const body = { scenarioId: aiState.scenarioId, ...extra };
    if (aiState.practiceTarget) body.practiceTarget = aiState.practiceTarget;
    return body;
  }

  async function aiStart() {
    aiState.status = "starting";
    aiState.error = null;
    aiFocus = null;
    saveAiState();
    render("ia");
    try {
      const data = await apiPost("/api/customer", aiCustomerBody({ opening: true }));
      if (typeof data.reply !== "string" || !data.reply.trim()) throw { code: "ai_error" };
      aiState.messages = [{ role: "assistant", content: data.reply.slice(0, 4000) }];
      aiState.status = "active";
      aiState.error = null;
      aiFocus = "input";
    } catch (error) {
      aiState.error = { code: error.code || "ai_error", message: aiErrorMessage(error.code, "customer") };
      aiState.status = "error";
      aiFocus = "error";
    }
    saveAiState();
    render("ia");
  }

  async function requestCustomerReply() {
    try {
      const data = await apiPost("/api/customer", aiCustomerBody({ messages: aiState.messages }));
      if (typeof data.reply !== "string" || !data.reply.trim()) throw { code: "ai_error" };
      aiState.messages.push({ role: "assistant", content: data.reply.slice(0, 4000) });
      aiState.error = null;
      aiState.status = aiLearnerTurns() >= AI_MAX_TURNS ? "complete" : "active";
      aiFocus = "input";
    } catch (error) {
      aiState.error = { code: error.code || "ai_error", message: aiErrorMessage(error.code, "customer") };
      aiState.status = "error";
      aiFocus = "error";
    }
    saveAiState();
    render("ia");
  }

  async function aiSend() {
    const text = aiState.draft.trim();
    if (!text) return;
    if (aiState.status === "waiting" || aiState.status === "starting" || aiState.status === "complete") return;
    const last = aiState.messages[aiState.messages.length - 1];
    if (last && last.role === "user") return;
    aiState.messages.push({ role: "user", content: text.slice(0, 1500) });
    aiState.draft = "";
    aiState.error = null;
    aiState.status = "waiting";
    aiFocus = null;
    saveAiState();
    render("ia");
    await requestCustomerReply();
  }

  function moduleTitleById(id) {
    if (!pathState.course) return "";
    const module = pathState.course.modules.find((item) => item.id === id);
    return module ? module.title : "";
  }

  function pathProgress() {
    if (!pathState.course) return 0;
    const done = pathState.course.modules.filter((module) => pathState.completedLessons[module.id]).length;
    return Math.round((done / pathState.course.modules.length) * 100);
  }

  function buildLessonSummary(lesson) {
    if (!lesson) return "";
    return lesson.sections
      .map((section) => {
        const text = section.content || section.situation || (section.items ? section.items.join(" ") : "") || section.question || "";
        return `${section.title || section.type} : ${text}`;
      })
      .join(" | ")
      .slice(0, 6000);
  }

  function renderAccueil() {
    const generating = pathState.status === "generating";
    const error =
      pathState.status === "error"
        ? `<div class="ai-error" role="alert" tabindex="-1" data-path-error>${ICON("alert", "icon")}<div><p class="small">${escapeHTML(pathState.error ? pathState.error.message : aiErrorMessage("ai_error"))}</p>${pathState.objective ? '<div class="button-row tight"><button class="button button-secondary" type="button" data-path-retry>Réessayer</button></div>' : ""}</div></div>`
        : "";
    const chips = ["Mieux conseiller les clients", "Améliorer ma communication", "Mieux présenter les produits", "Gérer les objections", "Développer mes ventes"];
    return `<div class="page-shell narrow">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Parcours personnalisé</p>
          <h1 id="accueil-title" tabindex="-1">Que souhaitez-vous améliorer ?</h1>
          <p class="lede">Décrivez votre objectif : votre coach IA construit un parcours de formation adapté à votre métier au comptoir.</p>
        </div>
      </div>
      <div class="card card-tint">
        <div class="card-top"><span class="tag">${ICON("sparkles")}Coach IA</span><span class="tiny subtle">${generating ? "Construction du parcours…" : "3 à 5 modules · quelques secondes"}</span></div>
        <form class="stack-form" data-path-create>
          <div class="field">
            <label class="field-label" for="goal-input">Votre objectif</label>
            <textarea id="goal-input" class="textarea" data-goal-input maxlength="600" rows="3" placeholder="Ex. : je veux mieux conseiller les produits dermocosmétiques" ${generating ? "disabled" : ""}>${escapeHTML(pathState.objective)}</textarea>
            <span class="field-hint">Au moins 10 caractères. Votre objectif sert de fil conducteur à tout le parcours.</span>
          </div>
          <div class="chips" aria-label="Exemples d’objectifs">
            ${chips.map((chip) => `<button class="chip" type="button" data-goal-chip="${escapeHTML(chip)}">${escapeHTML(chip)}</button>`).join("")}
          </div>
          <div class="button-row"><button class="button button-primary button-lg" type="submit" ${generating ? "disabled" : ""}>${generating ? `<span class="spinner" aria-hidden="true"></span>Création du parcours…` : `${ICON("sparkles")}Créer mon parcours`}</button></div>
        </form>
        ${error}
      </div>
      <div class="section-heading"><div><p class="eyebrow">Votre parcours</p><h2>Comment il se déroule</h2></div></div>
      <div class="grid-3">
        <article class="card"><span class="icon-wrap">${ICON("bookOpen", "icon")}</span><h3 style="margin-top:.6rem">1. Leçons courtes</h3><p class="small subtle">Chaque module est une leçon concrète avec exemples de dialogue et exercice.</p></article>
        <article class="card"><span class="icon-wrap">${ICON("chat", "icon")}</span><h3 style="margin-top:.6rem">2. Mise en pratique</h3><p class="small subtle">Le dernier module vous invite à pratiquer avec un client simulé par IA.</p></article>
        <article class="card"><span class="icon-wrap">${ICON("chart", "icon")}</span><h3 style="margin-top:.6rem">3. Progression guidée</h3><p class="small subtle">L’analyse de chaque simulation oriente votre entraînement suivant.</p></article>
      </div>
    </div>`;
  }

  function moduleStatus(index, course) {
    const done = Boolean(pathState.completedLessons[course.modules[index].id]);
    if (done) return "done";
    const previousDone = course.modules.slice(0, index).every((module) => pathState.completedLessons[module.id]);
    if (!done && previousDone) return "current";
    return "upcoming";
  }

  function renderParcours() {
    const authed = Boolean(window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated());
    const loading = coursesData === null || coursesData === "booting" || coursesData === "loading";
    if (authed && loading) loadFormations();
    const serverCourses = authed && Array.isArray(coursesData) ? coursesData : [];
    const catalogue = authed && Array.isArray(catalogueData) ? catalogueData : [];
    const myIds = new Set(serverCourses.map((course) => course.id));
    const catalogueOnly = catalogue.filter((course) => !myIds.has(course.id));

    if (authed) {
      const focusId = peekSession("bp-focus-course");
      const target = focusId ? serverCourses.find((course) => course.id === focusId) : null;
      if (target) {
        applyServerCourse(target);
        clearSession("bp-focus-course");
        go("parcours-detail");
      }
    }

    if (authed && loading) {
      return `<div class="page-shell"><div class="page-head-row"><div><p class="eyebrow">Mon parcours</p><h1 id="parcours-title" tabindex="-1">Mes parcours</h1></div></div><div class="grid-3">${"12".split("").map(() => '<div class="skeleton skeleton-card" style="height:220px"></div>').join("")}</div></div>`;
    }
    if (authed && formationsError) {
      return `<div class="page-shell"><div class="page-head-row"><div><p class="eyebrow">Mon parcours</p><h1 id="parcours-title" tabindex="-1">Mes parcours</h1></div></div><div class="ai-error" role="alert"><p class="small">Vos parcours n’ont pas pu être chargés. Vérifie ta connexion puis réessaie.</p><div class="button-row"><button class="button button-secondary" type="button" data-formations-retry>Réessayer</button></div></div></div>`;
    }

    const filter = formationsFilter.trim().toLowerCase();
    const match = (item) => !filter || `${item.title} ${item.objective || ""}`.toLowerCase().includes(filter);

    const list = authed ? serverCourses : (pathState.course ? [{
      id: "local",
      title: pathState.course.title,
      objective: pathState.course.objective,
      estimatedDuration: pathState.course.estimatedDuration,
      modules: pathState.course.modules,
      origin: "personal",
      local: true,
      progress: { percent: pathProgress(), completed: Object.keys(pathState.completedLessons).length, total: pathState.course.modules.length },
    }] : []);
    const visible = list.filter(match);

    const cards = visible.length
      ? visible.map((item) => {
          const percent = item.progress ? item.progress.percent : 0;
          const originTag = item.origin === "assigned" ? '<span class="tag teal">Assigné</span>' : '<span class="tag">Personnalisé</span>';
          const modules = item.modules || [];
          return `<article class="card course-pick">
            <div class="card-top">${originTag}<span class="small subtle">${percent} %</span></div>
            <h3>${escapeHTML(item.title)}</h3>
            <p class="small subtle">${escapeHTML((item.objective || "").slice(0, 160))}</p>
            <div class="course-meta"><span>${ICON("layers")}${modules.length} modules</span><span>${ICON("clock")}${escapeHTML(item.estimatedDuration || "ì votre rythme")}</span></div>
            <div class="meter" style="margin:.6rem 0"><progress class="progress-track thin" max="100" value="${percent}" aria-label="Progression : ${percent} %"></progress><span class="meter-value">${percent}%</span></div>
            <div class="button-row tight">${item.local
              ? `<button class="button button-primary button-sm" type="button" data-local-open>${ICON("play")}Ouvrir le parcours</button>`
              : `<button class="button button-primary button-sm" type="button" data-course-open="${escapeHTML(item.id)}">${ICON("play")}Ouvrir le parcours</button>`}</div>
          </article>`;
        }).join("")
      : `<div class="empty-state" style="grid-column:1/-1">${ICON("sparkles", "icon icon-xl")}<h3>Créez votre premier parcours</h3><p>Quelques secondes suffisent : votre coach IA analyse votre objectif et vous propose des modules de formation adaptés.</p><div class="button-row"><a class="button button-primary" href="#accueil">${ICON("sparkles")}Définir mon objectif</a></div></div>`;

    const catalogueSection = authed && catalogueOnly.filter(match).length
      ? `<div class="section-heading"><div><p class="eyebrow">Catalogue</p><h2>Cours publiés par l’administration</h2></div><span class="section-note">${catalogueOnly.filter(match).length} cours disponible${catalogueOnly.filter(match).length > 1 ? "s" : ""}</span></div>
        <div class="card-grid">${catalogueOnly.filter(match).map((course) => `<article class="card course-card">
          <div class="card-top"><span class="tag teal">Publié</span><span class="small subtle">${(course.modules || []).length} modules</span></div>
          <div class="course-card-body">
            <h3>${escapeHTML(course.title)}</h3>
            <p class="small subtle">${escapeHTML((course.objective || "").slice(0, 150))}</p>
            <div class="course-meta"><span>${ICON("layers")}${(course.modules || []).length} modules</span><span>${ICON("clock")}${escapeHTML(course.estimatedDuration || "ì votre rythme")}</span></div>
          </div>
          <div class="course-card-foot"><button class="button button-primary button-sm" type="button" data-catalogue-add="${escapeHTML(course.id)}">${ICON("plus")}Ajouter à mes parcours</button></div>
        </article>`).join("")}</div>
        <p class="tiny subtle">L’ajout d’un cours du catalogue remplace votre parcours personnalisé actuel ; les cours qui vous sont affectés restent disponibles.</p>`
      : "";

    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Mon parcours</p>
          <h1 id="parcours-title" tabindex="-1">Mes parcours</h1>
          <p class="lede">Votre parcours personnalisé, les cours affectés par votre administrateur et la formation guidée.</p>
        </div>
      </div>
      <div class="catalog-toolbar">
        <div class="search-field">${ICON("search")}<input class="input-text" type="search" placeholder="Rechercher un parcours…" value="${escapeHTML(formationsFilter)}" data-formations-search aria-label="Rechercher un parcours" /></div>
        <span class="tiny subtle">${visible.length} parcours</span>
      </div>
      <div class="card-grid">${cards}</div>
      ${catalogueSection}
      <div class="section-heading"><div><p class="eyebrow">Autres pratiques</p><h2>Entraînement guidé</h2></div></div>
      <div class="card-grid">
        <article class="card course-card">
          <div class="card-top"><span class="tag neutral">Guidé</span></div>
          <div class="course-card-body">
            <h3>Communication en pharmacie</h3>
            <p class="small subtle">Les trois réflexes : demander la préférence de langue, expliquer une étape à la fois, vérifier la compréhension.</p>
            <div class="course-meta"><span>${ICON("layers")}3 étapes</span><span>${ICON("clock")}15 minutes</span><span>${ICON("cap")}Fondamentaux</span></div>
          </div>
          <div class="course-card-foot">${routeLink("vorbereitung", "Ouvrir", "button-secondary button-sm")}</div>
        </article>
      </div>
    </div>`;
  }

  function renderParcoursDetail() {
    if (!pathState.course) {
      return `<div class="page-shell narrow"><div class="page-head-row"><div><p class="eyebrow">Mon parcours</p><h1 id="parcours-detail-title" tabindex="-1">Parcours</h1></div></div><div class="empty-state">${ICON("sparkles", "icon icon-xl")}<h3>Aucun parcours sélectionné</h3><p>Choisissez un parcours dans la liste pour voir son contenu.</p><div class="button-row"><a class="button button-primary" href="#parcours">${ICON("arrowLeft")}Mes parcours</a></div></div></div>`;
    }
    const course = pathState.course;
    const pct = pathProgress();
    const doneCount = course.modules.filter((module) => pathState.completedLessons[module.id]).length;
    const recommendation = pathState.recommendation
      ? `<div class="card reco-card">
          <div class="card-top"><h3>${ICON("compass")}Votre prochaine étape</h3><span class="tag teal">Recommandé</span></div>
          <p class="reco-reason">${escapeHTML(pathState.recommendation.reason)}</p>
          <div class="reco-topic"><strong class="small">${escapeHTML(moduleTitleById(pathState.recommendation.moduleId))}</strong></div>
          <div class="button-row tight"><button class="button button-primary" type="button" data-path-open-lesson="${escapeHTML(pathState.recommendation.moduleId)}">${ICON("play")}Commencer cette leçon</button></div>
        </div>`
      : "";
    const rows = course.modules.map((module, index) => {
      const status = moduleStatus(index, course);
      const isLast = index === course.modules.length - 1;
      const statusLabel = status === "done"
        ? `<span class="module-node-status" style="color:var(--success)">Terminé</span>`
        : status === "current"
          ? `<span class="module-node-status" style="color:var(--brand)">En cours</span>`
          : `<span class="module-node-status" style="color:var(--faint)">ì venir</span>`;
      const marker = status === "done"
        ? ICON("check", "icon")
        : status === "current"
          ? ICON("play", "icon")
          : String(index + 1);
      const practiceTag = isLast ? `<span class="tag teal">${ICON("chat")}Mise en pratique</span>` : "";
      const image = module.image ? `<img class="module-thumb" src="${escapeHTML(module.image.url)}" alt="${escapeHTML(module.image.alt)}" loading="lazy" />` : "";
      const cta = status === "done"
        ? `<button class="button button-secondary button-sm" type="button" data-path-open-lesson="${escapeHTML(module.id)}">${ICON("eye")}Réviser</button>`
        : status === "current"
          ? `<button class="button button-primary button-sm" type="button" data-path-open-lesson="${escapeHTML(module.id)}">${ICON("play")}Continuer</button>`
          : `<button class="button button-secondary button-sm" type="button" data-path-open-lesson="${escapeHTML(module.id)}">Ouvrir</button>`;
      return `<div class="module-node ${status === "current" ? "is-current" : ""} ${status === "done" ? "is-done" : ""}">
        <span class="module-node-marker">${marker}</span>
        <div class="module-node-body">
          <div class="module-node-meta"><span>${ICON("layers")}Module ${index + 1} / ${course.modules.length}</span>${practiceTag}</div>
          <h3>${escapeHTML(module.title)}</h3>
          <p>${escapeHTML(module.description)}</p>
          ${image}
        </div>
        <div class="module-node-actions">${statusLabel}${cta}</div>
      </div>`;
    }).join("");
    return `<div class="page-shell">
      <div class="mode-switch">${routeLink("parcours", "Retour à mes parcours", "button-quiet")}</div>
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Parcours · ${escapeHTML(course.estimatedDuration || "ì votre rythme")}</p>
          <h1 id="parcours-detail-title" tabindex="-1">${escapeHTML(course.title)}</h1>
          <p class="lede">${escapeHTML(course.objective)}</p>
        </div>
      </div>
      <div class="path-summary">
        <div>
          <div class="meter" style="max-width:420px"><progress class="progress-track" max="100" value="${pct}" aria-label="Progression : ${pct} %">${pct}%</progress><span class="meter-value">${pct}%</span></div>
          <p class="tiny subtle" style="margin-top:.4rem">${doneCount}/${course.modules.length} modules terminés</p>
        </div>
        <div class="path-stats">
          <div class="path-stat"><strong>${course.modules.length}</strong>modules</div>
          <div class="path-stat"><strong>${doneCount}</strong>terminés</div>
          <div class="path-stat"><strong>${course.modules.length - doneCount}</strong>à venir</div>
        </div>
      </div>
      ${recommendation}
      <div class="section-heading"><div><p class="eyebrow">Contenu du parcours</p><h2>Objectif → leçons → mise en pratique</h2></div><span class="section-note">Chaque module est une leçon, le dernier est une simulation</span></div>
      <div class="module-path">${rows}</div>
      <div class="mode-switch">${routeLink("simulations", "Passer à la mise en pratique", "button-secondary")}</div>
    </div>`;
  }

  let coursesData = null;
  let catalogueData = null;
  let formationsError = false;
  let coursesDataAuthed = null;
  let formationsFilter = "";

  function peekSession(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }

  function clearSession(key) {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  }

  function applyServerCourse(course) {
    pathState.course = {
      title: course.title,
      objective: course.objective || "",
      estimatedDuration: course.estimatedDuration || "ì votre rythme",
      thumbnail: course.thumbnail || null,
      modules: (course.modules || []).map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description || "",
        image: module.image || null,
      })),
    };
    pathState.activeCourseId = course.id;
    if (window.BP_PLATFORM && window.BP_PLATFORM.setCourseId) window.BP_PLATFORM.setCourseId(course.id);
    savePathState();
  }

  function loadFormations(force) {
    if (force) {
      coursesData = null;
      formationsError = false;
    }
    if (coursesData !== null) return;
    const platform = window.BP_PLATFORM;
    const authed = Boolean(platform && platform.isAuthenticated());
    const legacy = Boolean(platform && platform.isLegacy());
    if (!authed && !legacy) {
      coursesData = "booting";
      window.setTimeout(() => {
        coursesData = null;
        if (routeFromHash() === "parcours") render("parcours");
      }, 400);
      return;
    }
    coursesDataAuthed = authed;
    if (!authed) {
      coursesData = [];
      if (routeFromHash() === "parcours") render("parcours");
      return;
    }
    coursesData = "loading";
    Promise.all([
      apiGet("/api/me/courses").catch(() => null),
      apiGet("/api/catalogue").catch(() => null),
    ])
      .then(([mine, catalogue]) => {
        if (mine && Array.isArray(mine.courses)) {
          coursesData = mine.courses;
          formationsError = false;
        } else {
          coursesData = [];
          formationsError = true;
        }
        catalogueData = catalogue && Array.isArray(catalogue.courses) ? catalogue.courses : [];
      })
      .finally(() => {
        const route = routeFromHash();
        if (route === "formations" || route === "parcours") render(route);
      });
  }

  function topicIcon(topic) {
    const map = { communication: "chat", conseil: "compass", vente: "scale", relation: "shield", produits: "flask", veille: "eye", gestion: "layers" };
    return map[topic] || "book";
  }

  function formationsSkeleton() {
    return `<div class="page-shell">
      <div class="page-head-row"><div><p class="eyebrow">Formations</p><h1 id="formations-title" tabindex="-1">Vos formations</h1></div></div>
      <div class="grid-3">${"123".split("").map(() => '<div class="skeleton skeleton-card" style="height:200px"></div>').join("")}</div>
    </div>`;
  }

  function renderFormations() {
    const authed = Boolean(window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated());
    if (coursesData !== null && coursesData !== "loading" && coursesData !== "booting" && coursesDataAuthed !== authed) {
      loadFormations(true);
      return formationsSkeleton();
    }
    if (coursesData === null || coursesData === "booting" || coursesData === "loading") {
      loadFormations();
      return formationsSkeleton();
    }
    if (formationsError) {
      return `<div class="page-shell">
        <div class="page-head-row"><div><p class="eyebrow">Formations</p><h1 id="formations-title" tabindex="-1">Vos formations</h1></div></div>
        <div class="ai-error" role="alert"><p class="small">Vos formations n’ont pas pu être chargées. Vérifie ta connexion puis réessaie.</p><div class="button-row"><button class="button button-secondary" type="button" data-formations-retry>Réessayer</button></div></div>
      </div>`;
    }

    const filter = formationsFilter.trim().toLowerCase();
    const courseList = [];
    const seen = new Set();
    (coursesData || []).forEach((course) => {
      if (seen.has(course.id)) return;
      seen.add(course.id);
      courseList.push(course);
    });
    const hasLocalCourse = !courseList.some((course) => course.origin === "personal") && pathState.course;
    if (hasLocalCourse) {
      courseList.push({
        id: "local-personal",
        title: pathState.course.title,
        objective: pathState.course.objective,
        estimatedDuration: pathState.course.estimatedDuration,
        modules: pathState.course.modules,
        status: "draft",
        origin: "personal",
        local: true,
        progress: {
          completed: Object.keys(pathState.completedLessons).length,
          total: pathState.course.modules.length,
          percent: pathProgress(),
        },
        assignment: null,
      });
    }
    const filtered = courseList.filter((course) => {
      if (!filter) return true;
      const haystack = `${course.title} ${course.objective}`.toLowerCase();
      return haystack.includes(filter);
    });
    const cards = filtered.length
      ? filtered.map((course) => {
          const isPersonal = course.origin === "personal";
          const tag = isPersonal ? '<span class="tag">Personnalisé</span>' : '<span class="tag teal">Assigné</span>';
          const recommended = course.progress && course.progress.percent < 100
            ? (course.progress.completed === 0 ? "Recommandée pour vous" : "En cours")
            : course.progress && course.progress.percent >= 100 ? "Terminée" : "";
          const deadline = course.assignment && course.assignment.deadline
            ? `<span>${ICON("calendar")}Échéance : ${new Date(course.assignment.deadline).toLocaleDateString("fr-FR")}</span>`
            : "";
          const isLocalPersonal = course.local === true;
          const structure = `<div class="course-structure" hidden><ol>${(course.modules || []).map((module) => {
            const moduleDone = isLocalPersonal && pathState.completedLessons[module.id];
            const iconName = moduleDone ? "checkCircle" : isLocalPersonal ? "bookOpen" : "layers";
            return `<li class="${moduleDone ? "done" : ""}">${ICON(iconName)}<span>${escapeHTML(module.title)}</span></li>`;
          }).join("")}</ol></div>`;
          const cta = isPersonal
            ? `<a class="button button-primary button-sm" href="#parcours">${ICON("play")}${course.progress && course.progress.percent > 0 ? "Continuer" : "Commencer"}</a>`
            : `<button class="button button-secondary button-sm" type="button" data-course-structure>${ICON("layers")}Voir le contenu</button>`;
          const structureToggle = isPersonal
            ? `<button class="button button-ghost button-sm" type="button" data-course-structure>${ICON("layers")}Voir le contenu</button>`
            : `<span class="tiny subtle">Cours affecté · ${course.progress ? `${course.progress.percent} % terminé` : "à commencer"}</span>`;
          return `<article class="card course-card">
            <div class="card-top">${tag}${recommended ? `<span class="tag ${course.progress && course.progress.percent > 0 && course.progress.percent < 100 ? "warning" : "success"}">${escapeHTML(recommended)}</span>` : ""}</div>
            <div class="course-card-body">
              <h3>${escapeHTML(course.title)}</h3>
              <p class="small subtle">${escapeHTML(course.objective)}</p>
              <div class="course-meta">
                <span>${ICON("layers")}${course.modules.length} modules</span>
                <span>${ICON("clock")}${escapeHTML(course.estimatedDuration || "ì votre rythme")}</span>
                ${deadline}
              </div>
              ${course.progress ? `<div class="meter"><progress class="progress-track thin" max="100" value="${course.progress.percent}" aria-label="Progression : ${course.progress.percent} %"></progress><span class="meter-value">${course.progress.percent}%</span></div>` : ""}
            </div>
            ${structure}
            <div class="course-card-foot">
              ${cta}
              ${structureToggle}
            </div>
          </article>`;
        }).join("")
      : `<div class="empty-state" style="grid-column:1/-1">${ICON("search", "icon icon-xl")}<h3>Aucun cours ne correspond à votre recherche</h3><p>Essayez un autre mot-clé ou créez votre parcours personnalisé.</p></div>`;

    const myCourseIds = new Set(courseList.map((course) => course.id));
    const catalogue = (Array.isArray(catalogueData) ? catalogueData : []).filter((course) => !myCourseIds.has(course.id));
    const catalogueSection = authed && catalogue.length
      ? `<div class="section-heading"><div><p class="eyebrow">Catalogue</p><h2>Cours publiés par l’administration</h2></div><span class="section-note">${catalogue.length} cours disponible${catalogue.length > 1 ? "s" : ""}</span></div>
        <div class="card-grid">${catalogue.map((course) => `<article class="card course-card">
          <div class="card-top"><span class="tag teal">Publié</span><span class="small subtle">${(course.modules || []).length} modules</span></div>
          <div class="course-card-body">
            <h3>${escapeHTML(course.title)}</h3>
            <p class="small subtle">${escapeHTML((course.objective || "").slice(0, 150))}</p>
            <div class="course-meta"><span>${ICON("layers")}${(course.modules || []).length} modules</span><span>${ICON("clock")}${escapeHTML(course.estimatedDuration || "ì votre rythme")}</span></div>
          </div>
          <div class="course-card-foot"><button class="button button-primary button-sm" type="button" data-catalogue-add="${escapeHTML(course.id)}">${ICON("plus")}Ajouter à mes parcours</button></div>
        </article>`).join("")}</div>
        <p class="tiny subtle">L’ajout d’un cours du catalogue remplace votre parcours personnalisé actuel ; les cours qui vous sont affectés restent disponibles.</p>`
      : "";
    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Formations</p>
          <h1 id="formations-title" tabindex="-1">Vos formations</h1>
          <p class="lede">Votre parcours personnalisé, les cours affectés par votre administrateur et la formation guidée.</p>
        </div>
      </div>
      <div class="catalog-toolbar">
        <div class="search-field">${ICON("search")}<input class="input-text" type="search" placeholder="Rechercher une formation…" value="${escapeHTML(formationsFilter)}" data-formations-search aria-label="Rechercher une formation" /></div>
        <span class="tiny subtle">${filtered.length} formation${filtered.length > 1 ? "s" : ""}</span>
      </div>
      <div class="card-grid">${cards}</div>
      ${catalogueSection}
      <div class="section-heading"><div><p class="eyebrow">Autres pratiques</p><h2>Entraînement guidé</h2></div></div>
      <div class="card-grid">
        <article class="card course-card">
          <div class="card-top"><span class="tag neutral">Guidé</span></div>
          <div class="course-card-body">
            <h3>Communication en pharmacie</h3>
            <p class="small subtle">Les trois réflexes : demander la préférence de langue, expliquer une étape à la fois, vérifier la compréhension.</p>
            <div class="course-meta"><span>${ICON("layers")}3 étapes</span><span>${ICON("clock")}15 minutes</span><span>${ICON("cap")}Fondamentaux</span></div>
          </div>
          <div class="course-card-foot">${routeLink("vorbereitung", "Ouvrir", "button-secondary button-sm")}</div>
        </article>
      </div>
    </div>`;
  }

  function renderSimulationsHub() {
    if (scenarioList === null) {
      loadScenarios();
      return `<div class="page-shell">
        <div class="page-head-row"><div><p class="eyebrow">Simulations</p><h1 id="simulations-title" tabindex="-1">Mise en pratique</h1></div></div>
        <div class="grid-3">${"123".split("").map(() => '<div class="skeleton skeleton-card" style="height:190px"></div>').join("")}</div>
      </div>`;
    }
    if (!scenarioList.length) {
      return `<div class="page-shell">
        <div class="page-head-row"><div><p class="eyebrow">Simulations</p><h1 id="simulations-title" tabindex="-1">Mise en pratique</h1></div></div>
        <div class="error-state" role="alert"><h3>Les scénarios n’ont pas pu être chargés</h3><p>Vérifiez que le serveur est démarré, puis réessayez.</p><div class="button-row tight"><button class="button button-primary button-sm" type="button" data-sim-retry>${ICON("refresh")}Réessayer</button></div></div>
        <div class="section-heading"><div><h2>Entraînement guidé</h2></div></div>
        <div class="card-grid"><article class="card course-card"><div class="card-top"><span class="tag neutral">Guidé</span></div><div class="course-card-body"><h3>Communication en pharmacie</h3><p class="small subtle">Trois étapes à choix multiples avec retour immédiat.</p></div><div class="course-card-foot">${routeLink("simulation", "Commencer", "button-secondary button-sm")}</div></article></div>
      </div>`;
    }
    const cards = scenarioList.map((scenario) => `<article class="card scenario-card">
      <div class="card-top">
        <span class="scenario-topic">${ICON(topicIcon(scenario.topic))}${escapeHTML(scenario.topicLabel || scenario.topic)}</span>
        <span class="tag neutral">${escapeHTML(scenario.difficulty)}</span>
      </div>
      <h3>${escapeHTML(scenario.title)}</h3>
      <p class="small subtle">${escapeHTML(scenario.objective)}</p>
      <div class="course-meta"><span>${ICON("check")}${(scenario.criteria || []).length} critères évalués</span><span>${ICON("clock")}≈ 3 min</span></div>
      <div class="course-card-foot"><button class="button button-primary button-sm" type="button" data-sim-scenario="${escapeHTML(scenario.id)}">${ICON("play")}Commencer</button></div>
    </article>`).join("");
    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Simulations</p>
          <h1 id="simulations-title" tabindex="-1">Mise en pratique</h1>
          <p class="lede">Choisissez une situation : la personne simulée réagit comme une vraie personne, puis l’analyse identifie votre prochain entraînement.</p>
        </div>
      </div>
      <div class="card-grid">${cards}</div>
      <div class="section-heading"><div><p class="eyebrow">Autres pratiques</p><h2>Entraînement guidé</h2></div></div>
      <div class="card-grid"><article class="card course-card">
        <div class="card-top"><span class="tag neutral">Guidé</span></div>
        <div class="course-card-body"><h3>Communication en pharmacie</h3><p class="small subtle">Trois étapes à choix multiples avec retour immédiat.</p></div>
        <div class="course-card-foot">${routeLink("simulation", "Commencer", "button-secondary button-sm")}</div>
      </article></div>
    </div>`;
  }

  function pathSkills() {
    const completed = Object.keys(pathState.completedLessons).length;
    const evaluation = aiState.evaluation && aiState.evaluation.status === "done" ? aiState.evaluation.data : null;
    const acquis = evaluation ? evaluation.criteria.filter((criterion) => criterion.status === "acquis").length : 0;
    const renforcer = evaluation ? evaluation.criteria.filter((criterion) => criterion.status === "a_renforcer").length : 0;
    const quizOk = Object.values(pathState.quizResults).filter((result) => result.assessment === "appropriate").length;
    const base = pathState.course ? 20 : 0;
    return {
      "Communication": Math.min(100, base + completed * 10 + acquis * 12 + Math.round(renforcer * 6)),
      "Conseil client": Math.min(100, base + completed * 10 + quizOk * 15),
      "Gestion des objections": Math.min(100, completed * 14 + quizOk * 10),
      "Connaissances produits": Math.min(100, completed * 12),
    };
  }

  let progressionData = null;

  function loadProgression() {
    if (progressionData !== null) return;
    progressionData = "loading";
    const fetchers = [
      apiGet("/api/me/progress").catch(() => null),
      apiGet("/api/me/simulations").catch(() => null),
      apiGet("/api/me/dashboard").catch(() => null),
    ];
    Promise.all(fetchers)
      .then(([progress, simulations, dashboard]) => {
        progressionData = { progress, simulations, dashboard };
      })
      .catch(() => {
        progressionData = { progress: null, simulations: null, dashboard: null };
      })
      .finally(() => {
        if (routeFromHash() === "progression") render("progression");
      });
  }

  function progressionSkeleton() {
    return `<div class="page-shell">
      <div class="skeleton skeleton-line" style="width:30%;height:26px;margin-bottom:1.6rem"></div>
      <div class="skeleton skeleton-card" style="height:90px;margin-bottom:1.4rem"></div>
      <div class="skeleton skeleton-card" style="height:260px"></div>
    </div>`;
  }

  function skillLevel(value) {
    if (value >= 80) return { label: "Acquis", tone: "success" };
    if (value >= 40) return { label: "En progression", tone: "warning" };
    return { label: "ì renforcer", tone: "warning" };
  }

  function renderProgression() {
    const authed = window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated();
    if (authed) {
      if (progressionData === null) {
        loadProgression();
        return progressionSkeleton();
      }
      if (progressionData === "loading") return progressionSkeleton();
      return renderServerProgression(progressionData);
    }
    return renderLocalProgression();
  }

  function renderServerProgression(data) {
    const progress = (data && data.progress) || {};
    const simulations = (data && data.simulations) || {};
    const dashboard = (data && data.dashboard) || {};
    const skills = progress.skills || pathSkills();
    const weakPoints = dashboard.weakPoints || [];
    const strongPoints = dashboard.strongPoints || [];
    const simList = (simulations.simulations || []).slice(0, 8);
    const courseRows = (progress.courseProgress || []).map((course) => `
      <div class="skill-row">
        <div class="skill-label"><span>${escapeHTML(course.title)}</span><span>${course.progress.percent}%</span></div>
        <progress class="progress-track" max="100" value="${course.progress.percent}" aria-label="${escapeHTML(course.title)} : ${course.progress.percent} %"></progress>
      </div>`).join("");
    const skillBars = Object.keys(skills).map((name) => {
      const value = skills[name];
      const level = skillLevel(value);
      return `<div class="skill-row">
        <div class="skill-label"><span>${escapeHTML(name)}</span><span><span class="tag ${level.tone}">${level.label}</span> ${value}%</span></div>
        <progress class="progress-track" max="100" value="${value}" aria-label="${escapeHTML(name)} : ${value} % — ${level.label}"></progress>
      </div>`;
    }).join("");
    const historyHTML = simList.length
      ? `<ul class="history-list">${simList.map((sim) => `<li><span class="icon-wrap teal" style="width:34px;height:34px;border-radius:9px">${ICON("chat", "icon")}</span><span class="history-body"><strong>${escapeHTML(sim.scenarioTitle)}</strong><span>${new Date(sim.createdAt).toLocaleDateString("fr-FR")}${sim.evaluation && sim.evaluation.priority ? ` · Priorité : ${escapeHTML(sim.evaluation.priority)}` : ""}</span></span></li>`).join("")}</ul>`
      : '<p class="small subtle">Vos simulations apparaîtront ici. Lancez votre première mise en pratique.</p>';
    const weakHTML = weakPoints.length
      ? `<ul class="skill-list">${weakPoints.map((item) => `<li><span>${escapeHTML(item.label)}</span><span class="tag warning">${item.count} </span></li>`).join("")}</ul>`
      : '<p class="small subtle">Aucun point à renforcer pour le moment.</p>';
    const strongHTML = strongPoints.length
      ? `<ul class="skill-list">${strongPoints.map((item) => `<li><span>${escapeHTML(item.label)}</span><span class="tag success">${item.count} </span></li>`).join("")}</ul>`
      : '<p class="small subtle">Vos points forts apparaîtront après vos premières simulations.</p>';

    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Progression</p>
          <h1 id="progression-title" tabindex="-1">Votre progression</h1>
          <p class="lede">Leçons, compétences et simulations : tout ce que vous avez accompli, à jour.</p>
        </div>
      </div>
      <div class="metric-tiles">
        <div class="metric-tile">${ICON("checkCircle", "icon")}<strong>${progress.lessonsCompleted || 0}</strong><span>Leçons terminées</span></div>
        <div class="metric-tile">${ICON("chat", "icon")}<strong>${(simList && simulations.simulations ? simulations.simulations.length : 0) || 0}</strong><span>Simulations réalisées</span></div>
        <div class="metric-tile">${ICON("chart", "icon")}<strong>${dashboard.overallProgress || 0}%</strong><span>Progression générale</span></div>
        <div class="metric-tile">${ICON("sparkles", "icon")}<strong>${(simulations.evaluations || []).length || 0}</strong><span>Évaluations IA reçues</span></div>
      </div>
      <div class="progress-layout">
        <div>
          <div class="section-heading"><div><p class="eyebrow">Compétences</p><h2>Vos compétences au comptoir</h2></div></div>
          <div class="card"><div class="skill-bars">${skillBars}</div><p class="tiny subtle" style="margin-top:1rem">Valeurs calculées à partir des leçons terminées, des exercices et de vos simulations.</p></div>
          <div class="section-heading"><div><p class="eyebrow">Formations</p><h2>Progression par cours</h2></div></div>
          <div class="card">${courseRows ? `<div class="skill-bars">${courseRows}</div>` : '<p class="small subtle">Aucun cours en cours pour le moment.</p>'}</div>
        </div>
        <div>
          <div class="section-heading"><div><p class="eyebrow">Simulations</p><h2>Vos dernières mises en pratique</h2></div></div>
          <div class="card">${historyHTML}<div class="button-row tight"><a class="button button-secondary button-sm" href="#simulations">${ICON("play")}Faire une simulation</a></div></div>
          <div class="section-heading"><div><p class="eyebrow">Analyse</p><h2>Points à renforcer</h2></div></div>
          <div class="card">${weakHTML}<div class="button-row tight"><a class="button button-ghost button-sm" href="#simulations">${ICON("target")}Pratiquer ces points</a></div></div>
          <div class="section-heading"><div><p class="eyebrow">Analyse</p><h2>Points forts</h2></div></div>
          <div class="card">${strongHTML}</div>
        </div>
      </div>
    </div>`;
  }

  function renderLocalProgression() {
    const skills = pathSkills();
    const bars = Object.keys(skills).map((name) => {
      const value = skills[name];
      const level = skillLevel(value);
      return `<div class="skill-row"><div class="skill-label"><span>${escapeHTML(name)}</span><span><span class="tag ${level.tone}">${level.label}</span> ${value}%</span></div><progress class="progress-track" max="100" value="${value}" aria-label="${escapeHTML(name)} : ${value} %"></progress></div>`;
    }).join("");
    const courseCard = pathState.course
      ? `<div class="card"><h3>${escapeHTML(pathState.course.title)}</h3><div class="meter"><progress class="progress-track" max="100" value="${pathProgress()}" aria-label="Progression : ${pathProgress()} %"></progress><span class="meter-value">${pathProgress()}%</span></div><p class="tiny subtle" style="margin-top:.5rem">${pathState.course.modules.filter((module) => pathState.completedLessons[module.id]).length}/${pathState.course.modules.length} modules</p></div>`
      : `<div class="card"><h3>Aucun parcours en cours</h3><div class="button-row tight">${routeLink("accueil", "Définir mon objectif", "button-secondary button-sm")}</div></div>`;
    return `<div class="page-shell">
      <div class="page-head-row"><div><p class="eyebrow">Progression</p><h1 id="progression-title" tabindex="-1">Votre progression</h1><p class="lede">Leçons, compétences et simulations de ce navigateur.</p></div></div>
      ${courseCard}
      <div class="section-heading"><div><p class="eyebrow">Compétences</p><h2>Vos compétences au comptoir</h2></div></div>
      <div class="card"><div class="skill-bars">${bars}</div><p class="tiny subtle" style="margin-top:1rem">Valeurs indicatives, calculées à partir des leçons terminées, des exercices et de vos simulations.</p></div>
    </div>`;
  }

  function renderLessonSection(section, moduleId) {
    if (section.type === "concept") {
      return `<div class="section-block"><h3>${ICON("info")}${escapeHTML(section.title)}</h3><div class="prose">${escapeHTML(section.content)}</div></div>`;
    }
    if (section.type === "example" || section.type === "scenario") {
      return `<div class="section-block example"><h3>${ICON("chat")}${escapeHTML(section.title)}</h3>
        <div class="dialogue">
          <div class="dialogue-line"><span class="mini-avatar" aria-hidden="true">CL</span><div class="dialogue-bubble"><span class="dialogue-who">Client</span>${escapeHTML(section.situation)}</div></div>
          <div class="dialogue-line pharmacist"><span class="mini-avatar" aria-hidden="true">PH</span><div class="dialogue-bubble"><span class="dialogue-who">Pharmacien</span>${escapeHTML(section.response)}</div></div>
        </div></div>`;
    }
    if (section.type === "key_points") {
      return `<div class="section-block"><h3>${ICON("checkCircle")}${escapeHTML(section.title)}</h3><ul class="key-points">${section.items.map((item, index) => `<li><span class="num">${index + 1}</span><span>${escapeHTML(item)}</span></li>`).join("")}</ul></div>`;
    }
    if (section.type === "checklist") {
      return `<div class="section-block"><h3>${ICON("check")}${escapeHTML(section.title)}</h3><ul class="checklist">${section.items.map((item) => `<li>${ICON("checkCircle")}<span>${escapeHTML(item)}</span></li>`).join("")}</ul></div>`;
    }
    if (section.type === "warning") {
      return `<div class="section-block warning"><h3>${ICON("alert")}${escapeHTML(section.title)}</h3><p class="prose">${escapeHTML(section.content)}</p></div>`;
    }
    if (section.type === "summary") {
      return `<div class="section-block summary"><h3>${ICON("award")}${escapeHTML(section.title)}</h3>${section.content ? `<p class="prose">${escapeHTML(section.content)}</p>` : ""}${section.items && section.items.length ? `<ul class="key-points">${section.items.map((item, index) => `<li><span class="num">${index + 1}</span><span>${escapeHTML(item)}</span></li>`).join("")}</ul>` : ""}</div>`;
    }
    if (section.type === "comparison") {
      const rows = section.items.map((item) => `<li><span class="comparison-label">${escapeHTML(item.label)}</span><div class="comparison-cols"><div class="comparison-good"><span class="comparison-heading">${ICON("check")}ì privilégier</span>${escapeHTML(item.left)}</div><div class="comparison-bad"><span class="comparison-heading">${ICON("close")}ì éviter</span>${escapeHTML(item.right)}</div></div></li>`).join("");
      return `<div class="section-block"><h3>${ICON("scale")}${escapeHTML(section.title)}</h3><ul class="comparison">${rows}</ul></div>`;
    }
    if (section.type === "process") {
      const steps = section.steps.map((step, index) => `<li><span class="step-num">${index + 1}</span><div><strong>${escapeHTML(step.title)}</strong>${step.description ? `<p>${escapeHTML(step.description)}</p>` : ""}</div></li>`).join("");
      return `<div class="section-block"><h3>${ICON("path")}${escapeHTML(section.title)}</h3><ol class="process-steps">${steps}</ol></div>`;
    }
    if (section.type === "timeline") {
      const items = section.items.map((item) => `<li><span class="timeline-marker" aria-hidden="true"></span><div><strong>${escapeHTML(item.label)}</strong>${item.text ? `<p>${escapeHTML(item.text)}</p>` : ""}</div></li>`).join("");
      return `<div class="section-block"><h3>${ICON("clock")}${escapeHTML(section.title)}</h3><ol class="timeline">${items}</ol></div>`;
    }
    if (section.type === "diagram") {
      const nodes = section.nodes.map((node) => `<div class="diagram-node"><strong>${escapeHTML(node.label)}</strong>${node.text ? `<span>${escapeHTML(node.text)}</span>` : ""}</div>`).join('<span class="diagram-arrow" aria-hidden="true"></span>');
      return `<div class="section-block"><h3>${ICON("layers")}${escapeHTML(section.title)}</h3><div class="diagram">${nodes}</div></div>`;
    }
    if (section.type === "chart") {
      const bars = section.data.map((entry) => `<div class="skill-row"><div class="skill-label"><span>${escapeHTML(entry.label)}</span><span>${entry.value}%</span></div><progress class="progress-track" max="100" value="${entry.value}" aria-label="${escapeHTML(entry.label)} : ${entry.value} %">${entry.value}%</progress></div>`).join("");
      return `<div class="section-block"><h3>${ICON("chart")}${escapeHTML(section.title)}</h3><div class="skill-bars">${bars}</div></div>`;
    }
    if (section.type === "question") {
      const quiz = pathState.quizResults[moduleId];
      if (quiz) {
        const labels = { appropriate: "Réponse adaptée", partial: "Partiellement adaptée", a_ameliorer: "ì améliorer" };
        const tagClass = quiz.assessment === "appropriate" ? "success" : quiz.assessment === "a_ameliorer" ? "warning" : "warning";
        const feedbackIcon = quiz.assessment === "appropriate" ? "checkCircle" : "alert";
        return `<div class="section-block exercise-box"><h3>${ICON("target")}${escapeHTML(section.title)}</h3><p class="strong">${escapeHTML(section.question)}</p>
          <div class="feedback-panel">
            <div class="feedback-head"><h4>${ICON(feedbackIcon)}Analyse du coach</h4><span class="tag ${tagClass}">${labels[quiz.assessment] || "Résultat"}</span></div>
            <p>${escapeHTML(quiz.explanation)}</p>
            <div class="key-takeaway">${ICON("zap")}<span><strong>ì retenir :</strong> ${escapeHTML(quiz.keyPoint)}</span></div>
            <div class="button-row tight"><button class="button button-secondary button-sm" type="button" data-exercise-retry>${ICON("refresh")}Réessayer</button></div>
          </div></div>`;
      }
      if (pathState.quizBusy) {
        return `<div class="section-block exercise-box" role="status"><h3>${ICON("target")}${escapeHTML(section.title)}</h3><p class="strong">${escapeHTML(section.question)}</p><div class="loading-inline"><span class="spinner" aria-hidden="true"></span>Analyse de votre réponse…</div></div>`;
      }
      const exerciseError = pathState.error
        ? `<div class="ai-error" role="alert">${ICON("alert", "icon")}<div><p class="small">${escapeHTML(pathState.error.message)}</p></div></div>`
        : "";
      if (section.options && section.options.length) {
        return `<div class="section-block exercise-box"><h3>${ICON("target")}${escapeHTML(section.title)}</h3><p class="strong">${escapeHTML(section.question)}</p>${exerciseError}<div class="answer-list">${section.options.map((option, index) => `<button class="answer" type="button" data-path-answer="${index}">${ICON("chat")}<span>${escapeHTML(option)}</span></button>`).join("")}</div></div>`;
      }
      return `<div class="section-block exercise-box"><h3>${ICON("target")}${escapeHTML(section.title)}</h3><p class="strong">${escapeHTML(section.question)}</p>${exerciseError}<form data-path-answer-form><textarea class="textarea" data-path-answer-input rows="3" placeholder="Votre réponse…"></textarea><div class="button-row"><button class="button button-primary" type="submit">${ICON("send")}Vérifier ma réponse</button></div></form></div>`;
    }
    return "";
  }

  let coachCollapsed = false;

  function renderLecon() {
    const authed = Boolean(window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated());
    const pendingModuleId = authed ? peekSession("bp-open-module") : null;
    if (pendingModuleId) {
      if (!Array.isArray(coursesData)) {
        loadFormations();
        return `<div class="page-shell narrow"><div class="page-head-row"><div><p class="eyebrow">Leçon</p><h1 id="lecon-title" tabindex="-1">Leçon</h1></div></div><div class="skeleton skeleton-card" style="height:260px"></div></div>`;
      }
      const course = coursesData.find((item) => (item.modules || []).some((module) => module.id === pendingModuleId));
      if (course) {
        applyServerCourse(course);
        pathState.activeModuleId = pendingModuleId;
        pathState.error = null;
        savePathState();
        clearSession("bp-open-module");
      }
    }
    const moduleId = pathState.activeModuleId;
    if (!pathState.course || !moduleId) {
      return `<div class="page-shell narrow"><div class="page-head-row"><div><p class="eyebrow">Leçon</p><h1 id="lecon-title" tabindex="-1">Leçon</h1></div></div><div class="empty-state">${ICON("bookOpen", "icon icon-xl")}<h3>Aucune leçon sélectionnée</h3><p>Ouvrez un module depuis votre parcours pour commencer une leçon.</p><div class="button-row"><a class="button button-primary" href="#parcours">${ICON("arrowLeft")}Retour au parcours</a></div></div></div>`;
    }
    const module = pathState.course.modules.find((item) => item.id === moduleId);
    if (!module) {
      return `<div class="page-shell narrow"><div class="page-head-row"><div><p class="eyebrow">Leçon</p><h1 id="lecon-title" tabindex="-1">Leçon</h1></div></div><div class="empty-state">${ICON("alert", "icon icon-xl")}<h3>Ce module n’existe pas dans votre parcours</h3><div class="button-row"><a class="button button-primary" href="#parcours">${ICON("arrowLeft")}Retour au parcours</a></div></div></div>`;
    }
    const lesson = pathState.lessons[moduleId];
    const loading = Boolean(pathState.lessonLoading[moduleId]);
    const done = Boolean(pathState.completedLessons[moduleId]);
    const moduleIndex = pathState.course.modules.findIndex((item) => item.id === moduleId);
    const nextModule = moduleIndex >= 0 && moduleIndex < pathState.course.modules.length - 1
      ? pathState.course.modules[moduleIndex + 1]
      : null;
    const doneCount = pathState.course.modules.filter((item) => pathState.completedLessons[item.id]).length;

    const outline = pathState.course.modules.map((item, index) => {
      const isDone = Boolean(pathState.completedLessons[item.id]);
      const isCurrent = item.id === moduleId;
      const iconName = isDone ? "checkCircle" : isCurrent ? "play" : "lock";
      return `<li><button class="outline-item ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}" type="button" data-path-open-lesson="${escapeHTML(item.id)}">
        ${ICON(iconName)}<span>${escapeHTML(item.title)}</span></button></li>`;
    }).join("");

    const error = pathState.error && !lesson
      ? `<div class="ai-error" role="alert" tabindex="-1" data-path-error>${ICON("alert", "icon")}<div><p class="small">${escapeHTML(pathState.error.message)}</p><div class="button-row tight"><button class="button button-secondary" type="button" data-path-retry-lesson>${ICON("refresh")}Réessayer</button></div></div></div>`
      : "";
    const content = loading
      ? `<div class="section-block lesson-loading" role="status">
          <div class="loading-inline"><span class="spinner" aria-hidden="true"></span><div><strong>Votre coach prépare la leçon…</strong><p class="tiny subtle" style="margin:0">Génération du contenu adapté à ce module — quelques secondes.</p></div></div>
          <div class="skeleton skeleton-line" style="width:38%;height:20px;margin-top:1.4rem"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>`
      : error
        ? error
        : lesson
          ? `<div class="lesson-stack">${lesson.sections.map((section) => renderLessonSection(section, moduleId)).join("")}</div>${done ? renderLessonCompletion(moduleIndex, nextModule) : `<div class="completion-card completion-pending"><div class="completion-title">${ICON("bookOpen")}Fin de la leçon</div><p>Vous avez lu tout le contenu. Marquez la leçon comme terminée pour passer à la suite.</p><div class="button-row tight"><button class="button button-primary" type="button" data-path-complete>${ICON("check")}Marquer comme terminé</button>${routeLink("ia", "Passer à la mise en pratique", "button-secondary")}</div></div>`}`
          : "";

    const tutorMessages = pathState.tutor[moduleId] || [];
    const tutorBusy = pathState.tutorBusy;
    const tutorError = pathState.tutorError
      ? `<div class="ai-error" role="alert">${ICON("alert", "icon")}<div><p class="small">${escapeHTML(pathState.tutorError.message)}</p><div class="button-row tight"><button class="button button-secondary button-sm" type="button" data-tutor-retry>${ICON("refresh")}Réessayer</button></div></div></div>`
      : "";
    const coachEmpty = tutorMessages.length === 0 && !tutorBusy
      ? `<div class="coach-empty">${ICON("sparkles")}<p>Je connais le contenu de cette leçon. Posez-moi une question ou utilisez les suggestions ci-dessus.</p></div>`
      : "";
    const quickPrompts = [
      ["Expliquez-moi ce concept", "Expliquez-moi ce concept simplement, avec un exemple du comptoir."],
      ["Donnez-moi un exemple", "Donnez-moi un exemple concret de client pour illustrer cette leçon."],
      ["Testez ma compréhension", "Posez-moi une question courte pour tester ma compréhension de cette leçon."],
      ["Résumez cette partie", "Résumez les points essentiels de cette leçon en trois phrases."],
    ];
    const coachDockLines = tutorMessages.length
      ? tutorMessages.slice(-3).map((message) => {
          const isUser = message.role === "user";
          return `<span class="coach-dock-line ${isUser ? "user" : ""}"><b>${isUser ? "Vous" : "Coach"}</b><span>${escapeHTML(message.content)}</span></span>`;
        }).join("")
      : quickPrompts.slice(0, 3).map(([label]) => `<span class="coach-dock-line hint">${ICON("chat")}<span>${escapeHTML(label)}</span></span>`).join("");

    return `<div class="page-shell">
      <div class="lesson-shell ${coachCollapsed ? "coach-collapsed" : ""}">
        <aside class="lesson-outline" aria-label="Plan du parcours">
          <div class="lesson-outline-head"><span class="tiny">Votre parcours</span><a class="button button-ghost button-sm" href="#parcours">${ICON("arrowLeft")}Retour</a></div>
          <div class="outline-progress">
            <span class="tiny"><span>${doneCount}/${pathState.course.modules.length} terminés</span><span>${pathProgress()}%</span></span>
            <progress class="progress-track thin" max="100" value="${pathProgress()}" aria-label="Progression du parcours : ${pathProgress()} %"></progress>
          </div>
          <ol class="outline-list">${outline}</ol>
        </aside>

        <div>
          <div class="lesson-head">
            <p class="eyebrow">Module ${moduleIndex + 1} sur ${pathState.course.modules.length}</p>
            <h1 id="lecon-title" tabindex="-1">${escapeHTML(lesson ? lesson.lessonTitle : module.title)}</h1>
            <p class="lede">${escapeHTML(lesson ? lesson.objective : module.description)}</p>
            <div class="lesson-meta">
              <span>${ICON("clock")}${escapeHTML(pathState.course.estimatedDuration || "ì votre rythme")}</span>
              <span>${ICON("sparkles")}Contenu du coach IA</span>
              ${done ? `<span class="tag success">${ICON("checkCircle")}Leçon terminée</span>` : ""}
            </div>
          </div>
          ${content}
        </div>

        <aside class="coach-panel" aria-label="Coach IA">
          ${coachCollapsed
            ? `<button class="coach-dock" type="button" data-coach-open aria-label="Ouvrir le coach IA" aria-expanded="false">
                <span class="coach-dock-title">${ICON("sparkles")}<b>Coach IA</b><span class="coach-dock-sub">${tutorMessages.length ? `${tutorMessages.length} échanges` : "ì votre écoute"}</span><span class="coach-dock-chevron">${ICON("chevronDown")}</span></span>
                ${coachDockLines}
              </button>`
            : `<div class="coach-head">
                ${ICON("sparkles")}
                <div><h3>Coach IA</h3><span class="coach-sub">Spécialiste de cette leçon</span></div>
                <button class="coach-toggle" type="button" data-coach-toggle aria-label="Masquer le coach IA" aria-expanded="true">${ICON("close")}</button>
              </div>
              ${tutorMessages.length === 0
                ? `<div class="coach-quick" aria-label="Suggestions de questions">
                    ${quickPrompts.map(([label]) => `<button type="button" data-coach-prompt="${escapeHTML(label)}">${escapeHTML(label)}</button>`).join("")}
                  </div>`
                : ""}
              <div class="coach-messages">
                ${coachEmpty}
                ${tutorMessages.map((message) => `<div class="message${message.role === "user" ? " user" : ""}">${escapeHTML(message.content)}</div>`).join("")}
                ${tutorBusy ? '<div class="message" role="status"><span class="typing-dots"><span></span><span></span><span></span></span></div>' : ""}
              </div>
              ${tutorError}
              <form class="coach-form" data-tutor-form>
                <label class="field-label" for="tutor-input">Votre question</label>
                <div class="coach-composer">
                  ${ICON("sparkles", "coach-composer-icon")}
                  <textarea id="tutor-input" class="composer-input" rows="3" placeholder="Ex. : donnez-moi un exemple avec un client pressé" data-tutor-input ${tutorBusy || !lesson ? "disabled" : ""}></textarea>
                  <button class="coach-send" type="submit" aria-label="Envoyer la question au coach" ${tutorBusy || !lesson ? "disabled" : ""}>${ICON("send")}</button>
                </div>
                <p class="coach-hint">${ICON("shield")}Réponse basée sur le contenu de cette leçon</p>
              </form>`}
        </aside>
      </div>
    </div>`;
  }

  function renderLessonCompletion(moduleIndex, nextModule) {
    const nextButton = nextModule
      ? `<button class="button button-primary" type="button" data-path-open-lesson="${escapeHTML(nextModule.id)}">${ICON("arrowRight")}Leçon suivante : ${escapeHTML(nextModule.title)}</button>`
      : `<a class="button button-primary" href="#ia">${ICON("chat")}Passer à la simulation</a>`;
    return `<div class="completion-card">
      <div class="completion-title">${ICON("checkCircle")}Vous avez terminé cette leçon</div>
      <p>${nextModule ? "La leçon suivante vous attend — ou passez directement à la mise en pratique." : "C’était la dernière leçon du parcours. Place à la simulation !"}</p>
      <div class="button-row tight">
        ${nextButton}
        ${routeLink("ia", "Passer à la mise en pratique", "button-secondary")}
        ${routeLink("parcours", "Retour au parcours", "button-ghost")}
      </div>
    </div>`;
  }

  async function createPath(objective) {
    if (pathState.status === "generating") return;
    pathState.objective = objective;
    pathState.status = "generating";
    pathState.error = null;
    savePathState();
    render("accueil");
    try {
      const course = await apiPost("/api/course/generate", { objective });
      if (!course || !Array.isArray(course.modules) || course.modules.length < 3) throw { code: "course_invalid" };
      pathState.course = course;
      pathState.status = "ready";
      if (window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated()) {
        window.BP_PLATFORM.saveCourse(course);
        coursesData = null;
      }
    } catch (error) {
      pathState.status = "error";
      pathState.error = { code: error.code || "ai_error", message: aiErrorMessage(error.code === "course_invalid" ? "course_invalid" : error.code) };
    }
    savePathState();
    render("accueil");
    if (pathState.status === "ready") go("parcours");
  }

  async function generateLesson(moduleId) {
    const module = pathState.course ? pathState.course.modules.find((item) => item.id === moduleId) : null;
    if (!module || pathState.lessons[moduleId] || pathState.lessonLoading[moduleId]) return;
    pathState.lessonLoading[moduleId] = true;
    pathState.error = null;
    savePathState();
    render("lecon");
    try {
      const lesson = await apiPost("/api/lesson/generate", {
        courseTitle: pathState.course.title,
        moduleTitle: module.title,
        moduleDescription: module.description,
        moduleIndex: pathState.course.modules.findIndex((item) => item.id === moduleId),
      });
      if (!lesson || !Array.isArray(lesson.sections) || !lesson.sections.length) throw { code: "lesson_invalid" };
      pathState.lessons[moduleId] = lesson;
    } catch (error) {
      pathState.error = { code: error.code || "ai_error", message: aiErrorMessage(error.code === "lesson_invalid" ? "lesson_invalid" : error.code) };
    }
    delete pathState.lessonLoading[moduleId];
    savePathState();
    render("lecon");
  }

  async function submitExercise(moduleId, section, answer) {
    if (pathState.quizResults[moduleId] || pathState.quizBusy) return;
    pathState.quizBusy = true;
    savePathState();
    render("lecon");
    try {
      const result = await apiPost("/api/exercise/evaluate", { question: section.question, options: section.options || [], answer });
      if (!result || typeof result.explanation !== "string") throw { code: "exercise_invalid" };
      pathState.quizResults[moduleId] = {
        assessment: result.assessment || "partial",
        explanation: result.explanation,
        keyPoint: typeof result.key_point === "string" ? result.key_point : "",
      };
      if (window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated()) {
        window.BP_PLATFORM.saveQuizResult(moduleId, pathState.quizResults[moduleId]);
      }
    } catch (error) {
      pathState.error = { code: "exercise_invalid", message: aiErrorMessage("exercise_invalid") };
    }
    pathState.quizBusy = false;
    savePathState();
    render("lecon");
  }

  async function tutorRequest(moduleId, messages) {
    const lesson = pathState.lessons[moduleId];
    try {
      const data = await apiPost("/api/tutor", {
        lessonTitle: lesson.lessonTitle,
        lessonObjective: lesson.objective,
        lessonSummary: buildLessonSummary(lesson),
        messages,
      });
      if (typeof data.reply !== "string" || !data.reply.trim()) throw { code: "ai_error" };
      pathState.tutor[moduleId] = [...messages, { role: "assistant", content: data.reply.slice(0, 4000) }];
      pathState.tutorError = null;
    } catch (error) {
      pathState.tutorError = { code: error.code || "ai_error", message: aiErrorMessage(error.code) };
    }
    pathState.tutorBusy = false;
    savePathState();
    render("lecon");
  }

  async function sendTutorMessage(moduleId, text) {
    if (pathState.tutorBusy || !text.trim()) return;
    const messages = [...(pathState.tutor[moduleId] || []), { role: "user", content: text.trim().slice(0, 1500) }];
    pathState.tutor[moduleId] = messages;
    pathState.tutorBusy = true;
    pathState.tutorError = null;
    savePathState();
    render("lecon");
    await tutorRequest(moduleId, messages);
  }

  const PRINCIPLE_LABELS = {
    preference: "Demander la préférence",
    structure: "Expliquer étape par étape",
    verification: "Vérifier la compréhension",
  };

  function renderReflexCard(turn, index) {
    const label = PRINCIPLE_LABELS[turn.principleId] || turn.principleId;
    const answer = state.dialogueAnswers[index];
    if (answer === undefined) {
      return `<article class="card"><span class="tag">Non évalué</span><h3>${escapeHTML(label)}</h3><p class="subtle small">Cette étape n’a pas encore été évaluée.</p></article>`;
    }
    const isBest = answer === turn.best;
    const perChoice = Array.isArray(turn.choiceFeedback) ? turn.choiceFeedback[answer] : turn.feedback;
    const recommended = isBest ? "" : `<p class="small"><strong>Approche recommandée :</strong> « ${escapeHTML(turn.choices[turn.best])} »</p>`;
    const action = isBest ? "" : `<div class="button-row"><button class="button button-secondary" type="button" data-retry-turn="${index}" aria-label="Revoir l’étape : ${escapeHTML(label)}">Revoir cette étape</button></div>`;
    return `<article class="card"><span class="tag ${isBest ? "success" : "warning"}">${isBest ? "Acquis" : "ì renforcer"}</span><h3>${escapeHTML(label)}</h3><p class="small">${escapeHTML(perChoice)}</p>${recommended}${action}</article>`;
  }

  function renderReflexes() {
    if (!state.dialogueAnswers.length) {
      return `<div class="card"><p class="subtle">Terminez d’abord le dialogue pour voir ce que vous maîtrisez et ce qui reste à renforcer.</p><div class="button-row tight">${routeLink("simulation", "Commencer la simulation", "button-secondary button-sm")}</div></div>`;
    }
    return `<div class="card-grid">${DATA.dialogue.map(renderReflexCard).join("")}</div>`;
  }

  function renderCompletion() {
    const answered = state.dialogueAnswers.length;
    const best = state.dialogueAnswers.reduce((sum, answer, index) => sum + (answer === DATA.dialogue[index].best ? 1 : 0), 0);
    const score = answered ? Math.round((best / DATA.dialogue.length) * 100) : 0;
    return `<div class="page-shell">
      <div class="result-hero">
        <div>
          <p class="eyebrow" style="color:rgba(255,255,255,.75)">Votre résultat</p>
          <h1 id="result-title" tabindex="-1">Résultat de la simulation guidée</h1>
          <p class="lede">Vous avez terminé ${answered} étapes sur ${DATA.dialogue.length}. Utilisez les modules pour consolider chaque principe de communication.</p>
          <div class="button-row">${routeLink("simulation", answered ? "Revoir la simulation" : "Commencer la simulation", "button-secondary")}${routeLink("lernplan", "Ouvrir le parcours", "button-secondary")}</div>
        </div>
        <div class="score-ring" style="--score:${score}" role="img" aria-label="${score} % de réponses recommandées sélectionnées"><div><strong>${score}%</strong><small>Dialogue</small></div></div>
      </div>
      <div class="section-heading"><div><p class="eyebrow">Auto-évaluation</p><h2>Vos réflexes de communication</h2></div><span class="section-note">Basé sur vos décisions</span></div>
      ${renderReflexes()}
      <div class="section-heading"><div><p class="eyebrow">Parcours adapté</p><h2>Trois vérifications rapides</h2></div><span class="section-note">Fictif et déterministe</span></div>
      <div class="card-grid">${DATA.learningModules.map(renderModule).join("")}</div>
    </div>`;
  }

  function renderModule(module) {
    const selected = state.quizAnswers[module.id];
    return `<article class="card"><span class="tag">${module.label}</span><h3>${module.title}</h3><p class="subtle">${module.description}</p><div class="quiz"><strong>${module.question}</strong><div class="answer-list">${module.answers.map((answer, index) => {
      let cls = "";
      if (selected !== undefined && index === module.correct) cls = "correct";
      else if (selected === index) cls = "wrong";
      return `<button class="answer ${cls}" type="button" data-module="${module.id}" data-answer="${index}" ${selected !== undefined ? "disabled" : ""}>${escapeHTML(answer)}</button>`;
    }).join("")}</div>${selected === undefined ? '<span class="small subtle">Choisissez une réponse.</span>' : `<span class="small ${selected === module.correct ? "" : "subtle"}">${selected === module.correct ? "Bonne réponse. " : "Pas tout à fait. "}La réponse recommandée est mise en évidence.</span>`}</div></article>`;
  }

  function renderPlan() {
    const value = progress();
    const quizDone = Object.keys(state.quizAnswers).length;
    return `<div class="page-shell narrow">
      <div class="page-head-row"><div><p class="eyebrow">Entraînement guidé</p><h1 id="plan-title" tabindex="-1">Votre parcours d’apprentissage</h1><p class="lede">La progression réunit préparation, dialogue et vérifications. Elle reflète les activités réalisées dans cet entraînement.</p></div></div>
      <div class="plan-grid">
        <div class="card">
          <h2>${ICON("path")}Prochaines étapes</h2>
          <ol class="timeline">
            <li><span class="timeline-marker" aria-hidden="true"></span><div><strong>Préparation</strong><p class="subtle">${state.prep.length}/${DATA.preparation.length} points préparés.</p><div class="button-row tight">${routeLink("vorbereitung", "Ouvrir", "button-secondary button-sm")}</div></div></li>
            <li><span class="timeline-marker" aria-hidden="true"></span><div><strong>Simulation de dialogue</strong><p class="subtle">${state.dialogueAnswers.length}/${DATA.dialogue.length} décisions prises.</p><div class="button-row tight">${routeLink("simulation", "Ouvrir", "button-secondary button-sm")}</div></div></li>
            <li><span class="timeline-marker" aria-hidden="true"></span><div><strong>Vérifications</strong><p class="subtle">${quizDone}/${DATA.learningModules.length} modules terminés.</p><div class="button-row tight">${routeLink("abschluss", "Ouvrir", "button-secondary button-sm")}</div></div></li>
          </ol>
        </div>
        <aside class="card">
          <p class="eyebrow">Progression globale</p>
          <h2>${value}%</h2>
          <progress class="progress-track" max="100" value="${value}" aria-label="Progression globale : ${value} %">${value}%</progress>
          <p class="small subtle">Valeur calculée de façon transparente à partir de trois activités de même poids.</p>
          <div class="button-row tight"><button class="button button-secondary button-sm" type="button" data-reset-all>${ICON("refresh")}Réinitialiser la progression locale</button></div>
        </aside>
      </div>
    </div>`;
  }

  const renderers = { start: renderStart, vorbereitung: renderPreparation, simulation: renderSimulation, ia: renderAi, abschluss: renderCompletion, lernplan: renderPlan, accueil: renderAccueil, parcours: renderParcours, "parcours-detail": renderParcoursDetail, formations: renderFormations, simulations: renderSimulationsHub, progression: renderProgression, lecon: renderLecon };

  function render(route = routeFromHash(), focus = false) {
    const platform = window.BP_PLATFORM;
    const activeRoute = ROUTES.has(route) ? route : "platform";
    const hideLearningViews = () => {
      views.forEach((view) => {
        if (view.dataset.view !== "platform") view.hidden = true;
      });
    };
    if (activeRoute === "platform") {
      hideLearningViews();
      return;
    }
    if (platform && !platform.canAccessApp()) {
      hideLearningViews();
      platform.redirectToLogin();
      return;
    }
    if (activeRoute === "lecon") {
      const resumeModule = sessionStorage.getItem("bp-open-module");
      if (resumeModule) {
        sessionStorage.removeItem("bp-open-module");
        if (pathState.course && pathState.course.modules.some((module) => module.id === resumeModule)) {
          pathState.activeModuleId = resumeModule;
          pathState.error = null;
          savePathState();
        }
      }
    }
    views.forEach((view) => {
      if (view.dataset.view === "platform") {
        view.hidden = true;
        return;
      }
      const active = view.dataset.view === activeRoute;
      view.hidden = !active;
      if (active) view.innerHTML = renderers[activeRoute]();
    });
    document.querySelectorAll("nav [data-route]").forEach((link) => link.toggleAttribute("aria-current", link.dataset.route === activeRoute));
    bindInteractions();
    attachTtsPlayer(activeRoute);
    if (focus) document.querySelector(`[data-view="${activeRoute}"] h1`)?.focus({ preventScroll: true });
    if (activeRoute === "simulation") {
      const messages = document.querySelector("[data-messages]");
      if (messages && typeof messages.scrollTo === "function") messages.scrollTo(0, 99999);
    }
    if (activeRoute === "ia") {
      if (aiFocus === "input") document.querySelector("[data-ai-input]")?.focus();
      else if (aiFocus === "error") document.querySelector("[data-ai-error]")?.focus();
      else if (aiFocus === "result") document.querySelector("[data-ai-result-title]")?.focus();
      aiFocus = null;
      const aiMessages = document.querySelector("[data-ai-messages]");
      if (aiMessages && typeof aiMessages.scrollTo === "function") aiMessages.scrollTo(0, 99999);
    }
    if (activeRoute === "lecon") {
      const moduleId = pathState.activeModuleId;
      if (moduleId && pathState.course && !pathState.lessons[moduleId] && !pathState.lessonLoading[moduleId] && !pathState.error) generateLesson(moduleId);
    }
    if ((activeRoute === "simulations" || activeRoute === "ia") && scenarioList === null) loadScenarios();
  }

  function go(route) {
    location.hash = route;
  }

  function bindInteractions() {
    document.querySelectorAll("[data-route]").forEach((element) => element.addEventListener("click", (event) => {
      const route = event.currentTarget.dataset.route;
      if (event.currentTarget.tagName === "BUTTON") go(route);
    }));
    document.querySelectorAll("[data-prep]").forEach((input) => input.addEventListener("change", (event) => {
      const id = event.currentTarget.dataset.prep;
      state.prep = event.currentTarget.checked ? [...new Set([...state.prep, id])] : state.prep.filter((item) => item !== id);
      save(); render("vorbereitung");
    }));
    document.querySelector("[data-go-simulation]")?.addEventListener("click", () => go("simulation"));
    document.querySelectorAll("[data-choice]").forEach((button) => button.addEventListener("click", (event) => {
      const choice = Number(event.currentTarget.dataset.choice);
      const answered = state.dialogueStep;
      state.dialogueAnswers[answered] = choice;
      state.dialogueStep = Math.min(state.dialogueStep + 1, DATA.dialogue.length);
      save(); render("simulation"); focusFeedback(answered);
    }));
    document.querySelectorAll("[data-retry-turn]").forEach((button) => button.addEventListener("click", (event) => {
      const turn = Number(event.currentTarget.dataset.retryTurn);
      state.dialogueAnswers = state.dialogueAnswers.slice(0, turn);
      state.dialogueStep = turn;
      save();
      if (location.hash !== "#simulation") history.replaceState(null, "", "#simulation");
      render("simulation");
      document.querySelector("[data-choice]")?.focus();
    }));
    document.querySelector("[data-reset-dialogue]")?.addEventListener("click", () => {
      state.dialogueStep = 0; state.dialogueAnswers = []; save(); render("simulation"); notify("Simulation réinitialisée.");
    });
    document.querySelectorAll("[data-module]").forEach((button) => button.addEventListener("click", (event) => {
      state.quizAnswers[event.currentTarget.dataset.module] = Number(event.currentTarget.dataset.answer);
      save(); render("abschluss");
    }));
    document.querySelector("[data-reset-all]")?.addEventListener("click", () => {
      state = { ...defaultState, prep: [], dialogueAnswers: [], quizAnswers: {} }; save(); render("lernplan"); notify("Progression locale réinitialisée.");
    });
    document.querySelector("[data-ai-start]")?.addEventListener("click", aiStart);
    document.querySelector("[data-ai-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      aiSend();
    });
    document.querySelector("[data-ai-input]")?.addEventListener("input", (event) => {
      aiState.draft = event.currentTarget.value;
      saveAiState();
    });
    document.querySelector("[data-ai-input]")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        aiSend();
      }
    });
    document.querySelector("[data-ai-retry]")?.addEventListener("click", () => {
      if (aiState.messages.length) {
        aiState.error = null;
        aiState.status = "waiting";
        saveAiState();
        render("ia");
        requestCustomerReply();
      } else {
        aiStart();
      }
    });
    document.querySelector("[data-ai-reset]")?.addEventListener("click", () => {
      aiState = { ...defaultAiState, scenarioId: aiState.scenarioId };
      saveAiState();
      render("ia");
    });
    document.querySelector("[data-ai-analyze]")?.addEventListener("click", aiAnalyze);
    document.querySelector("[data-ai-replay]")?.addEventListener("click", () => {
      if (aiState.evaluation && aiState.evaluation.data) {
        aiState.previousEvaluation = aiState.evaluation.data;
        aiState.practiceTarget = aiState.evaluation.data.priority;
        aiState.messages = [];
        aiState.draft = "";
        aiState.error = null;
        aiState.evaluation = null;
        aiStart();
      }
    });
    document.querySelectorAll("[data-sim-scenario]").forEach((button) => button.addEventListener("click", (event) => {
      aiState = { ...defaultAiState, scenarioId: event.currentTarget.dataset.simScenario };
      saveAiState();
      go("ia");
    }));
    document.querySelector("[data-formations-search]")?.addEventListener("input", (event) => {
      formationsFilter = event.currentTarget.value;
      render("parcours");
      document.querySelector("[data-formations-search]")?.focus();
      const value = document.querySelector("[data-formations-search]").value;
      document.querySelector("[data-formations-search]").setSelectionRange(value.length, value.length);
    });
    document.querySelectorAll("[data-course-structure]").forEach((button) => button.addEventListener("click", (event) => {
      const card = event.currentTarget.closest(".course-card");
      const structure = card ? card.querySelector(".course-structure") : null;
      if (!structure) return;
      const willShow = structure.hidden;
      structure.hidden = !structure.hidden;
      event.currentTarget.innerHTML = willShow ? `${ICON("close")}Masquer le contenu` : `${ICON("layers")}Voir le contenu`;
    }));
    document.querySelector("[data-sim-retry]")?.addEventListener("click", () => {
      scenarioList = null;
      render("simulations");
      loadScenarios();
    });
    document.querySelectorAll("[data-tts]").forEach((button) => button.addEventListener("click", () => handleTtsButton(button)));
    document.querySelector("[data-path-create]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("[data-goal-input]");
      const objective = (input ? input.value : "").trim();
      if (objective.length < 10) {
        pathState.status = "error";
        pathState.error = { code: "objective_too_short", message: "Décrivez votre objectif en quelques mots (au moins 10 caractères)." };
        pathState.objective = objective;
        savePathState();
        render("accueil");
        return;
      }
      createPath(objective);
    });
    document.querySelectorAll("[data-goal-chip]").forEach((chip) => chip.addEventListener("click", (event) => {
      const input = document.querySelector("[data-goal-input]");
      if (input) {
        input.value = event.currentTarget.dataset.goalChip;
        input.focus();
      }
    }));
    document.querySelector("[data-path-retry]")?.addEventListener("click", () => createPath(pathState.objective));
    document.querySelectorAll("[data-path-open-lesson]").forEach((button) => button.addEventListener("click", (event) => {
      pathState.activeModuleId = event.currentTarget.dataset.pathOpenLesson;
      pathState.error = null;
      savePathState();
      if (location.hash === "#lecon") render("lecon");
      else go("lecon");
    }));
    document.querySelectorAll("[data-course-open]").forEach((button) => button.addEventListener("click", (event) => {
      const courseId = event.currentTarget.dataset.courseOpen;
      const list = Array.isArray(coursesData) ? coursesData : [];
      const course = list.find((item) => item.id === courseId);
      if (!course) return;
      applyServerCourse(course);
      pathState.activeModuleId = null;
      pathState.error = null;
      savePathState();
      go("parcours-detail");
    }));
    document.querySelector("[data-local-open]")?.addEventListener("click", () => {
      pathState.activeModuleId = null;
      pathState.error = null;
      savePathState();
      go("parcours-detail");
    });
    document.querySelector("[data-formations-retry]")?.addEventListener("click", () => {
      loadFormations(true);
      render(routeFromHash());
    });
    document.querySelectorAll("[data-catalogue-add]").forEach((button) => button.addEventListener("click", async (event) => {
      const courseId = event.currentTarget.dataset.catalogueAdd;
      const course = (Array.isArray(catalogueData) ? catalogueData : []).find((item) => item.id === courseId);
      if (!course) return;
      event.currentTarget.disabled = true;
      try {
        await apiPost("/api/me/courses", {
          title: course.title,
          objective: course.objective,
          estimatedDuration: course.estimatedDuration,
          modules: course.modules,
        });
        coursesData = null;
        catalogueData = null;
        notify("Cours ajouté à vos parcours.");
        loadFormations(true);
        render("parcours");
      } catch (error) {
        event.currentTarget.disabled = false;
        notify(aiErrorMessage(error.code, "course"));
      }
    }));
    document.querySelector("[data-path-complete]")?.addEventListener("click", () => {
      const moduleId = pathState.activeModuleId;
      if (!moduleId) return;
      pathState.completedLessons[moduleId] = true;
      savePathState();
      if (window.BP_PLATFORM && window.BP_PLATFORM.isAuthenticated()) {
        window.BP_PLATFORM.completeLesson(moduleId);
      }
      notify("Leçon terminée.");
      render("lecon");
    });
    document.querySelector("[data-path-retry-lesson]")?.addEventListener("click", () => {
      if (pathState.activeModuleId) generateLesson(pathState.activeModuleId);
    });
    document.querySelectorAll("[data-path-answer]").forEach((button) => button.addEventListener("click", (event) => {
      const moduleId = pathState.activeModuleId;
      const lesson = pathState.lessons[moduleId];
      const section = lesson ? lesson.sections.find((item) => item.type === "question") : null;
      if (!section || !Array.isArray(section.options)) return;
      const answer = section.options[Number(event.currentTarget.dataset.pathAnswer)];
      if (answer) submitExercise(moduleId, section, answer);
    }));
    document.querySelector("[data-path-answer-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const moduleId = pathState.activeModuleId;
      const lesson = pathState.lessons[moduleId];
      const section = lesson ? lesson.sections.find((item) => item.type === "question") : null;
      const input = document.querySelector("[data-path-answer-input]");
      if (!section || !input || !input.value.trim()) return;
      submitExercise(moduleId, section, input.value.trim());
    });
    document.querySelector("[data-tutor-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = document.querySelector("[data-tutor-input]");
      const moduleId = pathState.activeModuleId;
      if (!input || !moduleId) return;
      sendTutorMessage(moduleId, input.value);
    });
    document.querySelector("[data-coach-toggle]")?.addEventListener("click", () => {
      coachCollapsed = true;
      render("lecon");
    });
    document.querySelector("[data-coach-open]")?.addEventListener("click", () => {
      coachCollapsed = false;
      render("lecon");
    });
    document.querySelectorAll("[data-coach-prompt]").forEach((button) => button.addEventListener("click", () => {
      const moduleId = pathState.activeModuleId;
      if (!moduleId || pathState.tutorBusy) return;
      sendTutorMessage(moduleId, button.dataset.coachPrompt);
    }));
    document.querySelector("[data-exercise-retry]")?.addEventListener("click", () => {
      const moduleId = pathState.activeModuleId;
      if (!moduleId) return;
      delete pathState.quizResults[moduleId];
      pathState.error = null;
      savePathState();
      render("lecon");
      notify("Vous pouvez répondre à nouveau. Le nouveau résultat remplacera le précédent.");
    });
    document.querySelector("[data-tutor-retry]")?.addEventListener("click", () => {
      const moduleId = pathState.activeModuleId;
      const messages = pathState.tutor[moduleId] || [];
      if (!moduleId || !messages.length || pathState.tutorBusy) return;
      pathState.tutorBusy = true;
      pathState.tutorError = null;
      savePathState();
      render("lecon");
      tutorRequest(moduleId, messages);
    });
    document.querySelectorAll("[data-path-recommend]").forEach((button) => button.addEventListener("click", (event) => {
      const moduleId = event.currentTarget.dataset.pathRecommend;
      const evaluation = aiState.evaluation && aiState.evaluation.data ? aiState.evaluation.data : null;
      pathState.recommendation = { moduleId, reason: evaluation ? evaluation.next_practice : "" };
      pathState.activeModuleId = moduleId;
      pathState.error = null;
      savePathState();
      go("lecon");
    }));
  }

  window.addEventListener("hashchange", () => render(routeFromHash(), true));
  render();
})();
