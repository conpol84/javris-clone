# Jarvis VPS form login

Owner readback on 9 October: public `jarvis.firboai.app` returns HTTP401 with
Basic authentication. Its Caddy route forwards to `172.17.0.1:8765`. Local root
serves HTML200 and `/health` returns200. Both systemd instances are active.
This is a working backend behind a browser authentication challenge, not proof
of a broken OpenJarvis service. The separate `javris.firboai.app` Vercel app is
unchanged by this repair.

## Changed

- Optional ASGI login middleware runs outermost for **jarvis.firboai.app only**.
  The installer enables it only for `openjarvis.service`, through a new drop-in.
  The customer box and existing API-domain authentication keep their behavior.
- Normal responsive username/password form, scrypt password hash, opaque random
  sessions lasting eight hours, Secure/HttpOnly/SameSite=Strict host cookie,
  global login attempt limit, bounded request bodies and same-origin mutation
  and WebSocket checks. Restarting the service invalidates sessions.
- The existing server API key stays server-side. Authenticated HTTP/WebSocket
  requests receive it internally before the original API authentication runs.
  No browser storage of the key, no key reset and no provider/model change.
- Sign out at `https://jarvis.firboai.app/_firbo/login` after signing in.
  This administrator login is separate from a Firbo customer account.

## VPS installation

Use the immutable source and installer SHA recorded in the PR/Issue52 handoff.
Run only as root on srv2027143. The installer prompts **on the local TTY** for a
new password twice; username is `admin`. Do not send the password in chat.

The installer verifies its module download hash, exact installed factory shape,
one literal dedicated Jarvis Caddy site with one Basic auth block, and the
observed adapted route. It refuses an existing login installation, ambiguous
site/matcher or concurrent file change. No reinstalls/pairing of either worker.

Backup is a private `/var/backups/firbo-jarvis-login-*` directory with original
app.py, Caddyfile and path manifest. The new module, private password-hash file
and systemd drop-in are separate files. Only the admin service is restarted.

Local acceptance verifies login HTML, anonymous API denial, wrong-password
denial, successful cookie login, authenticated dashboard/API and logout. Only
then is the exact Basic auth block removed. The complete adapted Caddy config
must equal its original except that one authentication handler; Caddy validation
must pass before reload. The same acceptance is repeated over public HTTPS.
No inference is performed. Box health is checked separately.

On failure, restore Caddy Basic authentication before reverting the middleware.
If restoring outer auth fails, keep the new login enabled and report manual
recovery rather than expose the dashboard. Concurrent changed files are never
blindly overwritten. Automatic rollback removes only this installer's new files.

## Verification / remains

Tests exercise the actual ASGI gate, real FastAPI/Starlette cookie and WebSocket
flow, preservation of API-host authentication, expired/forged/duplicate cookies,
CSRF, input/rate bounds, exact app/Caddy transforms, module hash and fault
injection at restart/local acceptance/validation/public acceptance/rollback.
CI additionally uses the real Caddy adapter to compare all routes.

Source tests do not prove installed state. Owner must run the pinned installer
and receive PUBLIC_LOGIN_DASHBOARD_API_LOGOUT_PASSED, then sign in normally.
Existing dashboard build and provider tasks are not replaced or declared tested.
Actual CEO desktop work, Mac capability installation and the three desktop vision
settings remain independent, unfinished acceptance work. Keep PR111 and both
contributors' accepted ancestry; no unrelated web/backend release for this patch.

## Browser regression and correction

Owner screenshot after successful scripted install shows `origin_denied` on the
form POST. The original `Referrer-Policy: no-referrer` can cause native browser
form submissions to send `Origin: null`. The scripted acceptance supplied an
Origin header explicitly and missed this browser behavior.

Use `same-origin` on login responses. Keep the exact origin check, null-origin
denial, cookie protection and existing password. A real Chromium HTTPS test
reproduces the old rejection and verifies native form login and logout at 390
and 1280 pixels without fabricating the browser's headers. The guarded
`repair-dashboard-origin.py` changes only the known installed module version,
keeps a private backup and verifies the served header and anonymous API denial.
It does not reinstall login, change Caddy, or reset the administrator password.
