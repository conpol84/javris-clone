# Firbo AI — technical handover (read this first)

Written for a developer who has never seen the project. Everything below was checked against the live systems on 2026-10-03.
Secrets are never written here: only their *names*.

## 1. What the product is
Firbo AI turns an AI team into a company: a signed-in user owns one or more **companies**; each company has **AI employees (agents)** with roles, budgets and approval rules, tasks, missions, shifts, memory, integrations and a billing plan. The CEO agent can be talked to by voice.
Parts: **web app** (Vercel) → **Supabase** (login, database, Edge Functions) → **AI gateway** (Hostinger VPS, OmniRoute) → AI providers.

## 2. Where everything lives
| Part | Where | Notes |
|---|---|---|
| Source code | GitHub `conpol84/javris-clone` (**PUBLIC repository** — verified 2026-10-03; it contains no secrets, but everything written here is world-readable; decide deliberately whether to make it private) | Working branch **`claude/omniroute-engine`** (92 commits). `main` is still the old OpenJarvis upstream state. |
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

## 10. Exact status: what is done, what is not
**How "verified" is used below**
- **V1 – automated:** `tsc`, 196 unit tests and the production build pass (run on every change).
- **V2 – seen in preview:** opened with `npm run preview:mock` (fake data, headless Chromium, 3D software-rendered) and looked at a screenshot. Layout is confirmed; real data and real accounts are not.
- **V3 – real account:** used by a real signed-in person. **Almost nothing has reached V3** except what the owner reported (see section 11). Treat every "V2" item as "probably right, please test".

### 10.1 Screens (frontend/src/pages)
| Screen | State | Verified |
|---|---|---|
| Landing (public) | New hologram hero, "how it works" (3 steps), team cards, pillars, 8 languages | V1 + V2 |
| Sign in / sign up / onboarding wizard | Working since early on; only typography changed | V1 (+ V2 onboarding) |
| Command Center `/` | New real-head hologram hero with orbiting agents, gauges, feed, HUD windows, search, focus mode | V1; hero seen in a test scene, page opens without error in preview |
| AI CEO `/ceo` and Talk console (⌘K) | Hologram stage (real head scan, moving jaw, zoom buttons), agent cards, voice, command tab | V1 + V2 (stage); **voice not confirmed on a real microphone** |
| 3D Office `/office` | New: holographic android per employee on a glowing pad with a floating data screen; right panel list | V1 + V2 |
| Tasks | New: KPI cards with trends, board (4 columns) + list toggle | V1 + V2 |
| Inbox | New: readable approval cards (labelled fields, risk bar, avatar), technical JSON collapsed | V1 + V2 |
| Analytics | New: KPI trends, area chart, cost-share donut, per-agent table with bars | V1 + V2 |
| Agent Store | New cards (avatar, tier pill), plan banner, Starter/Pro filter, locked premium agents | V1 + V2 |
| Billing | Pro highlighted, features first, usage bars; Stripe not live | V1 + V2 |
| Integrations | Brand tiles, 60+ apps, OAuth + token + read-only data apps + MCP tools panel | V1 + V2; **no app tested against a real account** |
| Activity | New timeline grouped by day | V1 + V2 |
| People | New member cards, role legend | V1 + V2 |
| Companies | New cards, subtle "remove company" (typed-name confirmation, owner only) | V1 + V2; deletion function exists, never exercised on real data |
| Settings | New layout (account card, language, appearance, shortcuts, server) | V1 + V2 |
| Team, Memory, Reviews, Missions, Studio | Employees are the new holograms; layout/2D parts **only got the global typography pass** | V1 (opens without error in preview) |
| Shifts | Still the old 24-hour dial (no hologram people) | V1 |
| Computers (Firbo Connector), Coding, Hub, Gateway, Admin, Chat (agent chat) | Functional; **only global typography pass, no redesign** | V1 |
| Error screen | New dark "This page hit a problem" with Reload / Back; technical text collapsed | V1 |

