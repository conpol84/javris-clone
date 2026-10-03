# Firbo AI — technical handover (read this first)

Written for a developer who has never seen the project. Everything below was checked against the live systems on 2026-10-03.
Secrets are never written here: only their *names*.

## 1. What the product is
Firbo AI turns an AI team into a company: a signed-in user owns one or more **companies**; each company has **AI employees (agents)** with roles, budgets and approval rules, tasks, missions, shifts, memory, integrations and a billing plan. The CEO agent can be talked to by voice.
Parts: **web app** (Vercel) → **Supabase** (login, database, Edge Functions) → **AI gateway** (Hostinger VPS, OmniRoute) → AI providers.

## 2. Where everything lives
| Part | Where | Notes |
|---|---|---|
| Source code | GitHub `conpol84/javris-clone` (private) | Working branch **`claude/omniroute-engine`** (92 commits). `main` is still the old OpenJarvis upstream state. |
| Web app | Vercel project `prj_tNGCKDtXfH6ohh9i4UbqPkL53KJa` (team `team_MeaZI1Z6JWuUXbVh6DIbedLn`), domain **firboai.app** | Vite + React 19 SPA, root dir `frontend/`. Production is deployed **manually from a commit SHA** of the branch above (not auto from `main`). |
| Database + login + functions | Supabase project **`bfeinnsorgjycivozcau`** (URL `https://bfeinnsorgjycivozcau.supabase.co`) | Postgres, Auth, Realtime, 12 Edge Functions, pg_cron. |
| AI gateway | Hostinger VPS, Docker: OmniRoute + Firbo API + Caddy | `gateway.firboai.app`, `api.firboai.app`. Code in `deploy/hostinger/`. |
| Payments | Stripe (functions `billing`, `stripe-webhook`) | Keys not yet supplied in production. |

## 3. Repository map
- `frontend/` — the web app. `src/pages/*` screens, `src/components/scenes/*` 3D (three.js / react-three-fiber), `src/components/command/*` Talk console, HUD windows, bottom bar, `src/lib/company/*` all data access (one file per topic), `src/i18n/locales/*.ts` 8 languages, `src/styles/firbo.css` the design system (`.fb-root`), `public/models/*` the head scan and body point cloud (credits in `public/CREDITS.txt`).
- `supabase/migrations/` — SQL history (**incomplete, see section 5**). `supabase/functions/<name>/index.ts` — Edge Functions.
- `deploy/hostinger/` — server stack and scripts (`README.md` is the full server guide).
- `src/`, `rust/`, `desktop/`, `docs/` outside the files above — original OpenJarvis (Python backend/desktop), kept; only partly used.
- `docs/FIRBO-STATUS-AND-PLAN.md` — product plan and status. This file — technical truth.

## 4. Run and check the web app locally
```bash
cd frontend
npm install
cp ../deploy/hostinger/.env.example /dev/null   # (no frontend .env example: create frontend/.env.local as below)
# frontend/.env.local
VITE_COMPANY_SUPABASE_URL=https://bfeinnsorgjycivozcau.supabase.co
VITE_COMPANY_SUPABASE_PUBLISHABLE_KEY=<publishable key from Supabase → Project settings → API>
VITE_API_URL=https://api.firboai.app          # optional
VITE_OMNIROUTE_URL=https://gateway.firboai.app # optional
npm run dev            # http://localhost:5173
npx tsc -b             # type check (must print nothing)
npx vitest run         # 196 tests, must all pass
npm run build:tauri    # production build check
```
**Preview without an account:** `npm run preview:mock` serves the real app on http://localhost:5200 against `frontend/preview/mock-client.ts` (fake Supabase with sample data); add `?guest=1` to see the public landing page. Use it to review any signed-in screen visually.
Without the two `VITE_COMPANY_*` variables the app falls back to the legacy single-user OpenJarvis mode (no login) — if you see the old UI, that is why.
Rules the tests enforce: every locale has the same keys and placeholders; no locale text may contain the old product name.

