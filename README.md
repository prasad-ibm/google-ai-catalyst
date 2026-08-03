# Google AI Catalyst

![CI](https://github.com/prasad-ibm/google-ai-catalyst/actions/workflows/ci.yml/badge.svg)

An enterprise **AI use-case investment evaluation platform**. It takes an AI idea
from first submission through a disciplined **6-gate pipeline** to an investment
verdict and executive brief, scoring each use case against published decision
frameworks (Google AI Decision Framework, Google Cloud Adoption Framework,
McKinsey × MIT Sloan, Gartner) using the organisation's own context.

> Google-branded reskin of the AI Catalyst concept. All cloud/AI references map to
> Google Cloud products — Vertex AI, Gemini, Agentspace, AppSheet, BigQuery.

## Features

- **Enterprise onboarding** — 7-step workspace setup wizard with a live "AI Context
  Preview" sidebar (organisation, tech stack, Google Workspace, IT capability,
  compliance, AI strategy, documents).
- **Use-case onboarding** — 5-tab intake wizard with a live "AI Score Estimate"
  sidebar (quadrant, criterion bars, citizen-dev suitability, recommended platform).
- **6-gate evaluation pipeline:**
  1. **Intake** — capture the use case
  2. **BXT Gate** — Business × Experience × Technology pre-filter
  3. **Feasibility Scoring** — 10 weighted criteria across 3 pillars → composite/quadrant
  4. **Platform Advisory** — Google AI Decision Framework: Adopt → Extend → Build ladder
  5. **Evaluation Summary** — Monte Carlo ROI (P10/P50/P90), framework rollup, governance checklist
  6. **Executive Review Panel** — 4-persona deliberation → GO / CONDITIONAL GO / NO-GO + executive brief
- **Authentication** — session-based login, credentials + sessions stored in Postgres
  (scrypt-hashed passwords, no plaintext).
- **Full persistence** — Express + PostgreSQL backend; every page falls back to
  `localStorage` when offline so the UI never blocks.

## Stack

- **Frontend:** static HTML/CSS/JS, Google design system (`assets/theme.css`),
  Roboto / Roboto Mono, dark theme. No build step.
- **Backend:** Node.js ≥ 18, Express 4, PostgreSQL via `pg` (SSL).
- **Auth:** Node built-in `crypto` (scrypt) + signed session cookies, sessions in Postgres.
- **Tests:** `node --test` — 8 suites, no external test framework.

## Quick start

```bash
git clone <your-repo-url> google-ai-catalyst
cd google-ai-catalyst
npm install

cp .env.example .env         # then set DATABASE_URL + SESSION_SECRET
npm run migrate              # creates all tables against DATABASE_URL
npm start                    # serves pages + API on http://localhost:3000
```

Open `http://localhost:3000` and sign in. A default sandbox user is seeded on
first boot:

```
username: sandboxuser
password: IntelUser1!
```

## Seed demo data (optional)

Seeds an **Intel** enterprise plus 5 use cases fully populated across all 5
evaluation modules (BXT → Feasibility → Advisory → Summary → Verdict):

```bash
node scripts/seed-intel.js
```

## Project layout

```
├── index.html            Landing page
├── login.html            Sign-in page
├── setup.html            Enterprise onboarding (7-step wizard)
├── intake.html           Use-case onboarding (5-tab wizard)
├── bxt.html              Gate 2 — BXT
├── feasibility.html      Gate 3 — Feasibility scoring
├── advisory.html         Gate 4 — Platform advisory (GADF)
├── summary.html          Gate 5 — Evaluation summary (Monte Carlo ROI)
├── panel.html            Gate 6 — Executive review panel
├── assets/
│   ├── theme.css         Google design system
│   └── api-client.js     window.GAIC_API (API + localStorage fallback)
├── server.js             Express app + REST API + page/API auth gating
├── auth.js               Scrypt auth, session store, seed, guards
├── db.js                 pg Pool from DATABASE_URL
├── schema.sql            Relational model (7 domain tables)
├── scripts/
│   ├── migrate.js        Apply schema.sql idempotently
│   ├── seed-intel.js     Seed Intel workspace + 5 use cases
│   └── dbcheck.js        Connectivity check
├── *.test.js             node --test suites (8)
├── railway.json          Railway deploy config
└── Procfile              Process definition
```

## Data model

```
users                          (auth)
sessions                       (auth, signed cookie → row)

workspaces                     enterprise profile (7-step setup)
  └─< use_cases                intake (5-tab), stage tracker
        ├─1 bxt_scores         Gate 2
        ├─1 feasibility_scores Gate 3
        ├─1 advisory_results   Gate 4
        ├─1 evaluation_summaries Gate 5
        └─1 panel_verdicts     Gate 6
```

Each gate is a 1:1 upsert per use case (UNIQUE FK). Deleting a workspace cascades
to its use cases and all gate rows. Typed columns back dashboard queries; `jsonb`
columns hold rich nested structures (criteria arrays, deliberation transcripts).

See [`README-backend.md`](./README-backend.md) for the full REST API reference.

## Environment

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string. SSL forced. On Railway use `${{ Postgres.DATABASE_URL }}`. |
| `SESSION_SECRET` | prod | Signs session cookies. Generate a long random string. |
| `PORT` | no | Defaults to 3000. Railway injects its own. |

`.env` is git-ignored — secrets are never committed.

## Deploy to Railway

1. Create a **Postgres** service in your Railway project.
2. In the app service, set `DATABASE_URL=${{ Postgres.DATABASE_URL }}` and a
   `SESSION_SECRET`.
3. Deploy — Railway uses `railway.json` (NIXPACKS, `npm start`, health-check
   `GET /api/health`).
4. Deploy. **No manual migration needed** — on boot the server applies
   `schema.sql` (idempotent) and seeds the `sandboxuser` login automatically, so a
   fresh database self-provisions. (`npm run migrate` is still available for
   local/manual use.)

See [DEPLOY.md](./DEPLOY.md) for the full Railway walkthrough.

## Tests

```bash
node --test *.test.js
```

The `server.test.js` suite runs live against `DATABASE_URL` (migrate → auth →
full pipeline round-trip → cascade cleanup).

## License

MIT — see [LICENSE](./LICENSE).
