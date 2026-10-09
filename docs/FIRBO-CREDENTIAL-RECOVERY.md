# Firbo credentials: recovery and coordinated rotation

Use the Hostinger VPS Terminal for gateway/server commands. Use the Mac's own
Terminal for its Computer Connector. These credentials serve different purposes.
The helper described below is a source change; use it only after those files have
been installed on the VPS. This change does not itself rotate a live credential.

| Credential | Purpose | Existing location / recovery |
|---|---|---|
| Firbo account password | Website sign-in through Supabase | Use the website password recovery or account settings. It is not the gateway password. |
| Computer pairing code | Connect the specific Mac/PC to its company | Computers → New code; expires after 10 minutes and is used once. No permanent password to recover. |
| Connector device token | Authorize that computer's polling/reporting | Private local `~/.firbo-connector.json`; `status` hides it. Re-pair to replace it. |
| OmniRoute dashboard password | Sign in to the infrastructure dashboard | The gateway stores a bcrypt hash. Reset it; a hash cannot reveal the original password. `INITIAL_PASSWORD` in `.env` is only the first-start bootstrap and may be stale. |
| OpenJarvis admin API key | Server agent at `/jarvis`, normally platform-admin operations | The source deployment uses `openjarvis` and `/home/jarvis/.openjarvis/serve.env`. Confirm the actual service's EnvironmentFiles first. Supabase `OPENJARVIS_API_KEY` must match this instance. |
| OpenJarvis customer API key | Separate restricted agent at `/jarvis-box` | `openjarvis-box`, normally `/home/jarvis/.openjarvis-box/serve.env`; Supabase `OPENJARVIS_SANDBOX_API_KEY`. |
| Docker Firbo API key | Separate gateway API service configuration | Running Compose stack `.env`, also named `OPENJARVIS_API_KEY`. This is not automatically the host agent's `/jarvis` key. |
| OmniRoute inference API key | Agent/model requests | Compose `.env` `OMNIROUTE_API_KEY` and Supabase secret of the same name. It must have no management access. |
| OmniRoute management API key | Infrastructure management | Compose `.env` `OMNIROUTE_MANAGEMENT_KEY`; separate key with management access, kept server-side. |

## Inspect without displaying credentials

After installing the helper, run it from wherever its source file is located:

```bash
python3 gateway-credentials.py
```

It discovers the actual running `firbo-api` / `firbo-omniroute` Compose directory
from their labels, verifies the shared project and returns file paths and
credential presence only. It does not expose values, edit files or change services.
It refuses remote Docker contexts, symlinked configuration and mismatched stacks.
Its native-service discovery asks for `EnvironmentFiles`, never `Environment`.

Already-supported path discovery in the VPS Terminal:

```bash
systemctl show openjarvis -p EnvironmentFiles --value
systemctl show openjarvis-box -p EnvironmentFiles --value
docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' firbo-api
```

If you need to recover an existing API key, open that exact file in a private
terminal editor, such as `sudo nano /the/verified/path/serve.env`. A native API
key is stored in plaintext there; do not paste the file, key, screenshot or raw
inspection output into a chat. Prefer your password manager for retaining it.
Do not run `systemctl show -p Environment`, `cat .env`, a credential-printing grep,
or an unfiltered Docker inspection for a shareable diagnostic report.

## Reset a forgotten gateway dashboard password

Preferred helper after deployment:

```bash
python3 gateway-credentials.py reset-dashboard
```

It asks twice with hidden input, checks that the installed reset CLI supports
stdin, passes the password only through stdin, resets it through the existing
database-aware CLI, restarts only the gateway and checks its health. It requires
12 or more characters and at most 72 UTF-8 bytes, avoiding bcrypt truncation.
If the reset succeeds but restart/health fails, its error explicitly states that
the password has already changed. A password reset cannot be honestly rolled
back to a forgotten plaintext password.

The existing fork also supports this command before the helper is installed:

```bash
docker exec -it firbo-omniroute node bin/reset-password.mjs
docker restart firbo-omniroute
```

The CLI's interactive prompts show typed characters. To enter the new password
privately in the VPS Bash Terminal, use its verified stdin mode instead:

```bash
read -r -s -p "New gateway password: " FIRBO_NEW_GATEWAY_PASSWORD
printf '\n'
if printf '%s' "$FIRBO_NEW_GATEWAY_PASSWORD" |
  docker exec -i firbo-omniroute node bin/reset-password.mjs --password-stdin
then
  unset FIRBO_NEW_GATEWAY_PASSWORD
  docker restart firbo-omniroute
else
  unset FIRBO_NEW_GATEWAY_PASSWORD
  echo "Password reset failed; the gateway was not restarted." >&2
fi
```