## 5. Database (Supabase)
**Tables (public, all with RLS on):** organizations, profiles, organization_members, agents, agent_tools, model_routes, conversations, messages, memories, knowledge_sources, knowledge_chunks, tasks, approvals, workflows, workflow_steps, usage_events, audit_log, integrations, integration_secrets, platform_admins, cron_secrets, shifts, plans, integration_votes, connector_devices, connector_secrets, connector_jobs. Extensions: pgcrypto, uuid-ossp, vector, pg_cron, pg_net, supabase_vault.
Counts today: 1 company, 10 agents, 87 tool rows — it is effectively a one-customer system.
**Multi-tenancy:** every row carries `organization_id`; RLS policies (69) check membership/role through helper functions. Roles: owner, admin, manager, member, viewer. Never query another company's rows with the service key from the browser — only Edge Functions use the service key.
**Secret tables** (`integration_secrets`, `connector_secrets`, `cron_secrets`) have RLS on and **no policies on purpose**: no client can read them; only Edge Functions (service role) do.
**Business rules in the database (not the UI):**
- Plans live in `plans.limits` JSON. Free = 2 agents, 1 shift, 2 members, 25 memories, 25 daily runs, 2 integrations. Triggers raise `plan_limit:<key>`; the UI turns that into an upgrade prompt.
- `hire_agent` blocks premium agent templates on the free plan (`plan_limit:premium_agent`).
- Audit triggers write `audit_log` for agent/member changes. Setting `firbo.seeding = on` (transaction-local) silences them (used for seeding and company deletion).
- `delete_organization(p_org)` — owner only, refuses if a Stripe subscription exists.
- `pg_cron` job 1 runs every minute and calls the `shift-runner` Edge Function with a secret from `cron_secrets`.
**Migration drift — fix this first.** The repo has 9 migration files (`20261001000001…09`). The live database has **28** applied migrations (names in Supabase → Database → Migrations: e.g. `platform_admins`, `shifts_*`, `plans_billing_limits`, `connector_devices_jobs`, `agents_persona`, `free_plan_two_agents_premium_agents`, `seed_two_default_agents`, `integrations_more_kinds`…). Those live ones were applied through tooling and were never saved as files. `20261003000001_catchup_manual_changes.sql` captures the hand-made changes from the last days only. **To get a faithful baseline:** install the Supabase CLI, `supabase link --project-ref bfeinnsorgjycivozcau`, `supabase db pull`, and commit the result. Until then the repo cannot rebuild the database from scratch.
**Advisor findings (security) to fix:** (a) `get_plan_usage` is callable by anonymous users (revoke from `anon`); (b) 6 SECURITY DEFINER functions are executable by signed-in users — intended for most (they check roles inside) but review `list_members`, `add_member_by_email`, `is_platform_admin`; (c) Auth "leaked password protection" is off — enable in Auth settings.

