# BP Learning: Moroccan learner frontend

BP Learning is an AI-powered training platform for pharmacy teams (synthetic Casablanca pharmacy context). Learners practise communication, customer counselling, product knowledge, objection handling, ethical selling and difficult situations with a simulated AI customer, an AI evaluator and an AI coach. The platform is multi-user: every learner has an account, a personal dashboard and persistent progress stored in MongoDB Atlas. Administrators manage users, courses, assignments and analytics.

## Run locally

```sh
npm install          # installs the MongoDB driver (and dev/test tooling)
cp .env.example .env # Windows: copy .env.example .env
# then set MONGODB_URI, SESSION_SECRET and DEEPSEEK_API_KEY in .env
npm start            # or: node start.js
```

Open `http://127.0.0.1:8089/`. Requires Node 18.17 or newer (built-in `fetch`).

- `MONGODB_URI` is the MongoDB Atlas connection string (use a database user with only the rights the application needs — CRUD on the application database, no cluster admin).
- `SESSION_SECRET` is required in production. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `DEEPSEEK_API_KEY` is only needed for the AI modes. It stays server-side and is never sent to the browser or written to logs.
- Without `MONGODB_URI` the server still starts in a degraded *legacy* mode: the AI training works anonymously and authentication endpoints return `503 db_unavailable`. Nothing is persisted.

### First admin account

```sh
npm run seed
```

creates a development admin (`admin@bp-learning.local` by default) and prints a one-time random password. The script refuses to run when `NODE_ENV=production`, and is idempotent (re-running does not reset the password).

Alternatively, list an e-mail in `ADMIN_EMAILS` in `.env`: the first time that address self-registers it receives the `admin` role.

## Architecture

```
public/               browser assets only (served as-is on Vercel, never server source)
  index.html          document shell, CSP, route containers
  platform.js         landing page, auth flows, dashboard, profile, admin UI, route guards
  app.js              learning app (personal course, lessons, tutor, simulations, progress)
  fixtures.js         synthetic guided-training content
  styles.css          design system (purple brand, cards, forms, tables)
api/index.js          Vercel serverless entry (re-exports the node server request handler)
start.js              local entry point (env loading + startup; renamed from server.js so
                      Vercel treats projects as functions rather than a captured server)
vercel.json           build configuration (install, functions, /api rewrites, headers)
server/
  app.js              request handler (static files, security headers, CSRF origin check)
  api-router.js       route table with explicit auth requirements per endpoint
  config.js           environment configuration
  db.js               MongoDB connection + indexes
  store.js            data access (users, sessions, courses, assignments, progress…)
  auth.js             scrypt password hashing, server-side sessions, cookies
  middleware.js       requireAuth / requireRole
  routes-auth.js      register, login, logout, forgot/reset password
  routes-me.js        profile, dashboard, courses, progress, simulations, migration
  routes-admin.js     users, courses, assignments, performance, audit, settings
  routes-ai.js        existing AI endpoints (customer, evaluator, tutor, TTS…)
  validation.js       input validation and sanitisation
  rate-limit.js       fixed-window rate limiting (MongoDB-backed on Vercel, in-memory locally)
  email.js            e-mail abstraction (console in dev, HTTP transport hook)
scripts/seed.js       development admin seeding
test/                 node:test suite (integration tests against a real in-memory MongoDB)
```

## Authentication

- **Passwords**: hashed with `crypto.scrypt` (N=16384, r=8, p=1, per-user random salt, timing-safe compare). Never logged, never returned by APIs, never stored in the frontend.
- **Sessions**: server-managed sessions stored in MongoDB (`sessions` collection, TTL index). The browser only receives an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie containing a 256-bit random token; the database stores only its SHA-256 hash. 7-day lifetime with sliding renewal.
- **Password reset**: single-use random token (stored hashed, 60-minute expiry), delivered through the `server/email.js` abstraction. In development the reset link is returned in the API response (clearly marked) so the flow is testable without an SMTP provider; in production delivery is required.
- **CSRF**: state-changing requests must be same-origin (Origin header check) in addition to `SameSite=Lax`.
- **Rate limiting**: fixed-window limits per IP (and per e-mail for login) on login, registration, forgot- and reset-password. The counters use a shared MongoDB store automatically when running on Vercel (or when `RATE_LIMIT_STORE=mongodb` is set); otherwise they fall back to in-memory (fine for a single process).

## Authorization

Every protected endpoint declares its requirement in `server/api-router.js`:

| Guard | Meaning |
|---|---|
| `none` | public (health, scenarios, auth config) |
| `optional` | legacy anonymous access only when the database is down, otherwise authentication required |
| `user` | `requireAuth()` — any active session |
| `admin` | `requireRole("admin")` — server-side role check |