### 10.2 Cross-cutting features
| Feature | State |
|---|---|
| 8 languages (en, el, es, pt-BR, de, fr, zh-CN, ar, RTL) | Done; parity enforced by tests |
| Fullscreen, "open in new window", per-panel minimize/maximize | Done (V2 not covered; browser features) |
| Floating HUD windows (voice, workflow, analytics), desktop only | Done, draggable, remembered |
| Mobile: bottom tab bar, safe areas, 16px inputs, bigger touch targets | Done; **never reviewed on a real phone** |
| Voice input | Records the microphone, auto-stops on a pause, transcribes server-side (`agent-listen`), falls back to browser recognition; "Voice diagnostics" log. **Not confirmed working by the owner.** |
| Voice output | `agent-speak` (OpenAI TTS) with browser fallback; confirmed working once |
| Plans: free = 2 agents, premium agents locked on free | Done in DB + UI |
| Company deletion | Done (RPC + UI) |
| MCP client (connect remote MCP servers, list/run tools) | Done in `mcp` function + Integrations; **not tested against a real MCP server**; agents do not call MCP tools by themselves yet |
| 20 new integrations (Threads, Instagram, DEV, Matrix, Zulip, Rocket.Chat, Todoist, monday, Home Assistant, IFTTT, Brevo, Mailchimp, Stripe, Shopify, WooCommerce, Lemon Squeezy, Gumroad, Calendly, Cal.com, Intercom) | Written from public API docs, **never run against real accounts** |
| Still "coming soon" | TikTok, YouTube, Salesforce, QuickBooks |
| Developer preview with fake data | `npm run preview:mock` (new) |

### 10.3 Backend and operations
| Item | State |
|---|---|
| Supabase schema, RLS, triggers, plan limits, pg_cron shifts | Live. **Repo migrations are incomplete** (section 5) |
| 12 Edge Functions | Live (versions in the Supabase dashboard); repo files match what was deployed from here, but dashboard edits would not show up in git |
| OmniRoute gateway on Hostinger | Running with providers persisted, combos `firbo-economy` / `firbo-quality`; owner confirmed paid models listed. Keys were pasted in a chat once: **rotate** |
| Stripe | Code complete; no production keys or webhook configured |
| OAuth one-click apps (Google, Microsoft, LinkedIn, Dropbox) | Code complete; no OAuth apps registered, so the buttons show a setup note |
| CI/CD | **None.** Vercel is deployed by hand from a commit; functions by hand; no automated tests on push |
| Monitoring, alerts, automatic backups | **None** |
| Security advisors | 3 open items (section 5) |

## 11. What the owner reported from real use (most recent first)
- Voice: first "does not hear me", then "hears but does not answer", last "mouth does not move" (jaw animation added since). Cause not proven; the Voice diagnostics log is the next evidence to collect. No `agent-listen` request had reached the server in the logs I could see when this was written.
- Old cartoon visuals were called childish → replaced in the CEO page, hero, office and all employee figures; 2D screens redesigned in the last rounds.
- Free plan must be 2 agents and the Agent Store must look commercial → done.
- Wanted fullscreen/pop-out windows and removable companies → done.
- A blank "Something went wrong" page appeared for the owner on some screens → guards added and the screen restyled; root cause on the owner's data not reproduced (preview showed it came from sample data of the wrong shape).

## 12. Suggested improvements, in order
1. `supabase db pull`, commit the baseline, add a CI job that rebuilds the database from migrations.
2. Fix the 3 security advisor items; rotate every key that was ever pasted in a chat.
3. GitHub Actions: `tsc`, tests, build on every push; deploy functions with the CLI; Vercel auto-deploy from a protected branch.
4. Playwright end-to-end tests on top of `preview:mock` (page opens, no console errors, key buttons) and a voice test with Chromium's fake microphone.
5. **Real-account QA pass** of every row marked V2 above, on desktop and a real phone; fix what real data breaks.
6. Voice: read the `agent-listen` logs while the owner speaks; confirm the OpenAI transcription model is enabled for the key.
7. Finish redesign: Shifts, Team/Memory/Reviews/Missions/Studio 2D parts, Computers, Coding, Hub, Gateway, Admin, Chat.
8. Let agents call connected MCP tools; expose Firbo itself as an MCP server.
9. Register OAuth apps, add Stripe keys, test 5 top integrations with real accounts before advertising them.
10. Merge the working branch into `main` after review.