## 6. Edge Functions (`supabase/functions`)
| Function | JWT check | Purpose |
|---|---|---|
| agent-runner | yes | Runs an agent turn/task through the gateway, tools (memory, web search/read, spawn, queue approval), budgets, usage metering |
| agent-chat | yes | Persistent chat with an agent |
| mission-runner | yes | CEO plans a mission and hands steps to agents |
| shift-runner | **no** (own secret from cron) | Executes scheduled shifts |
| agent-speak | yes | Text → speech (OpenAI TTS) |
| agent-listen | yes | Recorded voice → text (OpenAI/gateway transcription) |
| integrations | **no** (own auth + public OAuth callback) | Connect/test/send for ~60 apps, OAuth sign-in apps, read-only data apps (`snapshot`) |
| mcp | yes | Connect remote MCP servers, list and call their tools |
| billing | yes | Stripe checkout/portal |
| stripe-webhook | no (verifies Stripe signature) | Plan changes from Stripe |
| connector | no (device token) | "Firbo Connector": pair a computer and run safe local jobs |
| admin-overview | yes | Platform-admin numbers |
**Secrets (names only; set in Supabase → Edge Functions → Secrets):** `OPENAI_API_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_DEFAULT`, `LLM_FALLBACK`, `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `RUN_ALLOWED_EMAILS` (who may spend AI credits), `ORG_DAILY_RUN_LIMIT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`, `OAUTH_STATE_SECRET`, and per OAuth app `GOOGLE_/MICROSOFT_/LINKEDIN_/DROPBOX_CLIENT_ID` + `_CLIENT_SECRET`.
**Deploying a function:** there is no CI. Functions were deployed with the Supabase MCP tool / dashboard from the file in this repo. With the CLI: `supabase functions deploy <name> [--no-verify-jwt]`. **The repo file and the live function can differ if someone edits in the dashboard — compare before changing.**

## 7. Hostinger server (`deploy/hostinger`)
Docker Compose with three services: **omniroute** (AI gateway + dashboard, data in `deploy/hostinger/data/omniroute`, runs as uid 1000), **firbo-api** (small API for gateway status + legacy chat), **caddy** (HTTPS for both domains; only ports 22/80/443 open).
Files: `setup.sh` (installs Docker, firewall, creates `.env` with random secrets), `docker-compose.yml`, `Caddyfile`, `setup-gateway.sh` (tests the two OmniRoute keys, creates combos `firbo-economy` and `firbo-quality`), `set-gateway-keys.sh`, `repair.sh` (fixes data-folder ownership, reports whether the gateway can save), `finish.sh`.
`.env` variables (names): API_DOMAIN, GATEWAY_DOMAIN, FRONTEND_ORIGINS, OPENJARVIS_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, OMNIROUTE_IMAGE, OMNIROUTE_TAG, JWT_SECRET, API_KEY_SECRET, STORAGE_ENCRYPTION_KEY, MACHINE_ID_SALT, INITIAL_PASSWORD, OMNIROUTE_API_KEY (inference key), OMNIROUTE_MANAGEMENT_KEY (needs *manage* scope).
The branded gateway image is built by a GitHub workflow in the OmniRoute fork (needs a large build memory; one run failed with out-of-memory until a 12 GB build argument was set).
**Everyday commands on the server** (`cd ~/javris-clone/deploy/hostinger`):
`git pull` · `docker compose up -d --build` · `docker compose ps` · `docker compose logs -f omniroute` · `./repair.sh` · `./setup-gateway.sh`.
**Backups:** `deploy/hostinger/data/` and `.env` (not in git). There is no automatic backup yet beyond optional Hostinger snapshots.
**Known history worth knowing:** providers were lost on restart because the data folder was not writable by uid 1000 (fixed by `repair.sh`); gateway keys were once pasted in a chat → **rotate them** (OmniRoute dashboard → API Keys → create new, update `.env` and the Supabase secrets).

## 8. How a request flows
1. User signs in (Supabase Auth) → browser holds a user JWT.
2. Browser talks to Supabase directly for reads/writes (RLS protects it) and calls Edge Functions for anything that needs secrets.
3. `agent-runner` reads the agent, builds the prompt, calls `OMNIROUTE_BASE_URL/v1/chat/completions` (or OpenAI directly as fallback), records `usage_events`, may create `approvals` for risky actions.
4. Approved actions are delivered through `integrations` (e.g. send an email).
5. Voice: browser records the microphone → `agent-listen` → text → `agent-chat`/runner → `agent-speak` → audio.

## 9. Deploying
1. `cd frontend && npx tsc -b && npx vitest run && npm run build:tauri` — all clean.
2. Commit and push to `claude/omniroute-engine`.
3. Vercel → deploy that commit to Production (dashboard "Redeploy from commit", or the Vercel API with `gitSource {type github, org conpol84, repo javris-clone, ref <branch>, sha <full 40-char sha>}`).
4. Edge Function or SQL changes: apply to Supabase **and** commit the same change to the repo (migration file / function file) — this was not done consistently before (section 5).
5. Users with the PWA may need a hard refresh (Ctrl+Shift+R) once.

## 10. Honest status (what is NOT verified or not done)
- Almost nothing was verified **with a real signed-in browser session and a real microphone** by the author; visuals were checked in a headless test renderer.
- **Voice input** has been unreliable for the owner; the Talk console has a "Voice diagnostics" log — read it first. Needs a real-microphone test and a look at the `agent-listen` logs.
- Redesign status: CEO page/Talk, Command Center hero and all AI-employee figures are the new holographic style. **3D Office rooms, Landing page and the 2D screens (Tasks, Inbox, Analytics, Billing, Store, Settings) still need a real design pass.**
- The ~20 newly added integrations and the MCP client were written against public API docs and never run against real accounts.
- OAuth one-click apps need the platform owner to create the OAuth apps (secrets above); not done.
- Stripe is wired but has no production keys. Free plan limits and premium-agent gating exist only in the database + UI.
- Agents cannot yet call connected MCP tools by themselves; Firbo is not yet an MCP server.
- Test coverage is mostly unit tests for helpers and i18n; there are no end-to-end tests and no CI.
- Single-tenant data volume so far: performance and RLS under many tenants is untested.

## 11. Suggested improvements, in order
1. `supabase db pull` → commit a true baseline; add a CI job that applies migrations to an empty database.
2. Fix the three security advisor items; rotate any key that was ever pasted in a chat.
3. Add a GitHub Actions pipeline: typecheck + tests on every push; deploy functions with the CLI.
4. End-to-end tests (Playwright) for login → create company → hire agent → run task → approve; and one for voice with a fake microphone.
5. Real-device pass for mobile; finish the design pass on the screens listed in section 10.
6. Monitoring: Supabase log drains + uptime check for gateway/api; automatic backups of `deploy/hostinger/data`.
7. Merge the working branch into `main` once reviewed, and make Vercel deploy from it automatically.