A normal user cannot read another user's data (all queries are scoped by the session user; cross-user course/simulation writes are rejected with 403) and cannot call admin APIs. Frontend hiding is cosmetic only; the server enforces everything.

## MongoDB collections

`users`, `sessions`, `passwordResetTokens`, `courses`, `lessons`, `courseAssignments`, `lessonProgress`, `simulationSessions`, `evaluations`, `auditLogs`, `rateLimits`

Indexes include unique `users.email`, unique `(courseAssignments.userId, courseId)`, unique `(lessonProgress.userId, courseId, moduleId)`, plus user/course lookup indexes and TTL indexes for sessions and reset tokens.

Conversation transcripts (simulation messages) are stored per user in `simulationSessions` and are only readable by their owner. Retention strategy: sessions are immutable once stored; an operator can trim them directly in MongoDB (e.g., a TTL index can be added on `createdAt` if a retention policy is decided).

## API overview

```text
POST /api/auth/register            POST /api/auth/login
POST /api/auth/logout              POST /api/auth/forgot-password
POST /api/auth/reset-password      GET  /api/auth/config

GET  /api/me                       PATCH /api/me
PUT  /api/me/password
GET  /api/me/dashboard             GET /api/me/courses
GET  /api/me/progress              GET /api/me/simulations
POST /api/me/courses               POST /api/me/simulations
POST /api/me/migrate               POST /api/me/courses/:id/modules/:mid/complete
POST /api/me/courses/:id/modules/:mid/quiz

GET  /api/admin/stats              GET/POST /api/admin/users
PATCH /api/admin/users/:id         POST /api/admin/users/:id/reset-access
GET  /api/admin/users/:id/performance
GET/POST /api/admin/courses        POST /api/admin/courses/generate
PATCH /api/admin/courses/:id       POST /api/admin/courses/:id/publish
POST /api/admin/courses/:id/archive
GET/POST /api/admin/assignments    DELETE /api/admin/assignments/:id
GET  /api/admin/audit              GET /api/admin/settings

POST /api/customer  POST /api/evaluate        POST /api/course/generate
POST /api/lesson/generate  POST /api/tutor    POST /api/exercise/evaluate
POST /api/tts       GET  /api/scenarios       GET /api/health
```

Errors use a consistent shape: `{ "error": { "code": "UNAUTHORIZED", "message": "Authentification requise." } }`. Stack traces never reach the client.

## Frontend routes

```text
/                     landing page (public)
/login  /register  /forgot-password  /reset-password
/app                  user dashboard        /profile
#parcours  #formations  #simulations  #progression  #lecon  #ia …   (learning app, authenticated)
/admin                admin dashboard
/admin/users  /admin/courses  /admin/assignments  /admin/performance  /admin/settings
```

Unauthenticated users are redirected to `/login` when opening an app route; non-admins get a 403 page on `/admin`. The anonymous learning state in `localStorage` is migrated to the server account after the first login (`POST /api/me/migrate`), then MongoDB becomes the authoritative store; `localStorage` is kept only as temporary UI state.

## Admin workflows

- **Users**: create by invitation (the user receives a password-reset link; the admin never stores a password), activate/disable, change role, reset access, per-user performance. The last active admin cannot be disabled or demoted; an admin cannot disable their own account.
- **Courses**: AI-generated drafts go through review: draft → admin edits → publish → assign. Learners never see drafts; users cannot modify admin-owned courses.
- **Assignments**: to one user, a list of users, or all users, with optional deadline (no deadline is invented when none is defined).
- **Analytics**: totals, active users, average progress, simulations, evaluations and weak criteria aggregated from real evaluation data; per-user breakdown with recommended next training.
- **Audit**: `USER_CREATED`, `USER_DISABLED`, `ROLE_CHANGED`, `COURSE_PUBLISHED`, `COURSE_ASSIGNED`, `COURSE_UNASSIGNED`, `PASSWORD_RESET`… (no secrets ever logged).

## Tests

```sh
npm test
```

120+ tests across authentication, authorization, security, MongoDB, rate limiting, degraded mode and DOM-level frontend flows (landing, auth, dashboard, learning path, lesson environment, coach, exercises, simulation, result screen, progress, catalog, admin). The suite boots a real MongoDB (mongodb-memory-server) per file, so no external database is required.

## Known limitations