The existing reset CLI does **not** invalidate old dashboard sessions. After
recovery, sign in and rotate the password again through gateway Settings: that
supported Settings route also invalidates sessions issued before the change.
The helper reports this session limitation; it does not directly rewrite private
database/session internals.

Resetting the dashboard password does not replace inference keys, management
keys, provider credentials or the Firbo account password. Do not change only
`INITIAL_PASSWORD` and expect it to overwrite the database's current password.

## Replace gateway API keys without changing routing

1. In the gateway API Keys page, create a new inference-only key and a separate
   management key. Keep the existing keys valid during this operation.
2. After installing the helper, run either of the equivalent commands:

```bash
python3 gateway-credentials.py set-gateway-keys
# Or: ./set-gateway-keys.sh
```

The helper uses hidden input and read-only checks against the local gateway.
It requires management access for the management key, a successful model-list
request for the inference key, and a 401/403 management denial for that inference
key. This verifies these endpoints; it does not prove a paid generation or every
possible model permission. It makes no generation request.

Only after those checks pass, it creates a private 0600 backup inside a 0700
directory and atomically updates those two `.env` fields. It preserves encryption
keys, provider state and every unrelated field. It recreates only `firbo-api`
with the already-installed image and authoritative Compose files, without
pulling, building or restarting dependencies; then verifies both loaded values
privately and checks API health. It excludes exported shell variables so they
cannot override the `.env` values.

Before that recreation it compares the resolved existing image, environment,
entrypoint/command, bind mounts and networks with the running API. A stale Compose
checkout blocks the operation instead of replacing the current runtime. API-only
native/voice overlays are preserved even when the gateway still labels the base
Compose file. Concurrent edits to those files block recreation/rollback.

If the recreate/verification fails, it restores the prior `.env` and attempts to
restore/verify the prior API runtime. Its error distinguishes successful rollback
from an unverified runtime. It refuses to overwrite a concurrent operator edit.
It never prints keys or raw service errors. `--show` is no longer accepted.

3. Update Supabase Edge Function secret `OMNIROUTE_API_KEY` to the new inference
   value through the secure dashboard. The helper cannot perform that update.
   Preserve `OMNIROUTE_BASE_URL` and all routing/model settings.
4. Verify an authorized model request and the gateway management summary through
   Firbo. Revoke the old keys only after every consumer uses the new ones.

Do not run `setup-gateway.sh` for credential recovery. That separate script
deliberately changes the `firbo-economy` / `firbo-quality` combos. It now refuses
shared keys and any unverified scope rather than copying a management key into
inference configuration.

## Rotate OpenJarvis server API keys as a coordinated operation

This helper intentionally does not rotate native OpenJarvis keys or the Docker
Firbo API's `OPENJARVIS_API_KEY`.

The current source CLI supports `jarvis auth create-key` and `jarvis auth revoke-key`.
It does **not** implement `jarvis auth generate-key`, despite old deployment docs
mentioning it. `create-key` writes the current user's config file and displays
the result; it does not update an installed service's `serve.env`. Service
`OPENJARVIS_API_KEY` overrides the config value, so that command alone cannot
repair the live Hostinger service connection.

For a native service rotation: discover the actual EnvironmentFiles, retain a
private rollback copy, replace only its `OPENJARVIS_API_KEY` in a private editor,
update the matching Supabase secret and any authorized native clients, restart
only the relevant `openjarvis` or `openjarvis-box` service, and verify its matching
Firbo connection. A service accepts one key at a time, so schedule this short
cutover and preserve rollback until both ends are verified. Do not edit both
instances or the Docker key just because the variable name looks identical.

## Replace a Mac's Computer connection

In the Mac Terminal, stop the running Connector with Ctrl+C. Check status without
displaying its token:

```bash
node "$HOME/Downloads/firbo-connector.mjs" status
```

To deliberately replace its connection:

```bash
node "$HOME/Downloads/firbo-connector.mjs" forget
```

Remove the old Computer entry in the website, obtain a fresh code in the correct
company, then run on the Mac:

```bash
node "$HOME/Downloads/firbo-connector.mjs" pair FRESH_CODE --allow-browser
node "$HOME/Downloads/firbo-connector.mjs" run
```

Keep the Terminal open. `forget` retains private local execution journals, which
may contain undelivered results; review them privately before deleting. Gateway
passwords and provider API keys are not needed for normal Computer pairing.

Never use `repair.sh --fresh` as password recovery: it moves the existing gateway
database aside. Never replace `STORAGE_ENCRYPTION_KEY` or `MACHINE_ID_SALT` during
password/key recovery; stored provider credentials depend on that configuration.
