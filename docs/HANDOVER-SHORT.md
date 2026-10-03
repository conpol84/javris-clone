# Firbo AI — one-page summary for a new developer

**What:** a SaaS where each customer company has AI employees (agents) with roles, budgets and approval rules, plus a talking AI CEO.

**Where things live**
- Code: GitHub `conpol84/javris-clone`, branch `claude/omniroute-engine` (not `main`). Web app in `frontend/`.
- Web app: Vercel → firboai.app. Deployed manually from a commit SHA.
- Database, login, 12 Edge Functions: Supabase project `bfeinnsorgjycivozcau`.
- AI gateway (OmniRoute) + small API + Caddy: Hostinger VPS, Docker, `deploy/hostinger/`.

**Run it:** `cd frontend && npm install`, create `.env.local` with `VITE_COMPANY_SUPABASE_URL` and `VITE_COMPANY_SUPABASE_PUBLISHABLE_KEY`, then `npm run dev`. Checks: `npx tsc -b`, `npx vitest run`, `npm run build:tauri`.

**Fix first**
1. DB migrations in the repo (9) ≠ live DB (28). Run `supabase db pull` and commit.
2. Security: `get_plan_usage` open to anonymous users; leaked-password protection off; rotate the gateway keys once pasted in a chat.
3. Voice input unreliable — read the "Voice diagnostics" log in the Talk console, test with a real microphone, check `agent-listen` logs.

**Not verified:** almost everything was checked only in a test renderer, never with a real signed-in session; the ~20 new integrations and the MCP client never ran against real accounts; Stripe has no production keys.

**Design status:** CEO/Talk, Command Center hero and AI-employee figures are the new holographic style; 3D Office rooms, Landing and 2D screens still need a real design pass.

Full details: `docs/HANDOVER.md`.
