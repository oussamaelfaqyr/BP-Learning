(() => {
  "use strict";

  const PATH_STORE_KEY = "bp-learning-path-v1";
  const AI_STORE_KEY = "bp-ai-simulation-v1";

  const platform = {
    booted: false,
    mode: "loading", // loading | guest | authed | legacy
    user: null,
    authConfig: { allowPublicRegistration: true, minimumPasswordLength: 10 },
    courseId: null,
  };

  const platformSection = document.querySelector('[data-view="platform"]');
  const navEl = document.querySelector("[data-nav]");
  const authAreaEl = document.querySelector("[data-auth-area]");
  const mobileNavEl = document.querySelector("[data-mobile-nav]");
  const mobileNavLinksEl = document.querySelector("[data-mobile-nav-links]");
  const mobileAuthEl = document.querySelector("[data-mobile-auth]");
  const navToggleEl = document.querySelector("[data-nav-toggle]");
  const navBackdropEl = document.querySelector("[data-nav-backdrop]");
  const toast = document.querySelector(".toast");

  const ICON = (name, className = "icon") => (window.BP_ICONS ? window.BP_ICONS.icon(name, className) : "");

  const APP_ROUTES = new Set([
    "start", "vorbereitung", "simulation", "ia", "abschluss", "lernplan",
    "accueil", "parcours", "parcours-detail", "formations", "simulations", "progression", "lecon",
  ]);
  const PLATFORM_ROUTES = new Set([
    "/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email",
    "/app", "/profile", "/forbidden",
    "/admin", "/admin/users", "/admin/courses", "/admin/assignments", "/admin/performance", "/admin/messages", "/admin/settings",
  ]);
  const ADMIN_ROUTES = new Set([
    "/admin", "/admin/users", "/admin/courses", "/admin/assignments", "/admin/performance", "/admin/messages", "/admin/settings",
  ]);
  const AUTH_ROUTES = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"]);

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function initials(user) {
    if (!user) return "?";
    const first = (user.firstName || "").charAt(0);
    const last = (user.lastName || "").charAt(0);
    return (first + last).toUpperCase() || "?";
  }

  function notify(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => { toast.hidden = true; }, 3000);
  }

  async function api(path, options = {}) {
    const opts = { headers: {}, credentials: "same-origin", ...options };
    if (opts.body !== undefined && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
      opts.headers["Content-Type"] = "application/json";
    }
    let response;
    try {
      response = await fetch(path, opts);
    } catch {
      throw { code: "network_error", message: "Impossible de joindre le serveur.", status: 0 };
    }
    let data = null;
    try { data = await response.json(); } catch { /* empty */ }
    if (!response.ok) {
      const raw = data && data.error;
      const code =
        typeof raw === "string"
          ? raw
          : raw && typeof raw.code === "string"
            ? raw.code.toLowerCase()
            : "internal_error";
      const message = raw && typeof raw === "object" && raw.message ? raw.message : null;
      if (response.status === 401 && platform.mode === "authed" && !String(path).includes("/api/auth/")) {
        platform.mode = "guest";
        platform.user = null;
        renderNav();
        openMobileNav(false);
        go("/login");
      }
      throw { code, message, status: response.status };
    }
    return data;
  }

  function currentRoute() {
    const raw = location.hash.replace(/^#/, "");
    const value = raw.split("?")[0];
    if (!value) return "/";
    if (PLATFORM_ROUTES.has(value)) return value;
    return value;
  }

  function go(route) {
    if (location.hash === `#${route}` || (route === "/" && !location.hash)) {
      handleRoute();
      return;
    }
    location.hash = route;
  }

  function redirectToLogin() {
    const route = currentRoute();
    if (!AUTH_ROUTES.has(route) && !PLATFORM_ROUTES.has(route)) {
      sessionStorage.setItem("bp-next-route", route);
    }
    go("/login");
  }

  function canAccessApp() {
    if (platform.mode === "legacy" || platform.mode === "loading") return true;
    if (platform.mode === "authed") {
      return Boolean(platform.user && platform.user.emailVerified);
    }
    return false;
  }

  function isAdminUser() {
    return platform.mode === "authed" && platform.user != null && platform.user.role === "admin";
  }

  function canAccessAdmin() {
    return isAdminUser();
  }

  /* ------------------------------ boot ------------------------------ */

  async function boot() {
    let meData = null;
    try {
      meData = await api("/api/me");
    } catch (error) {
      if (error.status === 401) {
        platform.mode = "guest";
      } else if (error.code === "db_unavailable") {
        platform.mode = "legacy";
      } else {
        platform.mode = "guest";
      }
      platform.booted = true;
      renderNav();
      handleRoute();
      return;
    }
    try {
      const configData = await api("/api/auth/config");
      platform.authConfig = {
        allowPublicRegistration: Boolean(configData.allowPublicRegistration),
        minimumPasswordLength: configData.minimumPasswordLength || 10,
      };
    } catch { /* keep defaults */ }
    platform.user = meData.user;
    platform.mode = platform.user ? "authed" : "guest";
    platform.booted = true;
    renderNav();
    handleRoute();
    migrateLocalStateIfNeeded();
  }

  function migrateLocalStateIfNeeded() {
    if (platform.mode !== "authed" || !platform.user) return;
    const markerKey = `bp-migrated-${platform.user.id}`;
    if (localStorage.getItem(markerKey)) return;
    const payload = { course: null, completedModules: [], quizResults: {}, simulations: [] };
    try {
      const pathRaw = JSON.parse(localStorage.getItem(PATH_STORE_KEY) || "null");
      if (pathRaw && typeof pathRaw === "object") {
        if (pathRaw.course && typeof pathRaw.course === "object") payload.course = pathRaw.course;
        if (pathRaw.completedLessons && typeof pathRaw.completedLessons === "object") {
          payload.completedModules = Object.keys(pathRaw.completedLessons).filter((id) => pathRaw.completedLessons[id] === true);
        }
        if (pathRaw.quizResults && typeof pathRaw.quizResults === "object") payload.quizResults = pathRaw.quizResults;
      }
      const aiRaw = JSON.parse(localStorage.getItem(AI_STORE_KEY) || "null");
      if (aiRaw && typeof aiRaw === "object" && Array.isArray(aiRaw.messages) && aiRaw.messages.length) {
        payload.simulations.push({
          scenarioId: typeof aiRaw.scenarioId === "string" ? aiRaw.scenarioId : "communication",
          messages: aiRaw.messages,
        });
      }
    } catch { /* corrupted local state: skip migration */ }
    const hasData = payload.course || payload.completedModules.length || payload.quizResults && Object.keys(payload.quizResults).length || payload.simulations.length;
    if (!hasData) {
      localStorage.setItem(markerKey, "1");
      return;
    }
    api("/api/me/migrate", { method: "POST", body: payload })
      .then((result) => {
        if (result && result.migrated && result.migrated.courseId) platform.courseId = result.migrated.courseId;
        localStorage.setItem(markerKey, "1");
        notify("Vos données locales ont été migrées vers votre compte.");
        if (currentRoute() === "/app") handleRoute();
      })
      .catch(() => { /* migration is best-effort: will retry on next login */ });
  }

  /* ------------------------------ nav ------------------------------ */

  const NAV_ICONS = {
    "/app": "home",
    parcours: "path",
    formations: "book",
    simulations: "chat",
    progression: "chart",
    "/admin": "shield",
  };

  function navLink(route, label, iconName) {
    const isActive = route === "/" ? (!location.hash || location.hash === "#/") : location.hash === `#${route}`;
    return `<a class="nav-link" href="#${route}" ${isActive ? 'aria-current="page"' : ""}>${ICON(iconName)}<span>${escapeHTML(label)}</span></a>`;
  }

   function navLinks() {
     if (platform.user && !platform.user.emailVerified) return [];
     const isAdmin = isAdminUser();
     return [
       { route: "/app", label: "Tableau de bord" },
       { route: "parcours", label: "Mon parcours" },
       { route: "simulations", label: "Simulations" },
       { route: "progression", label: "Progression" },
       ...(isAdmin ? [{ route: "/admin", label: "Administration" }] : []),
     ];
   }

  function renderNav() {
    if (platform.mode === "loading") {
      navEl.innerHTML = "";
      authAreaEl.innerHTML = '<span class="loading-inline"><span class="spinner" aria-hidden="true"></span>Chargement…</span>';
      return;
    }
    if (platform.mode === "guest" || platform.mode === "legacy") {
      if (currentRoute() === "/") {
        navEl.innerHTML = `
          <a class="nav-link" href="#" data-scroll="formations">Formations</a>
          <a class="nav-link" href="#" data-scroll="simulations">Simulations</a>
          <a class="nav-link" href="#" data-scroll="progression">Progression</a>
          <a class="nav-link" href="#" data-scroll="showcase">Aperçu interactif</a>`;
      } else {
        navEl.innerHTML = "";
      }
      authAreaEl.innerHTML = `<a class="button button-quiet" href="#/login">Se connecter</a><a class="button button-primary" href="#/register">Créer un compte</a>`;
      syncMobileNav();
      return;
    }
     const isAdmin = isAdminUser();
     const unverified = platform.user && !platform.user.emailVerified;
     navEl.innerHTML = navLinks().map((link) => navLink(link.route, link.label, NAV_ICONS[link.route])).join("");
     authAreaEl.innerHTML = `
       <div class="user-menu">
         <button class="user-menu-trigger" type="button" data-user-menu-trigger aria-expanded="false" aria-haspopup="true">
           <span class="avatar" aria-hidden="true">${escapeHTML(initials(platform.user))}</span>
           <span>${escapeHTML(platform.user.firstName)}</span>
           ${ICON("chevronDown", "icon chevron")}
         </button>
         <div class="user-menu-panel" data-user-menu-panel hidden>
           <div class="user-menu-header">
             <strong>${escapeHTML(platform.user.firstName)} ${escapeHTML(platform.user.lastName)}</strong>
             <span>${escapeHTML(platform.user.email)}</span>
           </div>
           ${unverified ? "" : `<a class="user-menu-item" href="#/profile">${ICON("user")}Mon profil</a>`}
           ${unverified ? "" : (isAdmin ? `<a class="user-menu-item" href="#/admin">${ICON("shield")}Administration</a>` : "")}
           <button class="user-menu-item danger" type="button" data-logout>${ICON("logout")}Se déconnecter</button>
         </div>
       </div>`;
     syncMobileNav();
  }

  function syncMobileNav() {
    if (!mobileNavLinksEl || !mobileAuthEl) return;
    if (platform.mode === "authed") {
      const unverified = platform.user && !platform.user.emailVerified;
      mobileNavLinksEl.innerHTML = navLinks().map((link) => navLink(link.route, link.label, NAV_ICONS[link.route])).join("");
      mobileAuthEl.innerHTML = unverified
        ? `<button class="button button-quiet" type="button" data-logout>${ICON("logout")}Se déconnecter</button>`
        : `<a class="button button-secondary" href="#/profile">${ICON("user")}Mon profil</a>
        <button class="button button-quiet" type="button" data-logout>${ICON("logout")}Se déconnecter</button>`;
    } else {
      if (currentRoute() === "/") {
        mobileNavLinksEl.innerHTML = `
          <a class="nav-link" href="#" data-scroll="formations">Formations</a>
          <a class="nav-link" href="#" data-scroll="simulations">Simulations</a>
          <a class="nav-link" href="#" data-scroll="progression">Progression</a>
          <a class="nav-link" href="#" data-scroll="showcase">Aperçu interactif</a>`;
      } else {
        mobileNavLinksEl.innerHTML = "";
      }
      mobileAuthEl.innerHTML = `<a class="button button-primary" href="#/register">Créer un compte</a><a class="button button-secondary" href="#/login">Se connecter</a>`;
    }
  }

  function openMobileNav(open) {
    if (!navToggleEl || !mobileNavEl) return;
    navToggleEl.setAttribute("aria-expanded", String(open));
    mobileNavEl.hidden = !open;
    if (navBackdropEl) navBackdropEl.hidden = !open;
    document.body.classList.toggle("nav-open", open);
    if (open) {
      const first = mobileNavEl.querySelector("a");
      first?.focus();
    }
  }

  function closeUserMenu() {
    const trigger = authAreaEl.querySelector("[data-user-menu-trigger]");
    const panel = authAreaEl.querySelector("[data-user-menu-panel]");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (panel) panel.hidden = true;
  }

  document.addEventListener("click", (event) => {
    const scrollLink = event.target.closest("[data-scroll]");
    if (scrollLink) {
      event.preventDefault();
      const sectionId = scrollLink.dataset.scroll;
      const scrollToSection = () => {
        const target = document.getElementById(sectionId);
        if (!target) return;
        const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        } else if (typeof window.scrollTo === "function") {
          window.scrollTo(0, target.offsetTop || 0);
        }
      };
      if (document.getElementById(sectionId)) {
        scrollToSection();
      } else if (currentRoute() !== "/") {
        go("/");
        window.setTimeout(scrollToSection, 80);
      }
      openMobileNav(false);
      return;
    }
    const logoutButton = event.target.closest("[data-logout]");
    if (logoutButton) {
      event.preventDefault();
      closeUserMenu();
      openMobileNav(false);
      logout();
      return;
    }
    const trigger = event.target.closest("[data-user-menu-trigger]");
    if (trigger) {
      const panel = authAreaEl.querySelector("[data-user-menu-panel]");
      const willOpen = panel && panel.hidden;
      closeUserMenu();
      if (panel && willOpen) {
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        panel.querySelector("a, button")?.focus();
      }
      return;
    }
    if (!event.target.closest(".user-menu")) closeUserMenu();
    const navLinkEl = event.target.closest(".mobile-nav a, .main-nav a");
    if (navLinkEl) openMobileNav(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeUserMenu();
      openMobileNav(false);
    }
  });

  navToggleEl?.addEventListener("click", () => {
    openMobileNav(navToggleEl.getAttribute("aria-expanded") !== "true");
  });
  navBackdropEl?.addEventListener("click", () => openMobileNav(false));

  /* --------------------------- route guard --------------------------- */

  function handleRoute() {
    if (!platform.booted) {
      platformSection.hidden = false;
      platformSection.innerHTML = '<div class="page-shell boot-screen" role="status"><p class="small subtle">Chargement de la plateforme…</p></div>';
      return;
    }
    const route = currentRoute();
    const isPlatformRoute = PLATFORM_ROUTES.has(route);

    if (platform.mode === "guest" || platform.mode === "legacy") {
      if (AUTH_ROUTES.has(route) || route === "/" || route === "/forbidden") {
        renderPlatform(route);
        return;
      }
      if (isPlatformRoute) {
        go("/login");
        return;
      }
      if (APP_ROUTES.has(route)) {
        if (platform.mode === "legacy") {
          hidePlatform();
          return;
        }
        redirectToLogin();
        return;
      }
      go("/");
      return;
    }

    if (platform.mode === "authed") {
      if (platform.user && !platform.user.emailVerified) {
        if (AUTH_ROUTES.has(route) || route === "/") {
          renderPlatform(route);
          return;
        }
        platformSection.hidden = false;
        renderNav();
        platformSection.innerHTML = renderVerifyRequired();
        bindPlatformInteractions(route);
        return;
      }
      const isAdminRoute = ADMIN_ROUTES.has(route);
       if (isAdminRoute && !isAdminUser()) {
         renderPlatform("/forbidden");
         return;
       }
      if (route === "/" ) {
        go("/app");
        return;
      }
      if (route === "/login" || route === "/register") {
        go("/app");
        return;
      }
      if (isPlatformRoute) {
        renderPlatform(route);
        return;
      }
      if (APP_ROUTES.has(route)) {
        hidePlatform();
        return;
      }
      go("/app");
      return;
    }
  }

  function hidePlatform() {
    platformSection.hidden = true;
  }

  /* --------------------------- platform views --------------------------- */

  function renderPlatform(route) {
    platformSection.hidden = false;
    renderNav();
    const renderers = {
      "/": renderLanding,
      "/login": renderLogin,
      "/register": renderRegister,
      "/forgot-password": renderForgot,
      "/reset-password": renderReset,
      "/verify-email": renderVerifyEmail,
      "/app": renderDashboard,
      "/profile": renderProfile,
      "/forbidden": renderForbidden,
      "/admin": renderAdminDashboard,
      "/admin/users": renderAdminUsers,
      "/admin/courses": renderAdminCourses,
      "/admin/assignments": renderAdminAssignments,
      "/admin/performance": renderAdminPerformance,
      "/admin/messages": renderAdminMessages,
      "/admin/settings": renderAdminSettings,
    };
    const renderer = renderers[route] || renderForbidden;
    document.body.classList.toggle("auth-page", AUTH_ROUTES.has(route));
    document.body.classList.toggle("landing-page", route === "/");
    const result = renderer();
    if (result && typeof result.then === "function") {
      result
        .then(() => bindPlatformInteractions(route))
        .catch((error) => {
          console.error(`[platform] render failed for ${route}: ${error && error.message}`);
        });
      return;
    }
    if (typeof result === "string") {
      platformSection.innerHTML = result;
    }
    bindPlatformInteractions(route);
  }

  /* ------------------------------ landing ------------------------------ */

  function renderLandingLegacy() {
    const legacyNotice = platform.mode === "legacy"
      ? `<div class="banner warning-banner">${ICON("alert")}<p>Mode démonstration sans compte : la base de données n’est pas configurée (MONGODB_URI). Les comptes et la progression partagée seront disponibles une fois la connexion établie.</p></div>`
      : "";
    const features = [
      ["chat", "Communication", "Demander la préférence de langue, expliquer une étape à la fois et vérifier la compréhension, sans jargon."],
      ["compass", "Conseil client", "Identifier le besoin réel avant de recommander, dans les limites du rôle officinal."],
      ["flask", "Connaissance produit", "Répondre avec précision et honnêteté — et savoir dire « je vérifie » plutôt que d’inventer."],
      ["scale", "Vente éthique", "Traiter les objections, valoriser sans forcer, proposer des compléments réellement utiles."],
      ["shield", "Situations difficiles", "Garder son calme, montrer de l’empathie et orienter vers une solution concrète."],
      ["eye", "Actualisation", "Distinguer information vérifiée et rumeur, orienter vers des sources fiables."],
      ["cap", "Parcours sur mesure", "Un parcours généré par IA à partir de votre objectif, révisé et adapté en continu."],
      ["chart", "Progression visible", "Leçons terminées, compétences, points à renforcer : votre progression, à jour."],
    ];
    return `<div class="page-shell landing">
      ${legacyNotice}

      <section class="landing-hero">
        <div>
          <p class="eyebrow">Formation par IA pour les équipes officinales</p>
          <h1 id="platform-title" tabindex="-1">Le comptoir est un métier. Entraînez-vous avant le client réel.</h1>
          <p class="lede">BP Learning forme vos équipes à la relation client en officine : leçons courtes, simulations avec un client virtuel et retour personnalisé de l’IA sur chaque échange — en français, dans un contexte marocain fictif.</p>
          <div class="landing-cta">
            <a class="button button-primary button-lg" href="#/register">Commencer mon parcours ${ICON("arrowRight")}</a>
            <a class="button button-secondary button-lg" href="#/login">Se connecter</a>
          </div>
          <div class="landing-proof">
            <div><strong>4 min</strong> pour débuter</div>
            <div><strong>8</strong> situations client simulées</div>
            <div><strong>100 %</strong> des retours personnalisés</div>
          </div>
        </div>
        <div class="product-preview" aria-hidden="true">
          <div class="preview-float">${ICON("checkCircle")}Retour du coach</div>
          <div class="preview-window">
            <div class="preview-window-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="title">Simulation · Conseil produit</span></div>
            <div class="preview-body">
              <div class="preview-chat">
                <div class="preview-bubble">Bonjour, je ne sais pas trop lequel de ces soins choisir pour ma peau…</div>
                <div class="preview-bubble me">Puis-je vous demander ce que vous recherchez exactement ?</div>
                <div class="preview-bubble">Ma peau tiraille après la douche, surtout en hiver.</div>
              </div>
              <div class="preview-score">
                <span class="chip">Acquis</span>
                <div class="bar"><span></span></div>
                <span>74 %</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-section">
        <div class="section-heading"><div><p class="eyebrow">La boucle d’apprentissage</p><h2>Apprendre, pratiquer, progresser</h2></div></div>
        <div class="learning-loop">
          <span class="loop-step">${ICON("bookOpen")}Apprendre</span>
          <span class="loop-arrow">${ICON("arrowRight")}</span>
          <span class="loop-step">${ICON("chat")}Pratiquer</span>
          <span class="loop-arrow">${ICON("arrowRight")}</span>
          <span class="loop-step">${ICON("sparkles")}Recevoir le retour de l’IA</span>
          <span class="loop-arrow">${ICON("arrowRight")}</span>
          <span class="loop-step">${ICON("target")}Cibler ses points faibles</span>
          <span class="loop-arrow">${ICON("arrowRight")}</span>
          <span class="loop-step">${ICON("chart")}Progresser</span>
        </div>
        <div class="section-heading" style="margin-top:3rem"><div><p class="eyebrow">Méthode</p><h2>Comment ça marche</h2></div></div>
        <div class="how-it-works">
          <div class="how-step"><h3>Décrivez votre objectif</h3><p class="subtle small">Le coach IA construit un parcours de formation adapté à votre métier et à vos besoins.</p></div>
          <div class="how-step"><h3>Suivez des leçons courtes</h3><p class="subtle small">Concepts, exemples de dialogue et exercices, avec le coach IA à côté pour répondre à vos questions.</p></div>
          <div class="how-step"><h3>Pratiquez en simulation</h3><p class="subtle small">Dialoguez avec un client simulé qui réagit comme une vraie personne, sans risque pour vos vrais clients.</p></div>
          <div class="how-step"><h3>Recevez votre analyse</h3><p class="subtle small">L’IA évalue vos réflexes, identifie votre priorité et vous propose l’entraînement suivant.</p></div>
        </div>
      </section>

      <section class="landing-section-alt">
        <div class="page-shell">
          <div class="section-heading"><div><p class="eyebrow">Compétences</p><h2>Ce que vos équipes apprennent</h2></div><span class="section-note">Contenus de formation — jamais de conseil médical</span></div>
          <div class="card-grid feature-grid">
            ${features.map(([iconName, title, body]) => `<article class="card">${ICON(iconName, "icon icon-lg")}<h3>${escapeHTML(title)}</h3><p>${escapeHTML(body)}</p></article>`).join("")}
          </div>
        </div>
      </section>

      <section class="landing-section">
        <div class="sample-feedback">
          <div>
            <p class="eyebrow">Un retour, pas une note</p>
            <h2>L’IA vous dit ce qui a fonctionné, et quoi travailler ensuite</h2>
            <p class="lede">Après chaque simulation, vous recevez une analyse par critère : ce que vous avez réellement dit, pourquoi c’était adapté, et un exercice ciblé pour progresser. La priorité suivante devient votre prochain entraînement.</p>
            <div class="button-row"><a class="button button-primary" href="#/register">Essayer une simulation ${ICON("arrowRight")}</a></div>
          </div>
          <div class="card">
            <div class="card-top"><h3>Votre analyse</h3><span class="tag success">${ICON("check")}2 acquis</span></div>
            <div class="feedback-line"><span class="tag success">Acquis</span><div class="bar"><span class="good" style="width:86%"></span></div><strong>86</strong></div>
            <div class="feedback-line"><span class="tag warning">À renforcer</span><div class="bar"><span class="weak" style="width:58%"></span></div><strong>58</strong></div>
            <div class="feedback-line"><span class="tag warning">À renforcer</span><div class="bar"><span class="weak" style="width:44%"></span></div><strong>44</strong></div>
            <div class="feedback-line"><span class="tag success">Acquis</span><div class="bar"><span class="good" style="width:91%"></span></div><strong>91</strong></div>
            <p class="small subtle" style="margin-top:0.9rem"><strong>Votre priorité :</strong> expliquer la valeur du produit. Exercice ciblé recommandé : « Relier les bénéfices à la situation du client ».</p>
            <div class="button-row tight"><span class="button button-primary button-sm">${ICON("target")}Travailler ce point</span></div>
          </div>
        </div>
      </section>

      <section class="landing-section">
        <div class="card card-teal" style="display:flex;gap:1.4rem;align-items:center;flex-wrap:wrap;justify-content:space-between">
          <div>
            <h2 style="margin-bottom:0.3rem">Prêt à vous entraîner ?</h2>
            <p class="subtle" style="margin:0">Créez votre compte et démarrez votre premier parcours en quelques minutes.</p>
          </div>
          <div class="button-row" style="margin:0">
            <a class="button button-primary button-lg" href="#/register">Créer un compte</a>
            <a class="button button-secondary button-lg" href="#/login">Se connecter</a>
          </div>
        </div>
        <div class="section-heading"><div><p class="eyebrow">Responsabilité</p><h2>Un entraînement, pas un avis médical</h2></div></div>
        <div class="card"><p class="subtle small">Toutes les personnes, situations et données sont fictives. La plateforme forme aux réflexes de communication et de vente ; elle ne donne ni diagnostic ni conseil de santé. Le contenu généré par IA est un support de formation, pas une information médicale autorisée.</p></div>
      </section>

      <footer class="site-footer"><p>BP Learning · Entraînement par IA pour les équipes officinales · Contenu fictif à but de formation</p></footer>
    </div>`;
  }

  /* -------------------- landing: living product experience -------------------- */

  function renderLanding() {
    const legacyNotice = platform.mode === "legacy"
      ? `<div class="banner warning-banner">${ICON("alert")}<p>Mode démonstration sans compte : la base de données n’est pas configurée (MONGODB_URI). Les comptes et la progression partagée seront disponibles une fois la connexion établie.</p></div>`
      : "";

    return `<div class="landing">
      ${legacyNotice}

      <section class="landing-hero">
        <div class="reveal">
          <div class="hero-eyebrow-row">
            <span class="badge-morocco"><span class="badge-dot"></span> Officines Casablanca & Maroc</span>
            <span class="hero-eyebrow">Formation par IA pour l’officine</span>
          </div>
          <h1 id="platform-title" tabindex="-1">Apprenez.<br /><span class="gradient-text">Pratiquez.</span><br />Progressez au comptoir.</h1>
          <p class="lede">BP Learning transforme chaque situation officinale en entraînement concret : leçons ciblées, dialogues avec des patients simulés et retours instantanés de l’IA — pour exceller au comptoir avant le patient réel.</p>
          <div class="landing-cta">
            <a class="button button-primary button-lg button-glow" href="#/register">Créer un compte & débuter ${ICON("arrowRight")}</a>
            <a class="button button-secondary button-lg" href="#" data-scroll="showcase">Découvrir les formations</a>
          </div>
          <div class="landing-facts">
            <div><strong>8 situations officinales simulées</strong>conseil dermo, objection prix, pédiatrie…</div>
            <div><strong>Un parcours construit pour vous</strong>généré sur mesure selon votre objectif</div>
            <div><strong>Un retour par critère</strong>analyse détaillée de chaque échange</div>
          </div>
        </div>

        <div class="hero-visual-card reveal" aria-label="Aperçu d’entraînement en officine à Casablanca">
          <div class="hero-photo-wrap">
            <img class="hero-photo" src="assets/moroccan_pharmacy_hero.jpg" alt="Officine marocaine à Casablanca — conseil et écoute au comptoir" width="800" height="600" />
            <div class="hero-photo-gradient"></div>
          </div>
          <div class="floating-telemetry top-telemetry">
            <span class="telemetry-pulse"></span>
            <div class="telemetry-text">
              <strong>Simulation active</strong>
              <span>Pharmacie Al Amal · Casablanca</span>
            </div>
          </div>
          <div class="floating-chat-snippet">
            <div class="chat-turn patient">
              <span class="speaker-tag">Patiente</span>
              <p>« Bonjour docteur, ma peau tiraille énormément avec ce vent d’hiver… Je ne sais pas quoi choisir. »</p>
            </div>
            <div class="chat-turn pharmacist">
              <span class="speaker-tag">Vous (Comptoir)</span>
              <p>« Je comprends tout à fait. Est-ce que cette sensation s’accompagne de rougeurs ou de démangeaisons ? »</p>
            </div>
            <div class="chat-feedback-pill">
              ${ICON("sparkles")}
              <span><strong>Coach IA :</strong> Écoute empathique validée (+92%). Question ouverte ciblée avant recommandation.</span>
            </div>
          </div>
          <div class="floating-telemetry bottom-telemetry">
            <div class="telemetry-gauge"><strong>92%</strong></div>
            <div class="telemetry-text">
              <strong>Écoute active validée</strong>
              <span>Priorité : valoriser le bénéfice d’usage</span>
            </div>
          </div>
        </div>
      </section>

      <section class="morocco-context-banner reveal">
        <div class="context-grid">
          <div class="context-item">
            <div class="context-icon">${ICON("compass")}</div>
            <div>
              <strong>Réalité officinale marocaine</strong>
              <p>Casablanca, Rabat, Fès, Tanger : situations inspirées du quotidien de nos comptoirs.</p>
            </div>
          </div>
          <div class="context-item">
            <div class="context-icon">${ICON("chat")}</div>
            <div>
              <strong>Sensibilité bilingue & écoute</strong>
              <p>Comprendre les nuances d'expression du patient, en français fluide avec empathie culturelle.</p>
            </div>
          </div>
          <div class="context-item">
            <div class="context-icon">${ICON("scale")}</div>
            <div>
              <strong>Éthique & Rôle officinal</strong>
              <p>Recommander avec rigueur déontologique, sans survente, en orientant vers le médecin si nécessaire.</p>
            </div>
          </div>
          <div class="context-item">
            <div class="context-icon">${ICON("shield")}</div>
            <div>
              <strong>Zéro risque pour vos patients</strong>
              <p>Entraînez vos équipes, testez vos réflexes et gagnez en assurance avant le prochain patient.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-scenarios-section reveal">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Scénarios pratiques</p>
            <h2>Les situations que votre équipe rencontre chaque jour</h2>
          </div>
          <span class="section-note">Mises en situation réalistes</span>
        </div>
        <div class="scenarios-grid">
          <article class="scenario-card">
            <div class="scenario-badge dermo">Dermocosmétique</div>
            <h3>Peaux agressées & tiraillements</h3>
            <p>Identifier le profil cutané par un questionnement ciblé sans présumer du besoin du patient.</p>
            <div class="scenario-footer">
              <span>${ICON("check")} Écoute active</span>
              <span>${ICON("arrowRight")}</span>
            </div>
          </article>
          <article class="scenario-card">
            <div class="scenario-badge price">Objection prix</div>
            <h3>« C’est trop cher pour moi »</h3>
            <p>Déconstruire le coût à l’usage en dirhams plutôt que de baisser les bras ou forcer la vente.</p>
            <div class="scenario-footer">
              <span>${ICON("check")} Argumentation d’usage</span>
              <span>${ICON("arrowRight")}</span>
            </div>
          </article>
          <article class="scenario-card">
            <div class="scenario-badge pediatrics">Pédiatrie & Maman</div>
            <h3>Conseil pour nourrisson</h3>
            <p>Rassurer la maman, sécuriser la posologie exacte et vérifier les contre-indications d’âge.</p>
            <div class="scenario-footer">
              <span>${ICON("check")} Vigilance & Empathie</span>
              <span>${ICON("arrowRight")}</span>
            </div>
          </article>
          <article class="scenario-card">
            <div class="scenario-badge allergy">Saisonnier</div>
            <h3>Allergie ou rhume d’hiver</h3>
            <p>Distinguer les affections bénignes et détecter les signaux d’alerte nécessitant un avis médical.</p>
            <div class="scenario-footer">
              <span>${ICON("check")} Triage officinal</span>
              <span>${ICON("arrowRight")}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="story" id="formations">
        <div class="story-grid">
          <div class="story-copy reveal">
            <p class="eyebrow">Apprendre</p>
            <h2>Apprendre ne devrait pas être passif.</h2>
            <p class="lede">Chaque leçon est courte, visuelle et immédiatement exploitable au comptoir : un concept clé, un exemple de dialogue concret, un schéma décisionnel et les erreurs fréquentes à éviter.</p>
            <div class="feature-bullets">
              <div class="bullet-item">${ICON("check")} <strong>Format 4 minutes</strong> entre deux délivrances</div>
              <div class="bullet-item">${ICON("check")} <strong>Fiches réflexes</strong> conçues pour le quotidien officinal</div>
              <div class="bullet-item">${ICON("check")} <strong>Aucun jargon abstrait</strong> : de la pratique pure</div>
            </div>
          </div>
          <div class="story-visual-rich reveal">
            <div class="visual-photo-wrap">
              <img src="assets/pharmacy_consultation_dialogue.jpg" alt="Pharmacien marocain en plein conseil au comptoir" width="600" height="450" />
            </div>
            <div class="visual-card-floating">
              <div class="hero-course-line"><strong>Leçon — Répondre à une objection prix</strong><span>4 étapes</span></div>
              <div class="hero-lesson-card">
                <span class="concept"><strong>Pourquoi l’objection arrive :</strong> le client compare, ou n’a pas encore perçu la valeur réelle.</span>
                <div class="hero-step-flow"><span>1 · Écouter</span><span>2 · Reformuler</span><span>3 · Valoriser</span><span>4 · Laisser le choix</span></div>
                <div class="hero-feedback">Exemple : « Ce soin dure deux mois — cela revient à moins de 8 dirhams par semaine pour soulager votre peau. »</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="story">
        <div class="story-grid flip">
          <div class="story-copy reveal">
            <p class="eyebrow">Le coach IA</p>
            <h2>Un tuteur qui vous guide pendant chaque leçon.</h2>
            <p class="lede">À côté de chaque notion, un coach virtuel répond instantanément à vos interrogations. Vous souhaitez une alternative de formulation ? Un exemple en contexte marocain ? Il s’adapte à votre rythme sans jamais vous juger.</p>
          </div>
          <div class="story-visual reveal">
            <div class="story-tutor">
              <div class="bubble me"><small>Vous</small>Comment expliquer ce prix sans paraître insistant ?</div>
              <div class="bubble coach"><small>Coach IA</small>Raisonnez en coût par semaine : combien coûte le produit rapporté à sa durée réelle de traitement ?</div>
              <div class="bubble me"><small>Vous</small>Donne-moi une formulation naturelle pour le comptoir.</div>
              <div class="bubble coach"><small>Coach IA</small>« Je comprends votre hésitation. Ce flacon est concentré et dure 8 semaines : cela revient à environ 1 dirham par jour pour un apaisement durable. »</div>
              <div class="bubble me"><small>Vous</small>Parfait, je retiens cette approche !</div>
            </div>
          </div>
        </div>
      </section>

      <section class="story">
        <div class="story-grid">
          <div class="story-copy reveal">
            <p class="eyebrow">Pratiquer</p>
            <h2>Un exercice après chaque leçon.</h2>
            <p class="lede">Vous répondez à une situation réelle, et le coach vous dit ce qui était adapté, ce qui peut être amélioré, et le point clé à retenir.</p>
          </div>
          <div class="story-visual reveal">
            <div class="hero-course-line"><strong>Exercice</strong><span>Vente éthique & complémentaire</span></div>
            <div class="hero-lesson-card">
              <span class="concept">Cliente : « Je prends la crème apaisante, merci. »<br /><strong>Que proposez-vous ensuite ?</strong></span>
            </div>
            <div class="hero-feedback">Réponse adaptée — la suggestion d’un nettoyant sans savon est liée au soin et expliquée avec pertinence.</div>
            <p class="small subtle" style="margin-top:0.8rem">Vous pouvez maintenant passer à la simulation. ${ICON("arrowRight")}</p>
          </div>
        </div>
      </section>

      <section class="story" id="simulations">
        <div class="story-grid flip">
          <div class="story-copy reveal">
            <p class="eyebrow">Simuler</p>
            <h2>Entraînez-vous avec un client virtuel plus vrai que nature.</h2>
            <p class="lede">Nos clients simulés expriment de vrais doutes, posent des questions inattendues et manifestent des hésitations réelles. Vous répondez librement, sans risque pour vos vrais clients.</p>
            <div class="button-row" style="margin-top:1.4rem">
              <a class="button button-primary" href="#/register">Démarrer une simulation ${ICON("arrowRight")}</a>
            </div>
          </div>
          <div class="story-visual reveal">
            <div class="hero-course-line"><strong>Simulation client</strong><span>Cas : Objection sur le prix</span></div>
            <div class="story-sim">
              <div class="bubble">« Franchement, je trouve ce produit beaucoup trop cher par rapport à mon budget habituel. »</div>
              <div class="bubble me">« Je comprends tout à fait. Quel est votre principal objectif pour votre peau actuellement ? »</div>
              <div class="typing">Le patient réfléchit à votre question…</div>
            </div>
            <div class="story-eval">
              <div class="row"><span>Écoute & Empathie</span><span class="track"><span class="fill good" style="width:90%"></span></span><strong>90%</strong></div>
              <div class="row"><span>Découverte du besoin</span><span class="track"><span class="fill good" style="width:84%"></span></span><strong>84%</strong></div>
              <div class="row"><span>Valorisation d'usage</span><span class="track"><span class="fill weak" style="width:58%"></span></span><strong>58%</strong></div>
            </div>
            <div class="story-priority"><strong>Priorité identifiée :</strong> expliciter le coût à l’usage en dirhams avant de conclure la vente.</div>
          </div>
        </div>
      </section>

      <section class="story" id="progression">
        <div class="story-grid">
          <div class="story-copy reveal">
            <p class="eyebrow">Progresser</p>
            <h2>Chaque entraînement rend votre équipe plus confiante.</h2>
            <p class="lede">Leçons validées, simulations réussies, indicateurs de réflexes : votre progression reste à jour, compétence par compétence, pour viser l'excellence au comptoir.</p>
            <div class="progression-highlights">
              <div class="highlight-item">
                <strong>+42%</strong>
                <span>d'assurance constatée au comptoir après 3 simulations</span>
              </div>
              <div class="highlight-item">
                <strong>100%</strong>
                <span>des équipes formées à leur rythme sans bloquer le comptoir</span>
              </div>
            </div>
          </div>
          <div class="story-visual-rich reveal">
            <div class="visual-photo-wrap">
              <img src="assets/pharmacy_team_excellence.jpg" alt="Équipe officinale marocaine échangeant en officine à Casablanca" width="600" height="450" />
            </div>
            <div class="visual-card-floating">
              <div class="hero-bars">
                <div class="row"><span>Conseil dermocosmétique</span><span class="track"><span class="fill good" style="width:92%"></span></span><strong>Acquis (92%)</strong></div>
                <div class="row"><span>Communication & Accueil</span><span class="track"><span class="fill good" style="width:85%"></span></span><strong>Acquis (85%)</strong></div>
                <div class="row"><span>Gestion des objections</span><span class="track"><span class="fill" style="width:74%"></span></span><strong>En cours (74%)</strong></div>
                <div class="row"><span>Recommandation éthique</span><span class="track"><span class="fill good" style="width:88%"></span></span><strong>Acquis (88%)</strong></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="showcase" id="showcase">
        <div class="section-heading"><div><p class="eyebrow">Le produit, en vrai</p><h2>Explorez l’expérience</h2></div><span class="section-note">Cliquez sur une étape</span></div>
        <div class="showcase-tabs" role="tablist" aria-label="Aperçu du produit">
          <a class="showcase-tab" href="#" role="tab" aria-selected="true" data-showcase="apprendre">Apprendre</a>
          <a class="showcase-tab" href="#" role="tab" aria-selected="false" data-showcase="pratiquer">Pratiquer</a>
          <a class="showcase-tab" href="#" role="tab" aria-selected="false" data-showcase="simuler">Simuler</a>
          <a class="showcase-tab" href="#" role="tab" aria-selected="false" data-showcase="progresser">Progresser</a>
        </div>
        <div class="showcase-panel active" data-panel="apprendre">
          <div class="showcase-frame">
            <div class="frame-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>Leçon — Conseil produit</div>
            <div class="hero-lesson-card"><span class="concept"><strong>Identifier le besoin</strong> : posez une question ouverte avant de recommander.</span><div class="hero-step-flow"><span>Questionner</span><span>Reformuler</span><span>Recommander</span><span>Vérifier</span></div></div>
            <div class="hero-coach" style="position:static;box-shadow:none"><small>Coach IA</small>Posez une question ouverte : « Qu’est-ce qui vous gêne au quotidien avec votre peau ? »</div>
          </div>
        </div>
        <div class="showcase-panel" data-panel="pratiquer">
          <div class="showcase-frame">
            <div class="frame-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>Exercice</div>
            <div class="hero-lesson-card"><span class="concept">Client : « Je trouve ce produit trop cher. »<br /><strong>Quelle est votre première réaction ?</strong></span></div>
            <div class="hero-feedback">Réponse adaptée — vous reconnaissez la contrainte avant d’argumenter.</div>
          </div>
        </div>
        <div class="showcase-panel" data-panel="simuler">
          <div class="showcase-frame">
            <div class="frame-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>Simulation — Objection prix</div>
            <div class="story-sim"><div class="bubble">C’est trop cher pour moi.</div><div class="bubble me">Je comprends — parlons d’abord de ce que vous recherchez.</div></div>
            <div class="story-eval">
              <div class="row"><span>Écoute</span><span class="track"><span class="fill good" style="width:88%"></span></span><strong>88</strong></div>
              <div class="row"><span>Valeur</span><span class="track"><span class="fill weak" style="width:54%"></span></span><strong>54</strong></div>
            </div>
            <div class="story-priority"><strong>Priorité :</strong> expliquer la valeur du produit.</div>
          </div>
        </div>
        <div class="showcase-panel" data-panel="progresser">
          <div class="showcase-frame">
            <div class="frame-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>Progression</div>
            <div class="hero-bars">
              <div class="row"><span>Conseil produit</span><span class="track"><span class="fill good" style="width:90%"></span></span><strong>Acquis</strong></div>
              <div class="row"><span>Communication</span><span class="track"><span class="fill" style="width:76%"></span></span><strong>En progression</strong></div>
              <div class="row"><span>Gestion des objections</span><span class="track"><span class="fill weak" style="width:48%"></span></span><strong>À renforcer</strong></div>
            </div>
            <div class="story-priority">Prochaine leçon recommandée : « Relier les bénéfices à la situation du client ».</div>
          </div>
        </div>
      </section>

      <section class="final-cta reveal">
        <div class="final-cta-content">
          <span class="final-cta-pill">Excellence Officinale</span>
          <h2>Prêt à dynamiser les compétences de votre équipe ?</h2>
          <p>Créez votre compte en 2 minutes, fixez vos objectifs de formation et commencez vos premières simulations interactives sans engagement.</p>
          <div class="button-row">
            <a class="button button-primary button-lg" href="#/register">Créer un compte & débuter</a>
            <a class="button button-secondary button-lg" href="#/login">Se connecter</a>
          </div>
        </div>
      </section>

      <section class="landing-disclaimer">
        <p class="subtle small"><strong>Note déontologique :</strong> BP Learning est une plateforme d’apprentissage dédiée aux équipes officinales. Toutes les situations et données sont fictives. La plateforme forme aux réflexes de communication et de conseil et ne donne aucun avis ni diagnostic médical.</p>
      </section>

      <footer class="landing-footer">
        <div class="foot-grid">
          <div>
            <p class="eyebrow">BP Learning</p>
            <p class="small subtle">Plateforme d’apprentissage pour les équipes officinales au Maroc. Apprenez, pratiquez, simulez, progressez.</p>
          </div>
          <div>
            <h4>Explorer</h4>
            <ul>
              <li><a href="#" data-scroll="formations">Comment ça marche</a></li>
              <li><a href="#" data-scroll="simulations">Simulations</a></li>
              <li><a href="#" data-scroll="showcase">Aperçu du produit</a></li>
            </ul>
          </div>
          <div>
            <h4>Accès</h4>
            <ul>
              <li><a href="#/login">Se connecter</a></li>
              <li><a href="#/register">Créer un compte</a></li>
              <li><a href="#/forgot-password">Mot de passe oublié</a></li>
            </ul>
          </div>
        </div>
        <p class="fine">BP Learning · Plateforme d’apprentissage pour l'officine · Contenu fictif à but pédagogique — la plateforme forme aux réflexes professionnels et ne donne aucun avis médical.</p>
      </footer>
    </div>`;
  }

  /* ------------------------------ auth forms ------------------------------ */

  const AUTH_FLOW_STEPS = ["Objectif", "Formation", "Pratique", "Simulation", "Progression"];

  function authExperience(title, subtitle, body, visual) {
    return `<div class="auth-page-shell">
      <div class="auth-card">
        <div class="auth-card-top">
          <span class="auth-card-badge">
            <span class="badge-dot" aria-hidden="true"></span>
            Officines Maroc · Formation Continue
          </span>
          <a class="auth-back-link" href="#/" aria-label="Retour à l’accueil">
            <span class="back-icon">${ICON("arrowLeft")}</span>
            <span>Accueil</span>
          </a>
        </div>
        <div class="auth-card-header">
          <h1 tabindex="-1">${title}</h1>
          <p class="lede">${subtitle}</p>
        </div>
        ${body}
        <div class="auth-card-trust">
          <span class="trust-item">${ICON("shield")} Pratiques Officinales Maroc</span>
          <span class="trust-item">${ICON("lock")} Authentification Sécurisée</span>
        </div>
      </div>
    </div>`;
  }

  function passwordField(id, name, labelText, hintText, extraAttrs, dbDown) {
    return `<div class="auth-field">
      <label for="${id}">${labelText}</label>
      <div class="password-wrap">
        <input id="${id}" name="${name}" type="password" ${extraAttrs} required ${dbDown ? "disabled" : ""} />
        <button class="password-toggle" type="button" data-password-toggle aria-pressed="false" ${dbDown ? "disabled" : ""}>Afficher</button>
      </div>
      ${hintText ? `<span class="hint">${hintText}</span>` : ""}
    </div>`;
  }

  function renderLogin() {
    const dbDown = platform.mode === "legacy";
    const visual = { title: "Votre entraînement vous attend.", subtitle: "Chaque leçon terminée, chaque simulation analysée rend la prochaine étape plus précise.", activeStep: 4, cardTag: "Reprendre la session" };
    return authExperience("Ravi de vous revoir.", "Reprenez votre parcours là où vous l’avez laissé : leçons, simulations et progression vous attendent.", `
      ${dbDown ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>La base de données n’est pas configurée (MONGODB_URI). La connexion est indisponible pour le moment.</p></div>' : ""}
      <form class="stack-form" data-auth-form="login">
        <div class="auth-field">
          <label for="login-email">Adresse e-mail</label>
          <input id="login-email" name="email" type="email" autocomplete="email" required ${dbDown ? "disabled" : ""} />
        </div>
        ${passwordField("login-password", "password", "Mot de passe", "", 'autocomplete="current-password"', dbDown)}
        <div class="auth-actions">
          <button class="button button-primary" type="submit" ${dbDown ? "disabled" : ""}>Se connecter</button>
          <div class="quiet-row"><a class="button button-ghost" href="#/forgot-password">Mot de passe oublié ?</a></div>
        </div>
        <div class="form-error auth-error" data-form-error></div>
      </form>
      <p class="auth-switch">Pas encore de compte ? <a href="#/register">Créer un compte</a></p>`, visual);
  }

  function renderRegister() {
    const dbDown = platform.mode === "legacy";
    const disabled = !platform.authConfig.allowPublicRegistration;
    const visual = { title: "Votre parcours commence ici.", subtitle: "Objectif → formation → pratique → simulation → progression. Le coach IA vous accompagne à chaque étape.", activeStep: 0, cardTag: "Parcours généré pour vous" };
    return authExperience("Commencez votre parcours.", "Un parcours construit pour vous, avec des leçons visuelles, des exercices et des simulations avec un retour concret.", `
      ${disabled ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>L’inscription publique est désactivée. Les comptes sont créés par votre administrateur : vous recevrez un lien d’activation par e-mail.</p></div>' : ""}
      ${dbDown ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>La base de données n’est pas configurée (MONGODB_URI). L’inscription est indisponible pour le moment.</p></div>' : ""}
      <form class="stack-form" data-auth-form="register">
        <div class="form-grid">
          <div class="auth-field">
            <label for="register-firstname">Prénom</label>
            <input id="register-firstname" name="firstName" autocomplete="given-name" required ${disabled || dbDown ? "disabled" : ""} />
          </div>
          <div class="auth-field">
            <label for="register-lastname">Nom</label>
            <input id="register-lastname" name="lastName" autocomplete="family-name" required ${disabled || dbDown ? "disabled" : ""} />
          </div>
        </div>
        <div class="auth-field">
          <label for="register-email">Adresse e-mail</label>
          <input id="register-email" name="email" type="email" autocomplete="email" required ${disabled || dbDown ? "disabled" : ""} />
        </div>
        ${passwordField("register-password", "password", "Mot de passe", `Au moins ${platform.authConfig.minimumPasswordLength} caractères`, `autocomplete="new-password" minlength="${platform.authConfig.minimumPasswordLength}"`, disabled || dbDown)}
        <div class="auth-actions">
          <button class="button button-primary" type="submit" ${disabled || dbDown ? "disabled" : ""}>Créer mon compte</button>
        </div>
        <div class="form-error auth-error" data-form-error></div>
      </form>
      <p class="auth-switch">Déjà un compte ? <a href="#/login">Se connecter</a></p>`, visual);
  }

  function renderForgot() {
    const dbDown = platform.mode === "legacy";
    const visual = { title: "Vos données restent protégées.", subtitle: "Un lien unique, limité dans le temps, pour reprendre la main sur votre compte.", activeStep: 4, cardTag: "Accès protégé" };
    return authExperience("Réinitialiser votre mot de passe", "Indiquez votre adresse e-mail : nous vous enverrons un lien de réinitialisation.", `
      ${dbDown ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>La base de données n’est pas configurée (MONGODB_URI). La réinitialisation est indisponible pour le moment.</p></div>' : ""}
      <a class="auth-back" href="#/login">${ICON("arrowLeft")}Retour à la connexion</a>
      <form class="stack-form" data-auth-form="forgot">
        <div class="auth-field">
          <label for="forgot-email">Adresse e-mail</label>
          <input id="forgot-email" name="email" type="email" autocomplete="email" required ${dbDown ? "disabled" : ""} />
        </div>
        <div class="form-error auth-error" data-form-error></div>
        <div class="form-message" data-form-message></div>
        <div class="auth-actions">
          <button class="button button-primary" type="submit" ${dbDown ? "disabled" : ""}>Recevoir le lien</button>
        </div>
      </form>`, visual);
  }

  function renderReset() {
    const token = new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
    const dbDown = platform.mode === "legacy";
    const visual = { title: "Dernière étape avant de reprendre.", subtitle: "Choisissez un nouveau mot de passe, puis retrouvez votre parcours d’entraînement.", activeStep: 4, cardTag: "Dernière étape" };
    return authExperience("Nouveau mot de passe", "Choisissez un nouveau mot de passe pour votre compte.", `
      ${dbDown ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>La base de données n’est pas configurée (MONGODB_URI). La réinitialisation est indisponible pour le moment.</p></div>' : ""}
      ${!token ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>Lien de réinitialisation incomplet : vérifiez que vous avez ouvert le lien complet reçu par e-mail.</p></div>' : ""}
      <a class="auth-back" href="#/login">${ICON("arrowLeft")}Retour à la connexion</a>
      <form class="stack-form" data-auth-form="reset">
        <input type="hidden" name="token" value="${escapeHTML(token)}" />
        ${passwordField("reset-password", "password", "Nouveau mot de passe", `Au moins ${platform.authConfig.minimumPasswordLength} caractères`, `autocomplete="new-password" minlength="${platform.authConfig.minimumPasswordLength}"`, dbDown || !token)}
        <div class="form-error auth-error" data-form-error></div>
        <div class="auth-actions">
          <button class="button button-primary" type="submit" ${dbDown || !token ? "disabled" : ""}>Réinitialiser</button>
        </div>
      </form>`, visual);
  }

  function renderVerifyEmail() {
    const token = new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
    const dbDown = platform.mode === "legacy";
    const visual = { title: "Une adresse confirmée, un compte protégé.", subtitle: "La vérification permet de garantir que les e-mails importants vous parviennent.", activeStep: 0, cardTag: "Confirmation" };
    return authExperience("Confirmer votre adresse e-mail", "Un dernier clic pour activer définitivement votre adresse e-mail.", `
      ${dbDown ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>La base de données n’est pas configurée (MONGODB_URI). La vérification est indisponible pour le moment.</p></div>' : ""}
      ${!token ? '<div class="banner warning-banner auth-banner">' + ICON("alert") + '<p>Lien de vérification incomplet : ouvrez le lien complet reçu par e-mail.</p></div>' : ""}
      <a class="auth-back" href="#/login">${ICON("arrowLeft")}Retour à la connexion</a>
      <div data-verify-status>
        ${token ? '<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>Vérification en cours…</div>' : ""}
      </div>
      <div class="form-error auth-error" data-verify-error></div>
      ${token ? `<button class="button button-primary" type="button" data-verify-submit ${dbDown ? "disabled" : ""}>Confirmer mon adresse e-mail</button>` : ""}
      <p class="auth-switch">Vous n’avez pas reçu le lien ? <a href="#/login">Connectez-vous</a> pour demander un nouvel envoi.</p>`, visual);
  }

  function renderForbidden() {
    return `<div class="page-shell"><div class="card forbidden-card">
      <p class="eyebrow">Accès refusé</p>
      <h1 tabindex="-1">403 — Zone réservée</h1>
      <p class="lede">Vous n’avez pas les droits nécessaires pour accéder à cette page. Seuls les administrateurs peuvent ouvrir l’espace d’administration.</p>
      <div class="button-row"><a class="button button-primary" href="#/app">Retour à mon tableau de bord</a></div>
    </div></div>`;
  }

  function renderVerifyRequired() {
    return `<div class="page-shell"><div class="card verify-required-card">
      <div class="card-top"><h1 tabindex="-1">Vérifiez votre adresse e-mail</h1></div>
      <p class="lede">Votre compte n’est pas encore activé. Ouvrez le lien de vérification reçu par e-mail pour accéder à la plateforme.</p>
      <p class="small subtle">Vous n’avez rien reçu ? Demandez un nouvel envoi.</p>
      <div class="button-row">
        <button class="button button-primary" type="button" data-verify-resend>${ICON("send")}Renvoyer l’e-mail</button>
        <button class="button button-secondary" type="button" data-logout>${ICON("logout")}Se déconnecter</button>
      </div>
    </div></div>`;
  }

  /* ------------------------------ dashboard ------------------------------ */

  async function fetchDashboard() {
    return api("/api/me/dashboard");
  }

  function renderDashboard() {
    platformSection.innerHTML = dashboardSkeleton();
    fetchDashboard()
      .then((data) => {
        if (currentRoute() !== "/app") return;
        platformSection.innerHTML = dashboardHTML(data);
        bindDashboard(data);
      })
      .catch((error) => {
        platformSection.innerHTML = errorStateHTML("Impossible de charger votre tableau de bord.", error.message, renderDashboard);
      });
  }

  function dashboardSkeleton() {
    return `<div class="page-shell">
      <div class="skeleton skeleton-line" style="width:34%;height:26px;margin-bottom:1.6rem"></div>
      <div class="skeleton skeleton-card" style="height:170px;margin-bottom:1.4rem"></div>
      <div class="grid-4">
        ${"1234".split("").map(() => '<div class="skeleton skeleton-card" style="height:88px"></div>').join("")}
      </div>
    </div>`;
  }

  function errorStateHTML(title, message, retry) {
    const section = platformSection;
    setTimeout(() => {
      section.querySelector("[data-error-retry]")?.addEventListener("click", retry);
    });
    return `<div class="page-shell"><div class="error-state" role="alert">
      <h3>${escapeHTML(title)}</h3>
      <p>${escapeHTML(message || "Une erreur est survenue.")}</p>
      <div class="button-row tight"><button class="button button-secondary" type="button" data-error-retry>${ICON("refresh")}Réessayer</button></div>
    </div></div>`;
  }

  function dashboardHTML(data) {
    const user = data.user;
    const courses = data.courses || [];
    const activeCourses = courses.filter((course) => course.status !== "archived");
    const stats = data.stats || {};
    const weakPoints = data.weakPoints || [];
    const recentSims = data.recentSimulations || [];
    const firstName = escapeHTML(user.firstName);

    const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

    const continueCourse = activeCourses.find((course) => course.progress.percent > 0 && course.progress.percent < 100)
      || activeCourses[0]
      || null;

    let continueCard = "";
    if (continueCourse) {
      const nextLabel = data.nextLesson
        ? `Prochaine leçon : ${escapeHTML(data.nextLesson.module.title)}`
        : `${continueCourse.progress.completed}/${continueCourse.progress.total} modules terminés`;
      continueCard = `<section class="continue-card">
        <div class="continue-card-content">
          <div class="continue-top-pill">
            <span class="badge-dot pulse" aria-hidden="true"></span>
            <span>Parcours en cours</span>
            <span class="continue-pill-sep">·</span>
            <span>${continueCourse.modules.length} modules</span>
          </div>
          <h2>${escapeHTML(continueCourse.title)}</h2>
          <p class="lede">${nextLabel}</p>
          <div class="continue-meta">
            <span>${ICON("layers")}${continueCourse.modules.length} modules</span>
            <span>${ICON("clock")}${escapeHTML(continueCourse.estimatedDuration || "À votre rythme")}</span>
            ${continueCourse.assignment && continueCourse.assignment.deadline ? `<span>${ICON("calendar")}Échéance : ${formatDate(continueCourse.assignment.deadline)}</span>` : ""}
          </div>
          <div class="meter"><progress class="progress-track" max="100" value="${continueCourse.progress.percent}" aria-label="Progression : ${continueCourse.progress.percent} %">${continueCourse.progress.percent}%</progress><span class="meter-value">${continueCourse.progress.percent}%</span></div>
        </div>
        <div class="continue-actions">
          <button class="button button-primary button-lg" type="button" data-continue-course="${escapeHTML(continueCourse.id)}">${ICON("play")}Continuer la leçon</button>
          <button class="button button-secondary" type="button" data-course-focus="${escapeHTML(continueCourse.id)}">Voir le parcours</button>
        </div>
      </section>`;
    }

    const metricTiles = `
      <div class="stat-tiles">
        <div class="stat-tile stat-tile-violet">
          <span class="icon-wrap">${ICON("checkCircle")}</span>
          <div class="stat-content">
            <strong>${stats.lessonsCompleted || 0}</strong>
            <span class="stat-label">Leçons terminées</span>
            <span class="stat-sub">Validées avec succès</span>
          </div>
        </div>
        <div class="stat-tile stat-tile-teal">
          <span class="icon-wrap">${ICON("chat")}</span>
          <div class="stat-content">
            <strong>${stats.simulationsRun || 0}</strong>
            <span class="stat-label">Simulations réalisées</span>
            <span class="stat-sub">Mises en situation au comptoir</span>
          </div>
        </div>
        <div class="stat-tile stat-tile-warm">
          <span class="icon-wrap">${ICON("book")}</span>
          <div class="stat-content">
            <strong>${activeCourses.length}</strong>
            <span class="stat-label">Cours en cours</span>
            <span class="stat-sub">Modules de formation</span>
          </div>
        </div>
        <div class="stat-tile stat-tile-emerald">
          <span class="icon-wrap">${ICON("chart")}</span>
          <div class="stat-content">
            <strong>${data.overallProgress}%</strong>
            <span class="stat-label">Progression globale</span>
            <span class="stat-sub">Maîtrise officinale</span>
          </div>
        </div>
      </div>`;

    let recoCard = "";
    if (weakPoints.length) {
      const top = weakPoints[0];
      const reason = top.label
        ? `Votre dernière évaluation montre que « ${escapeHTML(top.label)} » mérite encore un peu de pratique.`
        : "Votre dernière évaluation identifie un point à renforcer.";
      recoCard = `<div class="card reco-card">
        <div class="card-top">
          <span class="reco-coach-pill">${ICON("sparkles")} Coach IA</span>
          <span class="tag warning">${ICON("target")}À renforcer</span>
        </div>
        <h3>Votre prochain entraînement</h3>
        <p class="reco-reason">${reason}</p>
        <div class="reco-highlight">
          <span class="reco-bullet"></span>
          <strong>${escapeHTML(top.label)}</strong>
        </div>
        <div class="button-row tight">
          <a class="button button-primary button-sm" href="#simulations">${ICON("play")}Pratiquer ce point</a>
          <a class="button button-ghost button-sm" href="#progression">Voir mes points à renforcer</a>
        </div>
      </div>`;
    }

    const activity = [];
    activeCourses.forEach((course) => {
      activity.push({
        icon: "book",
        tone: "violet",
        title: `${escapeHTML(course.title)} — ${course.progress.percent} %`,
        detail: course.progress.percent === 100 ? "Cours terminé" : `${course.progress.completed}/${course.progress.total} modules terminés`,
      });
    });
    recentSims.slice(0, 4).forEach((sim) => {
      activity.push({
        icon: "chat",
        tone: "teal",
        title: `Simulation : ${escapeHTML(sim.scenarioTitle)}`,
        detail: `${formatDate(sim.createdAt)}${sim.priority ? ` · Priorité : ${escapeHTML(sim.priority)}` : ""}`,
      });
    });
    const activityHTML = activity.length
      ? `<ul class="activity-list">${activity.slice(0, 6).map((item) => `<li><span class="icon-wrap ${item.tone}">${ICON(item.icon)}</span><span class="activity-body"><strong>${item.title}</strong><span>${item.detail}</span></span></li>`).join("")}</ul>`
      : `<p class="small subtle">Votre activité apparaîtra ici dès que vous commencerez une leçon ou une simulation.</p>`;

    const skillBars = weakPoints.slice(0, 3).map((item) => {
      return `<div class="skill-row"><div class="skill-label"><span>${escapeHTML(item.label)}</span><span class="skill-count">${item.count} fois identifié</span></div><progress class="progress-track thin" max="100" value="${Math.min(100, item.count * 25)}" aria-label="${escapeHTML(item.label)}"></progress></div>`;
    }).join("");

    const emptyCourses = activeCourses.length === 0
      ? `<div class="empty-state">${ICON("bookOpen", "icon icon-xl")}<h3>Votre parcours commence ici</h3><p>Décrivez votre objectif : votre coach IA construit un parcours de formation adapté à votre métier en officine. Un administrateur peut aussi vous affecter des cours.</p><div class="button-row"><a class="button button-primary" href="#accueil">${ICON("sparkles")}Créer mon parcours</a></div></div>`
      : "";

    const verifyBanner = user.emailVerified
      ? ""
      : `<div class="banner warning-banner">${ICON("alert")}<div><p><strong>Votre adresse e-mail n’est pas encore vérifiée.</strong><br />Vérifiez votre boîte mail, ou demandez un nouvel envoi.</p></div><button class="button button-secondary button-sm" type="button" data-resend-verification>Renvoyer l’e-mail</button></div>`;

    return `<div class="page-shell dashboard-shell">
      ${verifyBanner}
      <div class="dashboard-head">
        <div>
          <div class="dash-welcome-badge">
            <span class="badge-dot pulse" aria-hidden="true"></span>
            <span>Espace Praticien d’Officine · Maroc</span>
          </div>
          <h1 tabindex="-1">Bonjour, ${firstName}</h1>
          <p class="lede">${escapeHTML(user.learningObjective || "Poursuivez votre entraînement et perfectionnez votre pratique au comptoir.")}</p>
        </div>
        <div class="dash-date-badge">
          <span class="icon">${ICON("calendar")}</span>
          <span>${today}</span>
        </div>
      </div>

      ${continueCard}
      ${emptyCourses}
      ${metricTiles}

      <div class="section-heading"><div><p class="eyebrow">Au programme</p><h2>Vos prochaines étapes</h2></div></div>
      <div class="dashboard-grid">
        <div class="card">${recoCard ? recoCard : `<div class="card-top"><h3>Votre prochain entraînement</h3></div><p class="small subtle">Faites une première simulation : l’analyse de l’IA identifiera votre prochain point de travail.</p><div class="button-row tight"><a class="button button-primary button-sm" href="#simulations">${ICON("play")}Faire une simulation</a></div></div>`}</div>
        <div class="card"><div class="card-top"><h3>Activité récente</h3></div>${activityHTML}</div>
        <div class="card span-2"><div class="card-top"><h3>Points à renforcer</h3>${weakPoints.length ? `<span class="tag warning">${weakPoints.length} identifié${weakPoints.length > 1 ? "s" : ""}</span>` : ""}</div>
          ${weakPoints.length ? `<div class="skill-mini">${skillBars}</div>` : '<p class="small subtle">Pas encore de point à renforcer : faites une simulation pour obtenir votre première analyse.</p>'}
          <div class="button-row tight"><a class="button button-secondary button-sm" href="#progression">Voir ma progression ${ICON("arrowRight")}</a></div>
        </div>
      </div>

      <div class="section-heading"><div><p class="eyebrow">Actions rapides</p><h2>Que souhaitez-vous faire ?</h2></div></div>
      <div class="quick-actions">
        <a class="quick-action" href="#accueil">
          <div class="quick-action-icon violet">${ICON("sparkles", "icon icon-xl")}</div>
          <div class="quick-action-body">
            <span class="quick-action-title">Continuer mon parcours</span>
            <span class="small subtle">Reprendre ou créer votre parcours IA</span>
          </div>
          <span class="quick-action-arrow">${ICON("arrowRight")}</span>
        </a>
        <a class="quick-action" href="#simulations">
          <div class="quick-action-icon teal">${ICON("chat", "icon icon-xl")}</div>
          <div class="quick-action-body">
            <span class="quick-action-title">Faire une simulation</span>
            <span class="small subtle">Pratiquer avec un client simulé</span>
          </div>
          <span class="quick-action-arrow">${ICON("arrowRight")}</span>
        </a>
        <a class="quick-action" href="#progression">
          <div class="quick-action-icon emerald">${ICON("chart", "icon icon-xl")}</div>
          <div class="quick-action-body">
            <span class="quick-action-title">Voir ma progression</span>
            <span class="small subtle">Compétences, simulations, points forts</span>
          </div>
          <span class="quick-action-arrow">${ICON("arrowRight")}</span>
        </a>
      </div>
    </div>`;
  }

  function bindDashboard(data) {
    platformSection.querySelector("[data-resend-verification]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api("/api/auth/resend-verification", {
          method: "POST",
          body: { email: platform.user && platform.user.email },
        });
        notify(result.message || "Lien de vérification envoyé. Vérifiez votre boîte mail.");
      } catch (error) {
        notify(error.message || "Impossible d’envoyer le lien.");
      } finally {
        button.disabled = false;
      }
    });
    platformSection.querySelectorAll("[data-continue-course]").forEach((button) => button.addEventListener("click", () => {
      const courseId = button.dataset.continueCourse;
      const next = (data && data.nextLesson) || null;
      if (next && next.courseId === courseId && next.module && next.module.id) {
        sessionStorage.setItem("bp-open-module", next.module.id);
        go("lecon");
        return;
      }
      sessionStorage.setItem("bp-focus-course", courseId);
      go("parcours");
    }));
    platformSection.querySelectorAll("[data-course-focus]").forEach((button) => button.addEventListener("click", () => {
      sessionStorage.setItem("bp-focus-course", button.dataset.courseFocus);
      go("parcours");
    }));
  }

  /* ------------------------------ profile ------------------------------ */

  async function renderProfile() {
    platformSection.innerHTML = '<div class="page-shell"><div class="skeleton skeleton-line" style="width:26%;height:26px;margin-bottom:1.6rem"></div><div class="skeleton skeleton-card" style="height:260px"></div></div>';
    try {
      const [meData, dashboardData] = await Promise.all([api("/api/me"), api("/api/me/dashboard").catch(() => null)]);
      if (currentRoute() !== "/profile") return;
      platformSection.innerHTML = profileHTML(meData.user, dashboardData);
      bindProfile();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger le profil.", error.message, renderProfile);
    }
  }

  function profileHTML(user, dashboardData) {
    const stats = (dashboardData && dashboardData.stats) || {};
    const overall = dashboardData ? dashboardData.overallProgress : 0;
    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">Profil</p>
          <h1 tabindex="-1">Mon profil</h1>
          <p class="lede">Vos informations personnelles et votre objectif d’apprentissage.</p>
        </div>
      </div>
      <div class="profile-layout">
        <aside class="card profile-card">
          <span class="profile-avatar" aria-hidden="true">${escapeHTML(initials(user))}</span>
          <h3>${escapeHTML(user.firstName)} ${escapeHTML(user.lastName)}</h3>
          <p class="small subtle">${escapeHTML(user.email)}</p>
          <div class="profile-role">
             <span class="tag">Administrateur</span>
            <span class="tag ${user.status === "active" ? "success" : "warning"}">${user.status === "active" ? "Compte actif" : "Compte désactivé"}</span>
          </div>
          <div class="profile-facts">
            <div class="profile-fact"><span>Leçons terminées</span><strong>${stats.lessonsCompleted || 0}</strong></div>
            <div class="profile-fact"><span>Simulations</span><strong>${stats.simulationsRun || 0}</strong></div>
            <div class="profile-fact"><span>Progression</span><strong>${overall} %</strong></div>
            <div class="profile-fact"><span>Compte créé le</span><strong>${formatDate(user.createdAt)}</strong></div>
            <div class="profile-fact"><span>Dernière connexion</span><strong>${formatDateTime(user.lastLoginAt)}</strong></div>
          </div>
        </aside>
        <div>
          <div class="card">
            <h3>${ICON("user")}Informations personnelles</h3>
            <form class="stack-form" data-profile-form>
              <div class="form-grid">
                <div class="field">
                  <label class="field-label" for="profile-firstname">Prénom</label>
                  <input id="profile-firstname" class="input-text" name="firstName" value="${escapeHTML(user.firstName)}" required />
                </div>
                <div class="field">
                  <label class="field-label" for="profile-lastname">Nom</label>
                  <input id="profile-lastname" class="input-text" name="lastName" value="${escapeHTML(user.lastName)}" required />
                </div>
              </div>
              <p class="field-hint">Votre adresse e-mail (${escapeHTML(user.email)}) ne peut être modifiée que par un administrateur.</p>
              <div class="form-error" data-profile-error></div>
              <div class="button-row"><button class="button button-primary" type="submit">Enregistrer</button></div>
            </form>
          </div>
          <div class="card">
            <h3>${ICON("target")}Objectif d’apprentissage</h3>
            <form class="stack-form" data-objective-form>
              <div class="field">
                <label class="field-label" for="profile-objective">Ce que vous souhaitez améliorer</label>
                <textarea id="profile-objective" class="textarea" name="learningObjective" maxlength="600" rows="3" placeholder="Ex. : mieux conseiller les clients sur les produits de soin">${escapeHTML(user.learningObjective || "")}</textarea>
                <span class="field-hint">Votre coach IA utilise cet objectif pour personnaliser votre parcours.</span>
              </div>
              <div class="form-error" data-objective-error></div>
              <div class="button-row"><button class="button button-primary" type="submit">Enregistrer l’objectif</button></div>
            </form>
          </div>
          <div class="card">
            <h3>${ICON("shield")}Mot de passe</h3>
            <form class="stack-form" data-password-form>
              <div class="field">
                <label class="field-label" for="profile-current-password">Mot de passe actuel</label>
                <input id="profile-current-password" class="input-text" name="currentPassword" type="password" autocomplete="current-password" required />
              </div>
              <div class="field">
                <label class="field-label" for="profile-new-password">Nouveau mot de passe</label>
                <input id="profile-new-password" class="input-text" name="newPassword" type="password" autocomplete="new-password" minlength="${platform.authConfig.minimumPasswordLength}" required />
                <div class="password-rules"><span>Au moins ${platform.authConfig.minimumPasswordLength} caractères</span></div>
              </div>
              <div class="form-error" data-password-error></div>
              <div class="button-row"><button class="button button-primary" type="submit">Changer le mot de passe</button></div>
            </form>
          </div>
        </div>
      </div>
    </div>`;
  }

  function bindProfile() {
    platformSection.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = platformSection.querySelector("[data-profile-error]");
      const firstName = platformSection.querySelector('[name="firstName"]').value.trim();
      const lastName = platformSection.querySelector('[name="lastName"]').value.trim();
      errorEl.textContent = "";
      try {
        const data = await api("/api/me", { method: "PATCH", body: { firstName, lastName } });
        platform.user = data.user;
        renderNav();
        notify("Profil mis à jour.");
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible d’enregistrer.");
      }
    });
    platformSection.querySelector("[data-objective-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = platformSection.querySelector("[data-objective-error]");
      const learningObjective = platformSection.querySelector('[name="learningObjective"]').value.trim();
      errorEl.textContent = "";
      try {
        const data = await api("/api/me", { method: "PATCH", body: { learningObjective } });
        platform.user = data.user;
        notify("Objectif enregistré.");
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible d’enregistrer.");
      }
    });
    platformSection.querySelector("[data-password-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = platformSection.querySelector("[data-password-error]");
      const currentPassword = platformSection.querySelector('[name="currentPassword"]').value;
      const newPassword = platformSection.querySelector('[name="newPassword"]').value;
      errorEl.textContent = "";
      try {
        await api("/api/me/password", { method: "PUT", body: { currentPassword, newPassword } });
        event.currentTarget.reset();
        notify("Mot de passe modifié.");
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible de changer le mot de passe.");
      }
    });
  }

  /* ------------------------------ admin views ------------------------------ */

  async function loadAdminStats() {
    return api("/api/admin/stats");
  }

  const ADMIN_TABS = [
    { route: "/admin", label: "Vue d’ensemble", icon: "home" },
    { route: "/admin/users", label: "Utilisateurs", icon: "users" },
    { route: "/admin/courses", label: "Cours", icon: "book" },
    { route: "/admin/assignments", label: "Affectations", icon: "layers" },
    { route: "/admin/messages", label: "Messages", icon: "send" },
    { route: "/admin/performance", label: "Performance", icon: "chart" },
    { route: "/admin/settings", label: "Réglages", icon: "settings" },
  ];

  function adminNavHTML(active) {
    return `<nav class="admin-nav" aria-label="Navigation administration">${ADMIN_TABS.map((tab) => `<a href="#${tab.route}" ${active === tab.route ? 'aria-current="page"' : ""}>${ICON(tab.icon)}${escapeHTML(tab.label)}</a>`).join("")}</nav>`;
  }

  function adminShell(active, eyebrow, title, inner) {
    return `<div class="page-shell">
      <div class="page-head-row">
        <div>
          <p class="eyebrow">${escapeHTML(eyebrow)}</p>
          <h1 tabindex="-1">${escapeHTML(title)}</h1>
        </div>
      </div>
      ${adminNavHTML(active)}
      ${inner}
    </div>`;
  }

  function confirmDialog({ title, message, confirmLabel = "Confirmer", danger = true }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "dialog-backdrop";
      backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h3 id="dialog-title">${escapeHTML(title)}</h3>
        <p>${escapeHTML(message)}</p>
        <div class="button-row">
          <button class="button button-secondary" type="button" data-dialog-cancel>Annuler</button>
          <button class="button ${danger ? "button-danger" : "button-primary"}" type="button" data-dialog-confirm>${escapeHTML(confirmLabel)}</button>
        </div>
      </div>`;
      document.body.appendChild(backdrop);
      const close = (result) => {
        backdrop.remove();
        document.removeEventListener("keydown", onKeydown);
        resolve(result);
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") close(false);
      };
      document.addEventListener("keydown", onKeydown);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close(false);
      });
      backdrop.querySelector("[data-dialog-cancel]").addEventListener("click", () => close(false));
      backdrop.querySelector("[data-dialog-confirm]").addEventListener("click", () => close(true));
      backdrop.querySelector("[data-dialog-confirm]").focus();
    });
  }

  function renderAdminDashboard() {
    platformSection.innerHTML = adminShell("/admin", "Administration", "Tableau de bord administrateur", `<div class="skeleton skeleton-card" style="height:120px"></div><div class="skeleton skeleton-card" style="height:180px;margin-top:1.1rem"></div>`);
    loadAdminStats()
      .then((data) => {
        if (currentRoute() !== "/admin") return;
        platformSection.innerHTML = adminStatsHTML(data);
      })
      .catch((error) => {
        platformSection.innerHTML = errorStateHTML("Impossible de charger les statistiques.", error.message, renderAdminDashboard);
      });
  }

  function adminStatsHTML(data) {
    const statCards = [
      ["users", "Utilisateurs", data.totalUsers, `${data.activeUsers} actifs cette semaine`],
      ["book", "Cours publiés", data.publishedCourses, `${data.draftCourses} brouillons`],
      ["layers", "Cours assignés", data.assignedCourses, `${data.completedCourses} terminés`],
      ["chat", "Simulations", data.simulations, `${data.evaluations} évaluations IA`],
    ];
    const maxWeakness = Math.max(1, ...(data.weaknesses || []).map((item) => item.count));
    const weaknesses = (data.weaknesses || []).length
      ? `<div class="skill-mini">${data.weaknesses.map((item) => `<div class="skill-row"><div class="skill-label"><span>${escapeHTML(item.label)}</span><span>${item.count} occurrence${item.count > 1 ? "s" : ""}</span></div><progress class="progress-track" max="${maxWeakness}" value="${item.count}" aria-label="${escapeHTML(item.label)}"></progress></div>`).join("")}</div>`
      : '<p class="small subtle">Pas encore de données d’évaluation.</p>';
    const activity = (data.recentActivity || []).length
      ? `<ul class="activity-list">${data.recentActivity.slice(0, 8).map((item) => `<li><span class="icon-wrap teal">${ICON("chat")}</span><span class="activity-body"><strong>${escapeHTML(item.user)} — ${escapeHTML(item.scenarioTitle)}</strong><span>${formatDateTime(item.createdAt)}</span></span></li>`).join("")}</ul>`
      : '<p class="small subtle">Aucune activité récente.</p>';
    return adminShell("/admin", "Administration", "Tableau de bord administrateur", `
      <div class="admin-stat-grid">
        ${statCards.map(([iconName, label, value, hint]) => `<article class="card stat-card">${ICON(iconName)}<p class="stat-number">${escapeHTML(String(value))}</p><p class="small strong" style="margin-bottom:.15rem">${escapeHTML(label)}</p><p class="tiny subtle">${escapeHTML(hint)}</p></article>`).join("")}
      </div>
      <div class="section-heading"><div><h2>Progression moyenne des apprenants</h2></div><span class="section-note">Calculée sur les cours assignés</span></div>
      <div class="card"><div class="meter"><progress class="progress-track" max="100" value="${data.averageProgress}" aria-label="Progression moyenne : ${data.averageProgress} %"></progress><span class="meter-value">${data.averageProgress}%</span></div><p class="small subtle" style="margin-top:.7rem">Moyenne de la progression sur l’ensemble des affectations de cours.</p></div>
      <div class="section-heading"><div><h2>Principales difficultés</h2></div><span class="section-note">Issues des évaluations IA</span></div>
      <div class="card">${weaknesses}</div>
      <div class="section-heading"><div><h2>Dernières activités</h2></div></div>
      <div class="card">${activity}</div>
    `);
  }

  async function renderAdminUsers() {
    platformSection.innerHTML = adminShell("/admin/users", "Administration", "Utilisateurs", `<div class="skeleton skeleton-card" style="height:180px"></div><div class="skeleton skeleton-card" style="height:220px;margin-top:1.1rem"></div>`);
    try {
      const data = await api("/api/admin/users?limit=100");
      if (currentRoute() !== "/admin/users") return;
      platformSection.innerHTML = adminUsersHTML(data.users);
      bindAdminUsers();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger les utilisateurs.", error.message, renderAdminUsers);
    }
  }

  function userRowHTML(user, isSelf) {
    return `<tr data-user-row data-user-name="${escapeHTML((user.firstName + " " + user.lastName).toLowerCase())}" data-user-email="${escapeHTML(user.email.toLowerCase())}" data-user-role="${escapeHTML(user.role)}" data-user-status="${escapeHTML(user.status)}">
      <td><strong>${escapeHTML(user.firstName)} ${escapeHTML(user.lastName)}</strong>${isSelf ? ' <span class="tag neutral">Vous</span>' : ""}</td>
      <td>${escapeHTML(user.email)}</td>
      <td>${user.role === "admin" ? '<span class="tag warning">Admin</span>' : '<span class="tag neutral">Apprenant</span>'}</td>
      <td><span class="tag ${user.status === "active" ? "success" : "error"}"><span class="status-dot ${user.status === "active" ? "on" : "off"}" aria-hidden="true"></span>${user.status === "active" ? "Actif" : "Désactivé"}</span></td>
      <td>${formatDate(user.createdAt)}</td>
      <td>${formatDateTime(user.lastLoginAt)}</td>
      <td>${user.completedLessons}</td>
      <td>${user.assignedCourses}</td>
      <td>
        <div class="row-actions">
          <button class="button button-quiet button-sm" type="button" data-user-performance="${escapeHTML(user.id)}">${ICON("chart")}Performance</button>
          <button class="button button-quiet button-sm" type="button" data-user-reset="${escapeHTML(user.id)}">${ICON("refresh")}Réinitialiser l’accès</button>
          ${user.status === "active"
            ? `<button class="button button-secondary button-sm" type="button" data-user-disable="${escapeHTML(user.id)}" ${isSelf ? "disabled" : ""}>${ICON("close")}Désactiver</button>`
            : `<button class="button button-secondary button-sm" type="button" data-user-enable="${escapeHTML(user.id)}">${ICON("check")}Activer</button>`}
           <button class="button button-ghost button-sm" type="button" data-user-make-user="${escapeHTML(user.id)}" ${isSelf ? "disabled" : ""}>Retirer admin</button>
           <button class="button button-danger button-sm" type="button" data-user-delete="${escapeHTML(user.id)}" ${isSelf ? "disabled" : ""}>${ICON("trash")}Supprimer</button>
        </div>
      </td>
    </tr>`;
  }

  function adminUsersHTML(users) {
    const rows = users.length
      ? users.map((user) => userRowHTML(user, platform.user && user.id === platform.user.id)).join("")
      : '<tr><td colspan="9">Aucun utilisateur.</td></tr>';
    return adminShell("/admin/users", "Administration", "Utilisateurs", `
      <div class="card">
        <h3>${ICON("plus")}Créer un utilisateur</h3>
        <p class="small subtle">Le nouvel utilisateur reçoit un e-mail avec un lien pour définir son mot de passe (invitation). Aucun mot de passe n’est stocké par l’administrateur.</p>
        <form class="stack-form" data-admin-create-user>
          <div class="form-grid">
            <div class="field"><label class="field-label" for="nu-firstname">Prénom</label><input id="nu-firstname" class="input-text" name="firstName" required /></div>
            <div class="field"><label class="field-label" for="nu-lastname">Nom</label><input id="nu-lastname" class="input-text" name="lastName" required /></div>
            <div class="field"><label class="field-label" for="nu-email">Adresse e-mail</label><input id="nu-email" class="input-text" name="email" type="email" required /></div>
            <div class="field"><label class="field-label" for="nu-role">Rôle</label><select id="nu-role" class="input-text" name="role"><option value="user">Apprenant</option><option value="admin">Administrateur</option></select></div>
          </div>
          <div class="form-error" data-admin-create-error></div>
          <div class="form-message" data-admin-create-message></div>
          <div class="button-row"><button class="button button-primary" type="submit">${ICON("send")}Créer et envoyer l’invitation</button></div>
        </form>
      </div>
      <div class="section-heading"><div><h2>${users.length} utilisateurs</h2></div></div>
      <div class="catalog-toolbar">
        <div class="search-field">${ICON("search")}<input class="input-text" type="search" placeholder="Rechercher par nom ou e-mail…" data-users-search aria-label="Rechercher un utilisateur" /></div>
        <select class="input-text" data-users-role aria-label="Filtrer par rôle"><option value="">Tous les rôles</option><option value="user">Apprenants</option><option value="admin">Administrateurs</option></select>
        <select class="input-text" data-users-status aria-label="Filtrer par statut"><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="disabled">Désactivés</option></select>
      </div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th>Dernière connexion</th><th>Leçons</th><th>Cours</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="section-heading"><div><h2>Performance détaillée</h2></div></div>
      <div class="card" data-user-performance-panel><p class="small subtle">Sélectionnez « Performance » sur un utilisateur pour voir le détail.</p></div>
    `);
  }

  function bindAdminUsers() {
    platformSection.querySelector("[data-users-search]")?.addEventListener("input", (event) => {
      filterUserRows(event.currentTarget.value);
    });
    platformSection.querySelector("[data-users-role]")?.addEventListener("change", (event) => {
      filterUserRows(null, event.currentTarget.value, platformSection.querySelector("[data-users-status]").value);
    });
    platformSection.querySelector("[data-users-status]")?.addEventListener("change", (event) => {
      filterUserRows(null, platformSection.querySelector("[data-users-role]").value, event.currentTarget.value);
    });
    function filterUserRows(query, role, status) {
      const searchValue = query === null ? platformSection.querySelector("[data-users-search]").value : query;
      const roleValue = role === undefined ? platformSection.querySelector("[data-users-role]").value : role;
      const statusValue = status === undefined ? platformSection.querySelector("[data-users-status]").value : status;
      const needle = searchValue.trim().toLowerCase();
      platformSection.querySelectorAll("[data-user-row]").forEach((row) => {
        const haystack = `${row.dataset.userName} ${row.dataset.userEmail}`;
        const matches = (!needle || haystack.includes(needle))
          && (!roleValue || row.dataset.userRole === roleValue)
          && (!statusValue || row.dataset.userStatus === statusValue);
        row.hidden = !matches;
      });
    }
    platformSection.querySelector("[data-admin-create-user]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorEl = platformSection.querySelector("[data-admin-create-error]");
      const messageEl = platformSection.querySelector("[data-admin-create-message]");
      errorEl.textContent = "";
      messageEl.textContent = "";
      const payload = {
        firstName: form.querySelector('[name="firstName"]').value.trim(),
        lastName: form.querySelector('[name="lastName"]').value.trim(),
        email: form.querySelector('[name="email"]').value.trim(),
        role: form.querySelector('[name="role"]').value,
      };
      try {
        const data = await api("/api/admin/users", { method: "POST", body: payload });
        form.reset();
        const hint = data.invitation && !data.invitation.sent
          ? " L’envoi d’e-mail n’est pas configuré."
          : "";
        messageEl.innerHTML = `Utilisateur créé. Invitation : ${data.invitation.sent ? "envoyée" : "non envoyée"}.${hint}`;
        if (data.devResetUrl) messageEl.innerHTML += ` Lien de développement : <a href="${escapeHTML(data.devResetUrl)}">ouvrir le lien d’activation</a>.`;
        renderAdminUsers();
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible de créer l’utilisateur.");
      }
    });
    platformSection.querySelectorAll("[data-user-performance]").forEach((button) => button.addEventListener("click", async (event) => {
      const userId = event.currentTarget.dataset.userPerformance;
      loadUserPerformance(userId);
    }));
    function loadUserPerformance(userId) {
      const panel = platformSection.querySelector("[data-user-performance-panel]");
      panel.innerHTML = '<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>Chargement…</div>';
      api(`/api/admin/users/${encodeURIComponent(userId)}/performance`)
        .then((data) => {
          panel.innerHTML = userPerformanceHTML(data);
        })
        .catch((error) => {
          panel.innerHTML = errorStateHTML("Impossible de charger la performance.", error.message, () => loadUserPerformance(userId));
        });
    }
    platformSection.querySelectorAll("[data-user-disable]").forEach((button) => button.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Désactiver ce compte ?",
        message: "L’utilisateur perdra immédiatement l’accès à la plateforme et ses sessions seront fermées. Cette action est réversible.",
        confirmLabel: "Désactiver",
      });
      if (!confirmed) return;
      updateUserStatus(button.dataset.userDisable, "disabled");
    }));
    platformSection.querySelectorAll("[data-user-enable]").forEach((button) => button.addEventListener("click", () => {
      updateUserStatus(button.dataset.userEnable, "active");
    }));
    platformSection.querySelectorAll("[data-user-make-admin]").forEach((button) => button.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Donner le rôle administrateur ?",
        message: "Cet utilisateur pourra gérer les comptes, les cours et les affectations.",
        confirmLabel: "Passer administrateur",
        danger: false,
      });
      if (!confirmed) return;
      updateUserRole(button.dataset.userMakeAdmin, "admin");
    }));
    platformSection.querySelectorAll("[data-user-make-user]").forEach((button) => button.addEventListener("click", async () => {
      const confirmed = await confirmDialog({
        title: "Retirer le rôle administrateur ?",
        message: "Cet utilisateur conservera son compte mais perdra l’accès à l’administration.",
        confirmLabel: "Retirer le rôle",
      });
      if (!confirmed) return;
      updateUserRole(button.dataset.userMakeUser, "user");
    }));
    platformSection.querySelectorAll("[data-user-reset]").forEach((button) => button.addEventListener("click", async (event) => {
      const userId = event.currentTarget.dataset.userReset;
      try {
        const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/reset-access`, { method: "POST" });
        notify(`Accès réinitialisé. Lien d’activation ${data.invitation.sent ? "envoyé" : "généré"}.`);
        if (data.devResetUrl) window.open(data.devResetUrl, "_blank", "noopener");
      } catch (error) {
        notify(error.message || "Impossible de réinitialiser l’accès.");
      }
    }));
    platformSection.querySelectorAll("[data-user-delete]").forEach((button) => button.addEventListener("click", async (event) => {
      const userId = event.currentTarget.dataset.userDelete;
      const confirmed = await confirmDialog({
        title: "Supprimer cet utilisateur ?",
        message: "Cette action est irréversible : le compte et toutes ses données (progression, simulations, évaluations, affectations) seront supprimés définitivement.",
        confirmLabel: "Supprimer définitivement",
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
        notify("Utilisateur supprimé.");
        renderAdminUsers();
      } catch (error) {
        notify(error.message || "Impossible de supprimer l’utilisateur.");
      }
    }));
  }

  async function updateUserStatus(userId, status) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { status } });
      notify("Statut mis à jour.");
      renderAdminUsers();
    } catch (error) {
      notify(error.message || "Impossible de mettre à jour le statut.");
    }
  }

  async function updateUserRole(userId, role) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { role } });
      notify("Rôle mis à jour.");
      renderAdminUsers();
    } catch (error) {
      notify(error.message || "Impossible de mettre à jour le rôle.");
    }
  }

  function userPerformanceHTML(data) {
    const weak = data.weakCriteria.length
      ? `<ul class="skill-list">${data.weakCriteria.map((item) => `<li><span>${escapeHTML(item.label)}</span><span class="tag warning">${item.count}</span></li>`).join("")}</ul>`
      : '<p class="small subtle">Aucun critère faible détecté.</p>';
    const strong = data.strongCriteria.length
      ? `<ul class="skill-list">${data.strongCriteria.map((item) => `<li><span>${escapeHTML(item.label)}</span><span class="tag success">${item.count}</span></li>`).join("")}</ul>`
      : '<p class="small subtle">Aucun critère fort détecté.</p>';
    const courses = data.courses.length
      ? `<ul class="activity-list">${data.courses.map((course) => `<li><span class="activity-body"><strong>${escapeHTML(course.title)}</strong><span>${course.progress.percent} % · ${course.progress.completed}/${course.progress.total} modules${course.deadline ? ` · échéance ${formatDate(course.deadline)}` : ""}</span></span></li>`).join("")}</ul>`
      : '<p class="small subtle">Aucun cours assigné.</p>';
    const recommended = data.recommendedNextTraining
      ? `<div class="feedback" style="margin-top:.8rem"><strong>Formation recommandée :</strong> ${escapeHTML(data.recommendedNextTraining.title)} (${data.recommendedNextTraining.progress.percent} %)</div>`
      : "";
    return `<div class="card-top"><h3>${escapeHTML(data.user.firstName)} ${escapeHTML(data.user.lastName)}</h3><span class="tag neutral">${data.learningProgress.completedLessons} leçons · ${data.learningProgress.simulationsRun} simulations · ${data.learningProgress.evaluationsReceived} évaluations</span></div>
      <div class="grid-3" style="margin-top:1rem">
        <div><h4>Critères faibles</h4>${weak}</div>
        <div><h4>Critères forts</h4>${strong}</div>
        <div><h4>Cours</h4>${courses}${recommended}</div>
      </div>`;
  }

  async function renderAdminCourses() {
    platformSection.innerHTML = adminShell("/admin/courses", "Administration", "Cours", `<div class="skeleton skeleton-card" style="height:150px"></div><div class="skeleton skeleton-card" style="height:220px;margin-top:1.1rem"></div>`);
    try {
      const data = await api("/api/admin/courses");
      if (currentRoute() !== "/admin/courses") return;
      platformSection.innerHTML = adminCoursesHTML(data.courses || []);
      bindAdminCourses();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger les cours.", error.message, renderAdminCourses);
    }
  }

  function courseStatusTag(course) {
    if (course.status === "published") return '<span class="tag success"><span class="status-dot on" aria-hidden="true"></span>Publié</span>';
    if (course.status === "archived") return '<span class="tag neutral">Archivé</span>';
    return '<span class="tag warning">Brouillon</span>';
  }

  function adminCoursesHTML(courses) {
    const rows = courses.length
      ? courses.map((course) => `<tr>
          <td><strong>${escapeHTML(course.title)}</strong><br /><span class="tiny subtle">${escapeHTML(course.objective.slice(0, 90))}${course.objective.length > 90 ? "…" : ""}</span></td>
          <td>${courseStatusTag(course)}</td>
          <td>${course.modules.length}</td>
          <td>${formatDate(course.updatedAt)}</td>
          <td>
            <div class="row-actions">
              ${course.status === "draft" ? `<button class="button button-primary button-sm" type="button" data-course-publish="${escapeHTML(course.id)}">${ICON("check")}Publier</button>` : ""}
              ${course.status === "published" ? `<button class="button button-secondary button-sm" type="button" data-course-archive="${escapeHTML(course.id)}">Archiver</button>` : ""}
              <button class="button button-quiet button-sm" type="button" data-course-edit="${escapeHTML(course.id)}">${ICON("settings")}Modifier</button>
              <button class="button button-danger button-sm" type="button" data-course-delete="${escapeHTML(course.id)}">${ICON("trash")}Supprimer</button>
            </div>
          </td>
        </tr>`).join("")
      : '<tr><td colspan="5">Aucun cours.</td></tr>';
    return adminShell("/admin/courses", "Administration", "Cours", `
      <div class="card card-tint">
        <h3>${ICON("sparkles")}Générer un cours avec l’IA</h3>
        <p class="small subtle">L’IA produit un brouillon. Vous le relisez, le modifiez, puis le publiez. Rien n’est affecté aux apprenants avant publication.</p>
        <form class="stack-form" data-admin-generate-course>
          <div class="field">
            <label class="field-label" for="gc-objective">Objectif de formation</label>
            <textarea id="gc-objective" class="textarea" name="objective" rows="2" maxlength="600" placeholder="Ex. : former l’équipe à la vente complémentaire éthique" required></textarea>
          </div>
          <div class="form-error" data-generate-error></div>
          <div class="button-row"><button class="button button-primary" type="submit" data-generate-button>${ICON("sparkles")}Générer le brouillon</button></div>
        </form>
      </div>
      <div class="card" data-course-editor hidden></div>
      <div class="section-heading"><div><h2>Tous les cours</h2></div><span class="section-note">Brouillon → relecture → publication → affectation</span></div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Titre</th><th>Statut</th><th>Modules</th><th>Modifié le</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `);
  }

  function bindAdminCourses() {
    platformSection.querySelector("[data-admin-generate-course]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = platformSection.querySelector("[data-generate-error]");
      const button = platformSection.querySelector("[data-generate-button]");
      const objective = platformSection.querySelector('[name="objective"]').value.trim();
      errorEl.textContent = "";
      button.disabled = true;
      button.textContent = "Génération en cours…";
      try {
        const data = await api("/api/admin/courses/generate", { method: "POST", body: { objective } });
        openCourseEditor(null, data.course);
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "La génération a échoué.");
      } finally {
        button.disabled = false;
        button.textContent = "Générer le brouillon";
      }
    });
    platformSection.querySelectorAll("[data-course-publish]").forEach((button) => button.addEventListener("click", async (event) => {
      const courseId = event.currentTarget.dataset.coursePublish;
      try {
        await api(`/api/admin/courses/${encodeURIComponent(courseId)}/publish`, { method: "POST" });
        notify("Cours publié.");
        renderAdminCourses();
      } catch (error) {
        notify(error.message || "Impossible de publier.");
      }
    }));
    platformSection.querySelectorAll("[data-course-archive]").forEach((button) => button.addEventListener("click", async (event) => {
      const courseId = event.currentTarget.dataset.courseArchive;
      const confirmed = await confirmDialog({
        title: "Archiver ce cours ?",
        message: "Le cours restera dans la base mais ne sera plus visible ni disponible pour les apprenants.",
        confirmLabel: "Archiver",
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/courses/${encodeURIComponent(courseId)}/archive`, { method: "POST" });
        notify("Cours archivé.");
        renderAdminCourses();
      } catch (error) {
        notify(error.message || "Impossible d’archiver.");
      }
    }));
    platformSection.querySelectorAll("[data-course-edit]").forEach((button) => button.addEventListener("click", async (event) => {
      const courseId = event.currentTarget.dataset.courseEdit;
      try {
        const data = await api("/api/admin/courses");
        const course = (data.courses || []).find((item) => item.id === courseId);
        if (course) openCourseEditor(courseId, course);
      } catch (error) {
        notify(error.message || "Impossible d’ouvrir le cours.");
      }
    }));
    platformSection.querySelectorAll("[data-course-delete]").forEach((button) => button.addEventListener("click", async (event) => {
      const courseId = event.currentTarget.dataset.courseDelete;
      const confirmed = await confirmDialog({
        title: "Supprimer ce cours ?",
        message: "Cette action est irréversible : le cours, ses modules et toutes les affectations associées seront supprimés définitivement.",
        confirmLabel: "Supprimer définitivement",
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
        notify("Cours supprimé.");
        renderAdminCourses();
      } catch (error) {
        notify(error.message || "Impossible de supprimer le cours.");
      }
    }));
  }

  function openCourseEditor(courseId, course) {
    const editor = platformSection.querySelector("[data-course-editor]");
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    editor.innerHTML = `
      <h3>${courseId ? "Modifier le cours" : "Relire le brouillon généré"}</h3>
      ${courseId ? "" : '<div class="banner info-banner">' + ICON("info") + '<p>Contenu généré par IA — relisez et corrigez avant publication.</p></div>'}
      <form class="stack-form" data-course-edit-form data-edit-id="${courseId ? escapeHTML(courseId) : ""}">
        <div class="field"><label class="field-label" for="ce-title">Titre</label><input id="ce-title" class="input-text" name="title" value="${escapeHTML(course.title)}" maxlength="200" required /></div>
        <div class="field"><label class="field-label" for="ce-objective">Objectif</label><textarea id="ce-objective" class="textarea" name="objective" rows="2" maxlength="500" required>${escapeHTML(course.objective)}</textarea></div>
        <div class="field"><label class="field-label" for="ce-duration">Durée estimée</label><input id="ce-duration" class="input-text" name="estimatedDuration" value="${escapeHTML(course.estimatedDuration || "Environ 20 minutes")}" maxlength="60" /></div>
        <div class="field"><span class="field-label">Modules</span>
          <div data-module-list>${(course.modules || []).map((module, index) => `
            <div class="module-editor-row" data-module-row>
              <input class="input-text" data-module-id value="${escapeHTML(module.id)}" maxlength="40" aria-label="Identifiant du module ${index + 1}" />
              <input class="input-text" data-module-title value="${escapeHTML(module.title)}" maxlength="160" aria-label="Titre du module ${index + 1}" required />
              <textarea class="textarea" data-module-description rows="1" maxlength="400" aria-label="Description du module ${index + 1}" required>${escapeHTML(module.description)}</textarea>
              <button class="button button-ghost button-sm" type="button" data-module-remove>${ICON("trash")}Supprimer</button>
            </div>`).join("")}</div>
        </div>
        <div class="form-error" data-course-edit-error></div>
        <div class="button-row">
          ${courseId ? '<button class="button button-primary" type="submit">Enregistrer les modifications</button>' : '<button class="button button-primary" type="submit">Enregistrer comme brouillon</button>'}
          <button class="button button-secondary" type="button" data-course-editor-close>Fermer</button>
        </div>
      </form>`;
    editor.querySelector("[data-course-editor-close]")?.addEventListener("click", () => { editor.hidden = true; });
    editor.querySelector("[data-module-list]")?.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-module-remove]");
      if (removeButton) removeButton.closest("[data-module-row]").remove();
    });
    editor.querySelector("[data-course-edit-form]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = editor.querySelector("[data-course-edit-error]");
      errorEl.textContent = "";
      const rows = [...editor.querySelectorAll("[data-module-row]")];
      const modules = rows.map((row, index) => ({
        id: row.querySelector("[data-module-id]").value.trim() || `module-${index + 1}`,
        title: row.querySelector("[data-module-title]").value.trim(),
        description: row.querySelector("[data-module-description]").value.trim(),
      })).filter((module) => module.title && module.description);
      const payload = {
        title: editor.querySelector('[name="title"]').value.trim(),
        objective: editor.querySelector('[name="objective"]').value.trim(),
        estimatedDuration: editor.querySelector('[name="estimatedDuration"]').value.trim(),
        modules,
      };
      try {
        if (courseId) {
          await api(`/api/admin/courses/${encodeURIComponent(courseId)}`, { method: "PATCH", body: payload });
          notify("Cours modifié.");
        } else {
          await api("/api/admin/courses", { method: "POST", body: payload });
          notify("Brouillon enregistré.");
        }
        editor.hidden = true;
        renderAdminCourses();
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible d’enregistrer le cours.");
      }
    });
  }

  async function renderAdminAssignments() {
    platformSection.innerHTML = adminShell("/admin/assignments", "Administration", "Affectations de cours", `<div class="skeleton skeleton-card" style="height:200px"></div><div class="skeleton skeleton-card" style="height:200px;margin-top:1.1rem"></div>`);
    try {
      const [assignmentData, courseData, userData] = await Promise.all([
        api("/api/admin/assignments"),
        api("/api/admin/courses"),
        api("/api/admin/users?limit=100"),
      ]);
      if (currentRoute() !== "/admin/assignments") return;
      platformSection.innerHTML = adminAssignmentsHTML(assignmentData.assignments || [], courseData.courses || [], userData.users || []);
      bindAdminAssignments();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger les affectations.", error.message, renderAdminAssignments);
    }
  }

  function adminAssignmentsHTML(assignments, courses, users) {
    const published = courses.filter((course) => course.status === "published");
    const activeUsers = users.filter((user) => user.status === "active");
    const rows = assignments.length
      ? assignments.map((item) => `<tr>
          <td><strong>${escapeHTML(item.userName || item.userId)}</strong></td>
          <td>${escapeHTML(item.course ? item.course.title : item.courseId)}</td>
          <td>${item.status === "completed" ? '<span class="tag success"><span class="status-dot on" aria-hidden="true"></span>Terminé</span>' : '<span class="tag neutral">En cours</span>'}</td>
          <td>${item.deadline ? formatDate(item.deadline) : '<span class="tiny subtle">Sans échéance</span>'}</td>
          <td><button class="button button-secondary button-sm" type="button" data-unassign="${escapeHTML(item.id)}">${ICON("close")}Retirer</button></td>
        </tr>`).join("")
      : '<tr><td colspan="5">Aucune affectation.</td></tr>';
    return adminShell("/admin/assignments", "Administration", "Affectations de cours", `
      <div class="card">
        <h3>${ICON("layers")}Assigner un cours publié</h3>
        <form class="stack-form" data-admin-assign>
          <div class="field"><label class="field-label" for="as-course">Cours (publié)</label>
            <select id="as-course" class="input-text" name="courseId" required>
              ${published.length ? published.map((course) => `<option value="${escapeHTML(course.id)}">${escapeHTML(course.title)}</option>`).join("") : '<option value="" disabled>Aucun cours publié</option>'}
            </select>
          </div>
          <div class="field"><label class="field-label" for="as-users">Apprenants</label>
            <select id="as-users" class="input-text" name="userMode">
              <option value="selected">Utilisateurs sélectionnés</option>
              <option value="all">Tous les utilisateurs actifs</option>
            </select>
          </div>
          <div data-as-user-list>
            <div class="checkbox-grid">
              ${activeUsers.map((user) => `<label class="check-row"><input type="checkbox" name="assign-user" value="${escapeHTML(user.id)}" /> <span>${escapeHTML(user.firstName)} ${escapeHTML(user.lastName)} <span class="tiny subtle">(${escapeHTML(user.email)})</span></span></label>`).join("")}
            </div>
          </div>
          <div class="field"><label class="field-label" for="as-deadline">Échéance (facultatif)</label>
            <input id="as-deadline" class="input-text" name="deadline" type="date" />
            <span class="field-hint">Sans échéance définie, aucune date limite n’est appliquée.</span>
          </div>
          <div class="form-error" data-assign-error></div>
          <div class="button-row"><button class="button button-primary" type="submit">${ICON("send")}Assigner</button></div>
        </form>
      </div>
      <div class="section-heading"><div><h2>Affectations existantes</h2></div></div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Apprenant</th><th>Cours</th><th>Statut</th><th>Échéance</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `);
  }

  function bindAdminAssignments() {
    platformSection.querySelector('[name="userMode"]')?.addEventListener("change", (event) => {
      const list = platformSection.querySelector("[data-as-user-list]");
      if (list) list.hidden = event.currentTarget.value === "all";
    });
    platformSection.querySelector("[data-admin-assign]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = platformSection.querySelector("[data-assign-error]");
      errorEl.textContent = "";
      const courseId = platformSection.querySelector('[name="courseId"]').value;
      const userMode = platformSection.querySelector('[name="userMode"]').value;
      const deadline = platformSection.querySelector('[name="deadline"]').value;
      const payload = { courseId, deadline: deadline || null };
      if (userMode === "all") {
        payload.allUsers = true;
      } else {
        payload.userIds = [...platformSection.querySelectorAll('input[name="assign-user"]:checked')].map((input) => input.value);
      }
      try {
        const data = await api("/api/admin/assignments", { method: "POST", body: payload });
        notify(`${data.assigned} affectation(s) créée(s).`);
        renderAdminAssignments();
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible d’assigner.");
      }
    });
    platformSection.querySelectorAll("[data-unassign]").forEach((button) => button.addEventListener("click", async (event) => {
      const id = event.currentTarget.dataset.unassign;
      const confirmed = await confirmDialog({
        title: "Retirer cette affectation ?",
        message: "Le cours ne sera plus visible pour cet apprenant. Sa progression déjà enregistrée n’est pas supprimée.",
        confirmLabel: "Retirer",
      });
      if (!confirmed) return;
      try {
        await api(`/api/admin/assignments/${encodeURIComponent(id)}`, { method: "DELETE" });
        notify("Affectation retirée.");
        renderAdminAssignments();
      } catch (error) {
        notify(error.message || "Impossible de retirer l’affectation.");
      }
    }));
  }

  async function renderAdminMessages() {
    platformSection.innerHTML = adminShell("/admin/messages", "Administration", "Messages", `<div class="skeleton skeleton-card" style="height:220px"></div>`);
    try {
      const data = await api("/api/admin/users?limit=100");
      if (currentRoute() !== "/admin/messages") return;
      platformSection.innerHTML = adminMessagesHTML(data.users || []);
      bindAdminMessages();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger les destinataires.", error.message, renderAdminMessages);
    }
  }

  function adminMessagesHTML(users) {
    const activeUsers = users.filter((user) => user.status === "active" && !(platform.user && user.id === platform.user.id));
    return adminShell("/admin/messages", "Administration", "Messages", `
      <div class="card">
        <h3>${ICON("send")}Envoyer un message par e-mail</h3>
        <p class="small subtle">Le message est envoyé par e-mail aux destinataires sélectionnés (200 maximum). L’envoi est journalisé dans l’audit.</p>
        <form class="stack-form" data-admin-message>
          <div class="field"><label class="field-label" for="msg-subject">Objet</label><input id="msg-subject" class="input-text" name="subject" maxlength="200" required /></div>
          <div class="field"><label class="field-label" for="msg-text">Message</label><textarea id="msg-text" class="textarea" name="text" rows="5" maxlength="5000" required placeholder="Ex. : une nouvelle formation « Conseil en dermocosmétique » est disponible dans votre espace."></textarea></div>
          <div class="field"><label class="field-label" for="msg-recipients">Destinataires</label>
            <select id="msg-recipients" class="input-text" name="recipientMode">
              <option value="selected">Utilisateurs sélectionnés</option>
              <option value="all">Tous les utilisateurs actifs</option>
            </select>
          </div>
          <div data-msg-user-list>
            <div class="checkbox-grid">
              ${activeUsers.map((user) => `<label class="check-row"><input type="checkbox" name="msg-user" value="${escapeHTML(user.id)}" /> <span>${escapeHTML(user.firstName)} ${escapeHTML(user.lastName)} <span class="tiny subtle">(${escapeHTML(user.email)})</span></span></label>`).join("") || '<p class="small subtle">Aucun autre utilisateur actif.</p>'}
            </div>
          </div>
          <div class="form-error" data-message-error></div>
          <div class="form-message" data-message-result></div>
          <div class="button-row"><button class="button button-primary" type="submit">${ICON("send")}Envoyer le message</button></div>
        </form>
      </div>
    `);
  }

  function bindAdminMessages() {
    platformSection.querySelector('[name="recipientMode"]')?.addEventListener("change", (event) => {
      const list = platformSection.querySelector("[data-msg-user-list]");
      if (list) list.hidden = event.currentTarget.value === "all";
    });
    platformSection.querySelector("[data-admin-message]")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorEl = platformSection.querySelector("[data-message-error]");
      const resultEl = platformSection.querySelector("[data-message-result]");
      errorEl.textContent = "";
      resultEl.textContent = "";
      const recipientMode = form.querySelector('[name="recipientMode"]').value;
      const payload = {
        subject: form.querySelector('[name="subject"]').value.trim(),
        text: form.querySelector('[name="text"]').value.trim(),
        recipients: recipientMode === "all"
          ? "all"
          : [...form.querySelectorAll('input[name="msg-user"]:checked')].map((input) => input.value),
      };
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const data = await api("/api/admin/messages", { method: "POST", body: payload });
        form.reset();
        resultEl.innerHTML = `<div class="feedback">Message envoyé : ${data.sent} sur ${data.total} destinataire(s).${data.failed ? ` ${data.failed} échec(s).` : ""}</div>`;
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible d’envoyer le message.");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function renderAdminPerformance() {
    platformSection.innerHTML = adminShell("/admin/performance", "Administration", "Performance des apprenants", `<div class="skeleton skeleton-card" style="height:120px"></div><div class="skeleton skeleton-card" style="height:180px;margin-top:1.1rem"></div>`);
    try {
      const [stats, userData] = await Promise.all([loadAdminStats(), api("/api/admin/users?limit=100")]);
      if (currentRoute() !== "/admin/performance") return;
      platformSection.innerHTML = adminPerformanceHTML(stats, userData.users || []);
      bindAdminPerformance();
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger la performance.", error.message, renderAdminPerformance);
    }
  }

  function adminPerformanceHTML(stats, users) {
    return adminShell("/admin/performance", "Administration", "Performance des apprenants", `
      <div class="admin-stat-grid">
        <article class="card stat-card">${ICON("chart")}<p class="stat-number">${stats.averageProgress}%</p><p class="small strong">Progression moyenne</p></article>
        <article class="card stat-card">${ICON("chat")}<p class="stat-number">${stats.simulations}</p><p class="small strong">Simulations</p></article>
        <article class="card stat-card">${ICON("sparkles")}<p class="stat-number">${stats.evaluations}</p><p class="small strong">Évaluations IA</p></article>
        <article class="card stat-card">${ICON("checkCircle")}<p class="stat-number">${stats.completedCourses}</p><p class="small strong">Cours terminés</p></article>
      </div>
      <div class="section-heading"><div><h2>Analyse individuelle</h2></div><span class="section-note">Sélectionnez un apprenant pour le détail</span></div>
      <div class="card">
        <div class="field">
          <label class="field-label" for="perf-user">Apprenant</label>
          <select id="perf-user" class="input-text">
            <option value="">— Sélectionner un apprenant —</option>
            ${users.map((user) => `<option value="${escapeHTML(user.id)}">${escapeHTML(user.firstName)} ${escapeHTML(user.lastName)} (${escapeHTML(user.email)})</option>`).join("")}
          </select>
        </div>
        <div class="form-error" data-perf-error></div>
        <div data-perf-panel><p class="small subtle">Choisissez un apprenant pour afficher son détail : progression, critères forts et faibles, formation recommandée.</p></div>
      </div>
    `);
  }

  function bindAdminPerformance() {
    platformSection.querySelector("#perf-user")?.addEventListener("change", async (event) => {
      const userId = event.currentTarget.value;
      const panel = platformSection.querySelector("[data-perf-panel]");
      const errorEl = platformSection.querySelector("[data-perf-error]");
      errorEl.textContent = "";
      if (!userId) {
        panel.innerHTML = '<p class="small subtle">Choisissez un apprenant pour afficher son détail.</p>';
        return;
      }
      panel.innerHTML = '<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>Chargement…</div>';
      try {
        const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/performance`);
        panel.innerHTML = userPerformanceHTML(data);
      } catch (error) {
        errorEl.innerHTML = escapeHTML(error.message || "Impossible de charger la performance.");
        panel.innerHTML = "";
      }
    });
  }

  async function renderAdminSettings() {
    platformSection.innerHTML = adminShell("/admin/settings", "Administration", "Réglages", `<div class="skeleton skeleton-card" style="height:140px"></div><div class="skeleton skeleton-card" style="height:220px;margin-top:1.1rem"></div>`);
    try {
      const [settings, audit] = await Promise.all([api("/api/admin/settings"), api("/api/admin/audit")]);
      if (currentRoute() !== "/admin/settings") return;
      platformSection.innerHTML = adminSettingsHTML(settings, audit.logs || []);
    } catch (error) {
      platformSection.innerHTML = errorStateHTML("Impossible de charger les réglages.", error.message, renderAdminSettings);
    }
  }

  function adminSettingsHTML(settings, logs) {
    const rows = logs.length
      ? logs.map((log) => `<tr><td><span class="tag neutral">${escapeHTML(log.event)}</span></td><td>${formatDateTime(log.createdAt)}</td><td class="tiny subtle">${escapeHTML(JSON.stringify(log.details || {}))}</td></tr>`).join("")
      : '<tr><td colspan="3">Aucun événement.</td></tr>';
    return adminShell("/admin/settings", "Administration", "Réglages", `
      <div class="grid-3">
        <article class="card"><h3>${ICON("users")}Inscription publique</h3><p><span class="tag ${settings.allowPublicRegistration ? "success" : "warning"}">${settings.allowPublicRegistration ? "Activée" : "Désactivée (admin uniquement)"}</span></p><p class="small subtle">Contrôlée par ALLOW_PUBLIC_REGISTRATION dans l’environnement.</p></article>
        <article class="card"><h3>${ICON("sparkles")}Service IA</h3><p><span class="tag ${settings.aiConfigured ? "success" : "warning"}">${settings.aiConfigured ? "Configuré" : "Non configuré"}</span></p><p class="small subtle">Modèle : ${escapeHTML(settings.aiModel)}</p></article>
        <article class="card"><h3>${ICON("shield")}Base de données</h3><p><span class="tag ${settings.database === "connected" ? "success" : "warning"}">${settings.database === "connected" ? "Connectée" : "Déconnectée"}</span></p><p class="small subtle">Environnement : ${escapeHTML(settings.environment)}</p></article>
      </div>
      <div class="section-heading"><div><h2>Journal d’audit</h2></div><span class="section-note">50 derniers événements</span></div>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Événement</th><th>Date</th><th>Détails</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `);
  }

  /* --------------------------- platform interactions --------------------------- */

  function bindPlatformInteractions(route) {
    platformSection.querySelector("[data-verify-resend]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api("/api/auth/resend-verification", {
          method: "POST",
          body: { email: platform.user && platform.user.email },
        });
        notify(result.message || "Lien de vérification envoyé. Vérifiez votre boîte mail.");
      } catch (error) {
        notify(error.message || "Impossible d’envoyer le lien.");
      } finally {
        button.disabled = false;
      }
    });
    platformSection.querySelectorAll("[data-auth-form]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const kind = form.dataset.authForm;
        const errorEl = form.querySelector("[data-form-error]");
        const messageEl = form.querySelector("[data-form-message]");
        errorEl.textContent = "";
        if (messageEl) messageEl.textContent = "";
        const payload = {};
        form.querySelectorAll("input[name]").forEach((input) => { payload[input.name] = input.value; });
        submitAuthForm(kind, payload, form, errorEl, messageEl);
      });
    });
    platformSection.querySelectorAll("[data-password-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      const wrap = event.currentTarget.closest(".password-wrap");
      const input = wrap ? wrap.querySelector("input") : null;
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      event.currentTarget.textContent = show ? "Masquer" : "Afficher";
      event.currentTarget.setAttribute("aria-pressed", String(show));
    }));
    const verifyButton = platformSection.querySelector("[data-verify-submit]");
    if (verifyButton) {
      const token = new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "";
      const statusEl = platformSection.querySelector("[data-verify-status]");
      const errorEl = platformSection.querySelector("[data-verify-error]");
      const attempt = async () => {
        verifyButton.disabled = true;
        errorEl.textContent = "";
        statusEl.innerHTML = '<div class="loading-inline"><span class="spinner" aria-hidden="true"></span>Vérification en cours…</div>';
        try {
          const data = await api("/api/auth/verify-email", { method: "POST", body: { token } });
          statusEl.innerHTML = `<div class="feedback">${escapeHTML(data.message || "Votre adresse e-mail a été vérifiée.")}</div>`;
          verifyButton.remove();
          if (platform.mode === "authed") {
            platform.user = { ...platform.user, emailVerified: true };
            renderNav();
          }
        } catch (error) {
          statusEl.innerHTML = "";
          errorEl.textContent = error.message || "Impossible de vérifier l’adresse pour le moment.";
          verifyButton.disabled = false;
        }
      };
      verifyButton.addEventListener("click", attempt);
      if (token) attempt();
    }
    platformSection.querySelectorAll("[data-showcase]").forEach((tab) => tab.addEventListener("click", (event) => {
      const name = event.currentTarget.dataset.showcase;
      platformSection.querySelectorAll("[data-showcase]").forEach((other) => other.setAttribute("aria-selected", other === event.currentTarget ? "true" : "false"));
      platformSection.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    }));
    setupReveals();
  }

  let revealObserver = null;
  function setupReveals() {
    if (revealObserver) revealObserver.disconnect();
    const elements = platformSection.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("in"));
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach((element) => revealObserver.observe(element));
  }

  const AUTH_ERROR_COPY = {
    invalid_credentials: "Votre adresse e-mail ou votre mot de passe est incorrect.",
    network_error: "Impossible de contacter le service. Vérifiez votre connexion puis réessayez.",
    rate_limit: "Un trop grand nombre de tentatives a été détecté. Réessayez dans quelques instants.",
    db_unavailable: "Le service est momentanément indisponible. Réessayez dans un instant.",
    email_not_verified: "Votre adresse e-mail n’est pas encore vérifiée. Vérifiez votre boîte mail pour activer votre compte.",
  };
  const AUTH_BUTTONS = {
    login: ["Se connecter", "Connexion…"],
    register: ["Créer mon compte", "Création…"],
    forgot: ["Recevoir le lien", "Envoi…"],
    reset: ["Réinitialiser", "Réinitialisation…"],
  };

  async function submitAuthForm(kind, payload, form, errorEl, messageEl) {
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";
    const button = form.querySelector('[type="submit"]');
    const labels = AUTH_BUTTONS[kind] || ["Valider", "En cours…"];
    const originalLabel = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = labels[1];
    }
    try {
      if (kind === "login") {
        const data = await api("/api/auth/login", { method: "POST", body: { email: payload.email, password: payload.password } });
        await finishLogin(data.user);
      } else if (kind === "register") {
        const data = await api("/api/auth/register", {
          method: "POST",
          body: { firstName: payload.firstName, lastName: payload.lastName, email: payload.email, password: payload.password },
        });
        await finishLogin(data.user);
        notify(
          data.verification && !data.verification.sent
            ? "Compte créé. L’envoi de l’e-mail de vérification n’est pas configuré."
            : "Compte créé. Un e-mail de vérification vous a été envoyé."
        );
      } else if (kind === "forgot") {
        const data = await api("/api/auth/forgot-password", { method: "POST", body: { email: payload.email } });
        if (messageEl) {
          messageEl.innerHTML = `<div class="feedback">Vérifiez votre boîte mail. ${escapeHTML(data.message || "Si un compte existe avec cette adresse, un lien de réinitialisation a été envoyé.")}</div>`;
        }
        if (data.devResetUrl) {
          if (messageEl) messageEl.innerHTML += `<p class="small">Lien de développement : <a href="${escapeHTML(data.devResetUrl)}">ouvrir le lien de réinitialisation</a>.</p>`;
        }
      } else if (kind === "reset") {
        await api("/api/auth/reset-password", { method: "POST", body: { token: payload.token, password: payload.password } });
        notify("Mot de passe réinitialisé. Vous pouvez vous connecter.");
        go("/login");
      }
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message || AUTH_ERROR_COPY[error.code] || "Une erreur est survenue.";
      }
    } finally {
      if (button && button.isConnected) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = originalLabel;
      }
      delete form.dataset.submitting;
    }
  }

  async function finishLogin(user) {
    platform.user = user;
    platform.mode = "authed";
    renderNav();
    migrateLocalStateIfNeeded();
    const next = sessionStorage.getItem("bp-next-route");
    sessionStorage.removeItem("bp-next-route");
    if (next && APP_ROUTES.has(next)) {
      location.hash = next;
    } else {
      go("/app");
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch { /* even on failure, clear local auth view */ }
    platform.mode = "guest";
    platform.user = null;
    renderNav();
    go("/");
  }

  /* --------------------------- public API for app.js --------------------------- */

  window.BP_PLATFORM = {
    isAuthenticated: () => platform.mode === "authed",
    isLegacy: () => platform.mode === "legacy",
    canAccessApp,
    canAccessAdmin,
    redirectToLogin,
    go,
    notify,
    getUser: () => platform.user,

    saveCourse: async (course) => {
      if (platform.mode !== "authed") return null;
      try {
        const data = await api("/api/me/courses", { method: "POST", body: course });
        platform.courseId = data.course.id;
        return data.course.id;
      } catch { return null; }
    },

    courseId: () => platform.courseId,

    setCourseId: (id) => { platform.courseId = id || null; },

    completeLesson: async (moduleId) => {
      if (platform.mode !== "authed" || !platform.courseId) return;
      try {
        await api(`/api/me/courses/${encodeURIComponent(platform.courseId)}/modules/${encodeURIComponent(moduleId)}/complete`, { method: "POST" });
      } catch { /* best effort */ }
    },

    saveQuizResult: async (moduleId, result) => {
      if (platform.mode !== "authed" || !platform.courseId) return;
      try {
        await api(`/api/me/courses/${encodeURIComponent(platform.courseId)}/modules/${encodeURIComponent(moduleId)}/quiz`, {
          method: "POST",
          body: { assessment: result.assessment, explanation: result.explanation, keyPoint: result.keyPoint },
        });
      } catch { /* best effort */ }
    },

    saveSimulation: async (simulation) => {
      if (platform.mode !== "authed") return;
      try {
        await api("/api/me/simulations", { method: "POST", body: simulation });
      } catch { /* best effort */ }
    },
  };

  /* ------------------------------ events ------------------------------ */

  window.addEventListener("hashchange", () => {
    if (platform.booted) {
      renderNav();
      closeUserMenu();
      openMobileNav(false);
      handleRoute();
    }
  });

  if (document.readyState !== "loading") {
    boot();
  } else {
    window.addEventListener("DOMContentLoaded", boot);
  }
})();
