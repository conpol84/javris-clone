# FIRBO Platform Admin — OmniRoute + FreeLLMAPI login links

Checkpoint: 2026-10-10. Master coordination is GitHub Issue #52.
Scope is FIRBO frontend only, based on stacked Draft PR #133. No changes to PickFantasy, TradeAthletes, FIRBO Supabase, provider credentials, running VPS Docker or Vercel production.

## Actual live evidence from owner's VPS
- FreeLLMAPI container firbo-freellmapi is UP 3 days and HEALTHY. Port binding: 127.0.0.1:3001 -> 3001/tcp. A local GET /api/ping returned HTTP 200.
- FIRBO native firbo-api can reach local Ollama over Docker DNS; /api/tags contains qwen3:1.7b. Ollama was UP 6 days and model installed. This proves reachability/model catalog, **not** owner-authenticated local LLM inference or backup activation.
- Owner reports CEO voice now working. Leave working TTS and profile unchanged.
- Guarded management readback returned gateway_keys_must_be_distinct at parse_private_key_presence even after accounting for equal duplicate lines. This strongly indicates the configured OMNIROUTE_API_KEY and OMNIROUTE_MANAGEMENT_KEY have the same value after normalization; it does **not** confirm provider balance or show which credential has correct scope. Do NOT bypass validator, print values, share .env, replace both keys together, change live combos or reboot. A correctly scoped key pair must be independently verified against the gateway before any controlled remediation.

## Login shortcuts added in the existing FIRBO platform admin surfaces
The existing ServiceAccessPanel is already mounted for platform administrators inside Gateway and Server Jarvis/Admin Console. This change makes two distinct, explicitly labeled login links visible by default:
- OmniRoute login: https://gateway.firboai.app/ (or valid HTTPS management URL from VITE_OMNIROUTE_URL, with userinfo/query/fragments disallowed)
- FreeLLMAPI login: http://127.0.0.1:13001/ on the owner's computer ONLY. This is not public 127.0.0.1 on the VPS; it is a port opened locally by an SSH tunnel. If the operator configures a valid dedicated HTTPS dashboard via VITE_FREELLMAPI_DASHBOARD_URL in future, the service link uses that instead and does not show the SSH note.

To access FreeLLMAPI from Windows PowerShell or Mac Terminal on the same computer as the browser:
    ssh -N -L 13001:127.0.0.1:3001 root@YOUR_VPS_PUBLIC_IP
Leave this local terminal open and visit http://127.0.0.1:13001/. Enter your already authorized FreeLLMAPI credentials in the FreeLLMAPI login page, never in FIRBO or this chat.

No automatic local network request, hidden credential, token in URL, iframe, popup handshake, proxy route, password reset or public port 3001 has been added. Both links open a new tab with noopener, noreferrer and no-referrer policy; the local tunnel link is clearly labeled desktop-only. A mobile browser cannot use a tunnel running on a different device.

The previous GatewayLegacyPanel previously read VITE_OMNIROUTE_URL into href without URL validation; it now uses the existing safe dashboardUrl function and defaults to the reviewed OmniRoute login. No routing/provider engine changed.

All eight supported UI languages (English, Greek, Spanish, pt-BR, French, German, Chinese, Arabic) have the labels and SSH explanation without requiring changes to typed 1,534-key locale dictionaries.

## Release plan: strict stages
1. Same-head CI: new admin link regression tests and existing ServiceAccessPanel/service-dashboards tests, full frontend tests/build, workspace lifecycle and SAST.
2. Preview admin acceptance: signed-in platform admin can see OmniRoute login and FreeLLMAPI link; ordinary company user cannot access Admin Console. Verify fallback local tunnel only on the owner device, no public 3001 exposure.
3. Existing gateway credentials are out of scope. Separate owner-approved remediation with existing gateway credentials tool must first confirm distinct *scopes* and perform atomic backup/rollback, then read actual quota. No error cause claim about paid credits until official provider usage statement.
4. Native Qwen next: owner-authenticated protected local-only endpoint after current Ollama readiness, denied nonowner, exact no-cloud ledger; stage backend before Edge, then enable FIRBO_CEO_OLLAMA_BACKUP only for approved owner org. FIRBO_CEO_LOCAL_ONLY_PRIMARY stays OFF so OmniRoute is primary. Native, Edge and frontend remain Draft PRs #129–#134 pending staged approval and physical E2E.
5. Preserve working voice, CEO memory and device tasks. Do not replay previously ambiguous provider failures; use a fresh new turn only when optional standby is enabled and proven.
6. Controlled Vercel promotion to production after release checklist, server readback and rollback. Do NOT deploy entire outdated main or blindly merge stacked PRs.

Status: source candidate. The private FreeLLMAPI dashboard is healthy/available on the VPS; owner still needs to establish SSH forwarding for browser login.