## 13. Parallel work by another AI assistant ("Codex") — reviewed 2026-10-03
While the work above was done, a second AI assistant (Codex, acting through the owner's GitHub account) worked in parallel. This section is the independent review of that work.

**Where it lives**
- Branch `codex/firbo-unified-gateway`, **24 commits, 75 files** (+7 645 / −3 396 lines), open as **draft PR #9** into `claude/omniroute-engine`. All 20 CI checks of PR #9 are green. It merges into the current production branch **without conflicts** (checked with `git merge-tree`).
- PR #10 (`codex/firbo-connectivity-hotfix`, same-origin gateway proxy) **was merged** into `claude/omniroute-engine` and is what runs in production now: commit `ae82ca9` (= everything in this document + that hotfix). Vercel deployment `dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`.
- Planning/evidence documents it wrote: `docs/FIRBO-MASTER-PLAN-V2.md`, `FIRBO-PRODUCTION-PLAN.md`, `FIRBO-U2/U3-*.md`, `FIRBO-FREE-MODELS*.md`, `FIRBO-UNIFICATION-*.md` (on the codex branch).

**What it built (all unreleased except PR #10)**
1. *Hotfix (live):* `frontend/vercel.json` rewrites `/v1/gateway/*`, `/v1/firbo/*`, `/firbo-backend-health` to `api.firboai.app` (same-origin, no-store headers); frontend ignores stale desktop endpoints on owned hosts. Owner confirmed the Gateway overview shows "Connected" with providers/models/combos.
2. *U1 native control plane (PR #9):* Firbo-login-protected gateway administration (`firbo_control.py`, `NativeGatewayConsole`, rewritten `GatewayPage`/`AdminPage`), guarded simple-combo edits, 26 Python tests.
3. *U2 shared text routing (PR #9):* `supabase/functions/_shared/gateway-routing.ts` used by `agent-chat` and `agent-runner`; modes `legacy` (default), `canary`, `gateway` via secret `FIRBO_TEXT_ROUTING_MODE`; fail-closed budgets, bounded responses, trace ids; 83 mocked tests. **Not deployed** (Supabase `agent-chat` v9 / `agent-runner` v19 are unchanged — verified).
4. *Server recovery tooling:* read-only Hostinger preflight and a private configuration + API-image recovery checkpoint (with OCI-artifact fixes). Database/volume backups and a real restore are **not** done.
5. *Free-model discovery:* guarded script that reads official OpenCode/OpenRouter offers and registers only zero-priced text models, append-only. The owner ran it on the VPS: 7 OpenCode entries added, no inference requests, existing combos and runtime unchanged.
6. *Mobile foundation (M1):* `mobile-foundation.css`, vendored shadcn-tailwind CSS, shared dialog fixes and a real-component Playwright check of 25 cases in 8 languages (24/25 first, then fixed).
7. Removed the unused `shadcn` npm dependency (large lockfile shrink) after an advisory gate.

**Review verdict — are we on the right track?**
- **Yes on discipline:** it never changed production silently, labels evidence (SOURCE/V1/V2/V3/LIVE), keeps U2 behind a default-off switch, did not deploy edge functions, and refuses to claim what it cannot test. Its audit independently confirmed several problems listed in this document.
- **Yes on the unified direction:** one frontend (this repo), Supabase for identity/data, OmniRoute as the model engine on the VPS.
- **Concerns to resolve:**
  1. **Overlap/conflicts in design:** its mobile layer (`mobile-foundation.css`, 40 px minimums, vendored CSS) and this branch's mobile layer (bottom tab bar, `.fb-bottomnav`, 16 px inputs) were built independently. They merge textually, but **must be reviewed visually together** before PR #9 is promoted.
  2. **Two plans:** `FIRBO-MASTER-PLAN-V2.md` (infra/safety first) and the owner's visible priorities (design, voice, 2D polish) compete. Decide one order; suggested: voice fix → merge PR #9 after visual review → recovery/backups → routing canary.
  3. **Keys:** its evidence says the gateway *inference* key and *management* key values were equal. Create two keys with separate scopes and rotate both (they were also pasted in chat once).
  4. **Public repository:** the repo is public although earlier notes said private. No secrets were found by a pattern scan, but infrastructure names and plans are public.
  5. **Voice (owner's top complaint) is untouched** by that work, and U2 explicitly excludes audio and mission planning from routing.
  6. **Ledger gap:** there is still no durable per-request usage ledger or atomic budget reservation — required before charging customers.
- **Do not** deploy its changed `agent-chat` / `agent-runner` until a staging Supabase project exists and the canary list is empty by default (as designed).