- Speech synthesis (TTS `/api/tts`) requires the optional Python FastAPI service in `tts/`, which does not run on Vercel. Point `TTS_SERVICE_URL` at a hosted instance (or any compatible endpoint); without it the endpoint returns 503 and the UI shows a clear recovery panel.
- Password-reset e-mail delivery uses a console/HTTP abstraction; wire a real provider (or SMTP service) for production.
- `ALLOW_PUBLIC_REGISTRATION` defaults to `true` for development convenience; set it to `false` in production for admin-controlled onboarding.
- `npm run seed` must never be used against a production database (it refuses to run when `NODE_ENV=production`).

## Learning journey

### Parcours personnalisé (IA)

1. **Tableau de bord** — describe your objective; the AI coach builds a personalized course (real DeepSeek, structured JSON).
2. **Mon parcours** — open a module to generate a lesson (concept, example, key points, question) with a **Coach IA** alongside.
3. Answer the lesson's question for immediate AI feedback.
4. **Simulations** — practice with the AI customer (4 replies, AI evaluation, targeted retry).
5. The evaluation recommends your next lesson; everything is saved to your account.

### Entraînement guidé (sans IA)

1. Open the overview and begin the training.
2. Complete the three preparation checks.
3. Work through a three-step conversation about language preference and comprehension.
4. Review the conversation result.
5. Complete three short learning checks.
6. Inspect the learning path, reload to continue later, or reset progress.

All learner, customer and dialogue details are synthetic. The exercise develops communication habits and does not provide health advice. AI-generated course content is training material, not authoritative medical or product information.

## Files

- `index.html`: French document shell and routes (lives in `public/`).
- `styles.css`: design system — tokens, typography, layout, states, responsive (lives in `public/`).
- `icons.js`: lightweight inline SVG icon set (no external dependencies, lives in `public/`).
- `fixtures.js`: synthetic learner, customer, dialogue and quiz content (lives in `public/`).
- `platform.js`: landing page, authentication, dashboard, profile and admin UI (lives in `public/`).
- `app.js`: learning flows — parcours, leçons, coach IA, exercices, simulations, progression (lives in `public/`).
- `start.js`: local entry point.
- `api/index.js`: Vercel serverless entry (re-exports the node server request handler).
- `vercel.json`: Vercel build configuration. `.vercelignore`: files never deployed (`.env`, `tts/`, `test/`, scripts…).
- `server/`: configuration, database, auth, routes and AI integrations (never served to the browser).
- `.env.example`: variable names only; copy to `.env` and add your own values.
- `scripts/seed.js`: development admin seeding.
- `test/`: automated test suite (backend + DOM-level frontend tests).
- `PROVENANCE.md`: concise origin and content note.
- `CHALLENGE.md`: participant challenge brief.

## Deploy on Vercel

The project is zero-config ready for Vercel: the browser assets live in `public/` (served statically) and all API traffic goes through the single serverless function in `api/`. Log in with the Vercel CLI (`vercel`) or import the repository in the dashboard — the presets in `vercel.json` do the rest.

1. **Project settings (if not using `vercel.json`)**: Framework preset `Other` (no build command, output `public/`), install command `npm install --omit=dev`.
2. **Environment variables** (Project → Settings → Environment Variables):
   - `MONGODB_URI` — Atlas connection string (the same value used locally; use a scoped database user).
   - `SESSION_SECRET` — required in production; the function refuses to start without it. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `DEEPSEEK_API_KEY` — only needed for the AI modes (coach, tutor, simulations, course generation).
   - `APP_BASE_URL` — your production origin, e.g. `https://your-app.vercel.app` (used for absolute URLs in e-mails).
   - `TTS_SERVICE_URL` — optional; the URL of a hosted TTS endpoint if you need `/api/tts` (the local Python service in `tts/` cannot run on Vercel).
   - `EMAIL_TRANSPORT` (`smtp` or `http`) plus your provider variables — optional; defaults to console in development.
   - `ALLOW_PUBLIC_REGISTRATION=false` — recommended for real deployments.
3. **Postgres/Redis not required** — sessions, users and shared rate-limiting counters all live in MongoDB.

Notes:

- Routing is handled by the `rewrites` in `vercel.json`: `/api/*` is forwarded to the serverless function with the original path preserved (the function uses a `request.path` transform), and everything else is served from `public/`. The frontend only uses hash routes, so no SPA fallback is needed.
- Because the Vercel function is stateless, rate-limit counters move into MongoDB automatically (a `rateLimits` collection with a TTL index). TTS audio caching uses the `TTS_CACHE_DIR` env var (temporary storage on Vercel).
- `.vercelignore` excludes secrets (`.env`), the local TTS service, the test suite, scripts and documentation, so only `public/` is on the public origin and no server source is exposed.
