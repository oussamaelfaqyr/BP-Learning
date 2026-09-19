# Project Overview

Static, client-only French-language learning frontend ("BP Learning") for a synthetic Casablanca pharmacy context. Learners practise asking for a language preference, explaining one step at a time, checking comprehension and tracking progress. No build step, package dependencies, backend, account or API key. Entry point is `index.html`.

# Architecture

Single-page application using hash-based routing, rendered entirely in the browser. Three layers:

- `index.html` — document shell, CSP meta tag, header nav, five empty `<section data-view>` route containers.
- `fixtures.js` — frozen synthetic content exposed as `window.BP_FIXTURES`.
- `app.js` — IIFE holding all state, rendering and event handling; reads `window.BP_FIXTURES`.
- `styles.css` — all styling, responsive breakpoints and print rules.

No framework, bundler or server code. State persists only in `localStorage`.

# Directory Structure

```
bp-learning-morocco-frontend-candidate/
├── index.html            # HTML shell, CSP, route containers
├── styles.css            # All styles (responsive + print)
├── fixtures.js           # Synthetic course/learner/dialogue/quiz data
├── app.js                # Router, state, renderers, interactions
├── package-lock.json     # Empty lockfile (no dependencies)
├── README.md             # Overview and run instructions
├── CHALLENGE.md          # Participant challenge brief (tracks A1-A3)
├── PROVENANCE.md         # Content origin note
└── FILE-MANIFEST.sha256  # SHA-256 hashes of packaged files
```

# Frontend

- Router: `ROUTES` set and `routeFromHash()` in `app.js:5`, `app.js:57`; hashchange listener at `app.js:210`.
- View renderers: `renderStart` (`app.js:73`), `renderPreparation` (`app.js:106`), `renderSimulation` (`app.js:118`), `renderCompletion` (`app.js:135`), `renderModule` (`app.js:145`), `renderPlan` (`app.js:155`); dispatch map at `app.js:161`.
- Central `render()` toggles `[data-view]` sections and rebinds events (`app.js:163`).
- Interaction bindings: `bindInteractions()` (`app.js:180`) — prep checkboxes, dialogue choices, quiz answers, reset buttons, route buttons.
- Progress calculation: `progress()` (`app.js:62`) — equal weighting of prep, dialogue and quiz.
- HTML escaping helper `escapeHTML()` (`app.js:40`).
- Route containers in `index.html:40-44`; nav links use `data-route` (`index.html:27-32`).
- Accessibility: skip link (`index.html:18`), `aria-current` nav state (`app.js:170`), focus management (`app.js:172`), `role="status"` toast (`index.html:47`), `prefers-reduced-motion` and print styles (`styles.css:328`, `styles.css:332`).
- Responsive breakpoints at `styles.css:305` (820px) and `styles.css:316` (520px).

# Backend

None. There is no server-side code, API layer or network calls. CSP explicitly sets `connect-src 'none'` (`index.html:8`).

# Database

None. The only persistence is browser `localStorage` under key `bp-historic-frontend-morocco-fr-v1` (`app.js:6`). State shape is `{ prep, dialogueStep, dialogueAnswers, quizAnswers }` (`app.js:7-12`). `loadState()` validates and sanitises stored data against fixtures (`app.js:14`); `save()` serialises it (`app.js:46`). Reset is handled at `app.js:205`.

# Authentication

None. There is no login, session or user identity. The header shows a static synthetic profile button ("Nadia A. · profil fictif") in `index.html:33-36`; the learner profile is fixture data in `fixtures.js:2`.

# External Services

None. No analytics, CDN, fonts, APIs or third-party scripts. Fonts fall back to system fonts (`styles.css:26`). Favicon is inlined as `data:,` (`index.html:12`). Content Security Policy in `index.html:6-9` restricts all sources to `'self'`.

# AI/ML

None. All content is deterministic synthetic fixture data in `fixtures.js`; scoring is arithmetic over fixed answers (`app.js:137`). No model, inference or dynamic generation.

# Main User Flows

1. **Overview** — `renderStart` (`app.js:73`); primary CTA routes to preparation or simulation depending on prep completion (`app.js:85`).
2. **Preparation** — three checkboxes in `renderPreparation` (`app.js:106`); "Démarrer la simulation" stays disabled until all three are checked (`app.js:112`).
3. **Simulation** — three-turn dialogue in `renderSimulation` (`app.js:118`); each choice stores an answer, advances the step and shows feedback via toast (`app.js:191-197`). Content from `fixtures.js:33-67`.
4. **Result** — `renderCompletion` (`app.js:135`) shows score ring and three quiz modules; quiz answers lock after selection (`app.js:201`, `app.js:151`).
5. **Learning path** — `renderPlan` (`app.js:155`) shows timeline, global progress and a reset-all button.
6. **Persistence** — progress survives reload via `loadState` (`app.js:14`); dialogue-only reset at `app.js:198`.

# Important Files

- `index.html` — shell, CSP, route containers, nav, toast.
- `app.js` — all application logic (state, router, renderers, interactions).
- `fixtures.js` — all synthetic content and correct answers.
- `styles.css` — layout, responsive and print rules.
- `README.md`, `CHALLENGE.md`, `PROVENANCE.md` — documentation and challenge context.
- `FILE-MANIFEST.sha256` — integrity hashes for packaged files.

# Run/Test/Lint Commands

- Run: `python3 -m http.server 8089`, then open `http://127.0.0.1:8089/` (`README.md:9`).
- Test: none defined (no test framework or script).
- Lint: none defined (no linter config or npm scripts).
- Install: none required; `package-lock.json` declares no dependencies.

# Known Risks / Fragile Areas

- **No automated tests or linting** — regressions must be caught manually.
- **`localStorage` only** — progress is lost on clear/private mode; `save()` (`app.js:46`) has no error handling for quota/disabled storage.
- **Stored-state validation is partial** — `loadState()` (`app.js:14`) validates IDs and answer ranges but does not guard against future fixture schema changes.
- **Inconsistent route naming** — routes mix German and French (`vorbereitung`, `abschluss`, `lernplan` in `app.js:5`), a maintenance/readability hazard.
- **InnerHTML rendering** — renderers inject strings; fixture values are escaped in most places but raw values like `DATA.course.duration`/`level` and module metadata are interpolated unescaped (`app.js:83`, `app.js:147`). Safe only while fixtures stay trusted.
- **`FILE-MANIFEST.sha256`** will fail integrity checks once any tracked source file is edited.
- **Score ring CSS** only styles `score-33`, `score-67`, `score-100` (`styles.css:285-287`); other percentages render without the conic fill.
- **Single large IIFE** in `app.js` couples state, rendering and events, making isolated changes harder to verify.
