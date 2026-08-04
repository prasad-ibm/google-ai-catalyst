# Google AI Catalyst — Backend

Express + PostgreSQL backend for the enterprise AI use-case evaluation workflow.
Serves the 8 static HTML pages and exposes a REST API that persists the setup
profile, intake use cases, and each evaluation gate (BxT, feasibility, advisory,
summary, panel verdict).

## Stack

- Node.js >= 18, Express 4
- PostgreSQL (Railway), `pg` connection pool over SSL
- Zero external test framework — `server.test.js` uses `node:assert` + `node:http`

## Files

| File | Purpose |
|------|---------|
| `server.js` | Express app + all REST routes (exports app; auto-listens only when run directly) |
| `db.js` | `pg` Pool from `process.env.DATABASE_URL`, exports `{ pool, query }` |
| `schema.sql` | Full relational model (7 tables, `IF NOT EXISTS`, FK `ON DELETE CASCADE`) |
| `scripts/migrate.js` | Applies `schema.sql` idempotently, prints created tables |
| `server.test.js` | Live end-to-end API test (migrate → flow → cascade cleanup) |
| `assets/api-client.js` | Browser `window.GAIC_API` with localStorage fallback |
| `railway.json` / `Procfile` | Deploy config |

## Local run

```bash
cd google-ai-catalyst
npm install            # express, pg, dotenv, cors (+ jsdom dev)
cp .env.example .env   # then set DATABASE_URL (and optional PORT)
npm run migrate        # creates the 7 tables against DATABASE_URL
npm start              # serves pages + API on http://localhost:3000
```

Run the live API test suite:

```bash
node server.test.js    # or: npm run test:api
```

## Environment

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string. SSL is forced with `rejectUnauthorized:false`. |
| `PORT` | no | Defaults to `3000`. |

`DATABASE_URL` is read via `process.env` after `dotenv` loads — it is never
hardcoded.

## Railway deploy

1. Create a Postgres plugin/service in your Railway project.
2. In the app service, reference the DB: set `DATABASE_URL` to
   `${{Postgres.DATABASE_URL}}` (service reference variable).
3. Deploy. Railway uses `railway.json` → NIXPACKS builder, `npm start`, and
   health-checks `GET /api/health`.
4. Run the migration once after the first deploy (either locally against the
   public `DATABASE_URL`, or via a one-off Railway command):
   ```bash
   npm run migrate
   ```

## Data model (7 tables)

```
workspaces
  └─< use_cases                (workspace_id → workspaces.id, CASCADE)
        ├─1 bxt_scores          (use_case_id UNIQUE, CASCADE)
        ├─1 feasibility_scores  (use_case_id UNIQUE, CASCADE)
        ├─1 advisory_results    (use_case_id UNIQUE, CASCADE)
        ├─1 evaluation_summaries(use_case_id UNIQUE, CASCADE)
        └─1 panel_verdicts      (use_case_id UNIQUE, CASCADE)
```

Deleting a workspace cascades to its use cases and all gate rows.

## API

Base URL: same origin, prefix `/api`. All bodies are JSON. Replace `$WS` and
`$UC` with real UUIDs and `$BASE` with e.g. `http://localhost:3000`.

### Health

```bash
curl -s $BASE/api/health
# { "ok": true, "db": true, "version": "PostgreSQL 18.4 ..." }
```

### Workspaces

Create or upsert (accepts raw setup `{state,current}` or flat fields; include
`id` in the body to UPDATE an existing row):

```bash
curl -s -X POST $BASE/api/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"state":{"company":"Acme","size":"1000-5000","revenue":"$500M","edition":"Enterprise Plus","geminiSeats":250,"vertexApproved":true,"frameworks":["SOC2"],"priority1":"Cost","priority2":"Speed","budget":"$1M","goal":"Automate"},"current":5}'
```

List / get one:

```bash
curl -s $BASE/api/workspaces
curl -s $BASE/api/workspaces/$WS
```

### Use cases

Create (needs `workspace_id`; intake fields either pre-grouped or flat):

```bash
curl -s -X POST $BASE/api/use-cases \
  -H 'Content-Type: application/json' \
  -d '{"workspace_id":"'$WS'","name":"Invoice Reconciliation","dept":"Finance","sponsor":"CFO","submitter":"jane","email":"jane@acme.test","desc":"Match invoices to POs","driver":"Cost","value":">$5M","sources":"ERP","integrations":["BigQuery"],"pii":true}'
```

List (optionally filtered) / get one (with nested gates):

```bash
curl -s "$BASE/api/use-cases?workspace_id=$WS"
curl -s $BASE/api/use-cases/$UC
# → { ...use_case, bxt, feasibility, advisory, summary, verdict }
```

Update intake fields and/or stage:

```bash
curl -s -X PUT $BASE/api/use-cases/$UC \
  -H 'Content-Type: application/json' \
  -d '{"stage":"feasibility","desc":"Updated description"}'
```

### Gates (upsert by use case)

```bash
curl -s -X PUT $BASE/api/use-cases/$UC/bxt \
  -H 'Content-Type: application/json' \
  -d '{"business_score":8.2,"experience_score":7.5,"technology_score":6.9,"verdict":"PROCEED","detail":{"notes":"strong"}}'

curl -s -X PUT $BASE/api/use-cases/$UC/feasibility \
  -H 'Content-Type: application/json' \
  -d '{"composite":7.4,"quadrant":"Quick Win","risk_tier":"Low","citizen_dev_pct":40,"criteria":{"data":8},"pillars":{"people":6}}'

curl -s -X PUT $BASE/api/use-cases/$UC/advisory \
  -H 'Content-Type: application/json' \
  -d '{"tier":"Tier 2","verdict_name":"Advance","recommended_platform":"Vertex AI","gate_resolved":"feasibility","reasoning":{"why":"clean data"},"journey":{"steps":["pilot"]}}'

curl -s -X PUT $BASE/api/use-cases/$UC/summary \
  -H 'Content-Type: application/json' \
  -d '{"roi_p10":1.2,"roi_p50":2.5,"roi_p90":4.8,"frameworks":{"gadf":true},"governance":{"owner":"CFO"},"readiness":"Ready"}'

curl -s -X PUT $BASE/api/use-cases/$UC/verdict \
  -H 'Content-Type: application/json' \
  -d '{"verdict":"APPROVE","binding_condition":"Human-in-the-loop >$10k","stances":{"cfo":"yes"},"deliberation":{"rounds":2}}'
```

### Portfolio

```bash
curl -s "$BASE/api/portfolio?workspace_id=$WS"
# → [ { id, name, stage, feasibility_composite, verdict } ]
```

## Error responses

- `400 { "error": ... }` — missing required field (e.g. use case without `workspace_id`).
- `404 { "error": ... }` — resource not found.
- `500 { "error": ... }` — database failure (handlers are wrapped in try/catch).

## Frontend integration (optional)

`assets/api-client.js` exposes `window.GAIC_API` with `saveWorkspace`,
`getWorkspace`, `createUseCase`, `getUseCase`, `saveGate(id, gate, obj)`, and
`listPortfolio(wsId)`. Every method falls back to the existing `gaic_*`
localStorage keys on any network/API error and never throws. Add it with a
single `<script src="assets/api-client.js"></script>` — the 8 HTML pages are
otherwise untouched.
