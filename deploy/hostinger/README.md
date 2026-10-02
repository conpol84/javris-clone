# Firbo AI — server (Hostinger VPS) guide

One server runs everything that cannot live on Vercel/Supabase:

| Address | What | Used by |
|---|---|---|
| `https://gateway.<domain>` | **OmniRoute**: provider connections (OpenAI, Claude, Kimi, GLM, …), keys, routing, OpenAI-compatible `/v1` | you (dashboard), Supabase agent runner |
| `https://api.<domain>` | **Firbo API**: gateway status for the *AI Gateway* page, legacy chat/agents | the Firbo web app |

Web app = Vercel (firboai.app), database + login + agent runner = Supabase. This server only adds the AI gateway.

## 1. Buy and prepare the VPS (10 min)
1. Hostinger → **VPS** → KVM 2 or bigger (≥ 4 GB RAM; the first build needs memory). Choose **Ubuntu 24.04 or newer**. Add your SSH key or note the root password.
2. Note the server's **public IP**.
3. DNS: create two **A records** → that IP:
   - `api.firboai.app`
   - `gateway.firboai.app`
   (If firboai.app DNS is on Vercel: Vercel → Domains → firboai.app → DNS Records.)

## 2. Install (10 min)
The repository is **private**, so the server needs a read-only *deploy key*:
```bash
ssh root@SERVER_IP
ssh-keygen -t ed25519 -N "" -f ~/.ssh/firbo_deploy && cat ~/.ssh/firbo_deploy.pub
```
GitHub → repo `javris-clone` → Settings → **Deploy keys** → *Add deploy key* → paste the printed line, leave "Allow write access" **off**.
```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/firbo_deploy -o StrictHostKeyChecking=accept-new" \
  git clone -b claude/omniroute-engine git@github.com:conpol84/javris-clone.git
cd javris-clone/deploy/hostinger
./setup.sh                 # installs Docker, opens only ports 22/80/443, creates .env with random secrets
nano .env                  # fill SUPABASE_PUBLISHABLE_KEY and INITIAL_PASSWORD (domains if different)
docker compose up -d --build
docker compose ps          # all "running/healthy" after a few minutes
```
Open `https://gateway.firboai.app` → log in with `INITIAL_PASSWORD`.

## 3. Connect your AI providers (in the OmniRoute dashboard)
**Providers** → add each provider and paste its key: OpenAI, Anthropic (Claude), Kimi/Moonshot, GLM/Zhipu, Xiaomi MiMo, … Keys are stored encrypted on *your* server.
Optional: create a **combo** called `auto` (e.g. cheap model first, Claude as fallback).

## 4. Create the two access keys
Dashboard → **API Keys**:
1. `firbo-inference` → inference key → put into `.env` as `OMNIROUTE_API_KEY`
2. `firbo-manage` → key **with manage scope** → `OMNIROUTE_MANAGEMENT_KEY`

Then: `docker compose up -d` (applies the new .env).

## 5. Connect Supabase (agents call the gateway)
Supabase → Edge Functions → **Secrets**:
| Name | Value |
|---|---|
| `OMNIROUTE_API_KEY` | the `firbo-inference` key |
| `OMNIROUTE_BASE_URL` | `https://gateway.firboai.app/v1` |
| `LLM_DEFAULT` | `omniroute:auto` (or `omniroute:<model>`) |
| `RUN_ALLOWED_EMAILS` | your email(s), e.g. `me@mail.com,@mycompany.com` — **recommended while signup is open**, otherwise anyone who signs up can spend your credits |

Existing `OPENAI_API_KEY` etc. keep working as direct fallbacks (`LLM_FALLBACK=openai:<model>`).

## 6. Connect the web app (Vercel)
Vercel → project → Settings → Environment Variables (Production):
- `VITE_API_URL` = `https://api.firboai.app`
- `VITE_OMNIROUTE_URL` = `https://gateway.firboai.app`

Redeploy. The **AI Gateway** page now shows live providers/models and a button to the full dashboard.

## 7. Check
```bash
curl https://api.firboai.app/health          # {"status":"ok"}
curl -I https://gateway.firboai.app           # 200/302
```
Then in Firbo: *Talk to Firbo AI* → give a command → result under *Tasks*.

## Operations
- Update: `git pull && docker compose pull && docker compose up -d --build`
- Logs: `docker compose logs -f omniroute` / `firbo-api` / `caddy`
- Backup: copy `deploy/hostinger/data/` (OmniRoute database + encrypted keys) and `.env` somewhere safe. Hostinger weekly snapshots are a good second layer.
- Forgot dashboard password: `docker exec -it firbo-omniroute node bin/reset-password.mjs`
- Security: only 80/443/22 are open; keys live only in `.env`, OmniRoute's encrypted store and Supabase secrets — never in the browser or git. Use SSH keys and disable password SSH.

## Repair, health report and the branded gateway

```bash
cd ~/javris-clone/deploy/hostinger && git pull && ./repair.sh
```

`repair.sh` backs up `.env` and the gateway data, fills in only the missing settings (secrets, domains, password),
restarts the stack and prints a health report that never contains passwords. If the gateway still shows
"zero-config mode" or you cannot log in, run `./repair.sh --fresh`.

**Firbo name and logo in the gateway.** The branding lives in the fork `conpol84/OmniRoute`, branch `firbo/branding`.
GitHub builds the image for you (the small VPS cannot): open the fork -> Actions -> enable workflows -> run "Firbo image".
After the first run set the package `omniroute` to Public (GitHub -> your profile -> Packages -> omniroute -> Package settings),
then put `OMNIROUTE_IMAGE=ghcr.io/conpol84/omniroute:firbo` in `.env` and run `docker compose pull omniroute && docker compose up -d`.


## Cost levels (Economy / Quality)

After connecting providers in the gateway, run `./setup-gateway.sh` once (and again whenever you add providers). It creates the combos `firbo-economy` (free first) and `firbo-quality` (best first). In Supabase -> Edge Functions -> Secrets set `OMNIROUTE_BASE_URL=https://gateway.<your-domain>/v1` and `OMNIROUTE_API_KEY` (the same value as `OMNIROUTE_API_KEY` in `.env`: `grep ^OMNIROUTE_API_KEY= .env`).

## Providers or keys disappear after a restart

Symptom in `docker compose logs omniroute`: `EACCES: permission denied, open '/app/data/storage.sqlite.tmp-…'`. The gateway runs as the `node` user (uid 1000) and `data/omniroute` was owned by root, so nothing was ever saved. `./repair.sh` now fixes the owner automatically; by hand: `sudo chown -R 1000:1000 data/omniroute && docker compose restart omniroute`.
