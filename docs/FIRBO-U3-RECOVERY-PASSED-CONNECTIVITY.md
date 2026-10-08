# U3 local archive verification passed; connectivity candidate prepared

2026-10-03. Supersedes the previous next-owner-action to rerun recovery_continue.py. Do NOT request another backup-verifier run.

## Actual owner evidence

At 04:40:38.912695 UTC, the owner's terminal report returned `verified_existing_checkpoint`. It confirms configuration_matches_live=true. OCI verifier `oci-artifacts-v2` reports index identity, one linked runnable manifest, one artifact manifest, one empty config and nine layer descriptor hashes verified. Previous archive-compatibility blockers are therefore closed for this checkpoint. This is user-supplied execution evidence, not assistant SSH access.

Scope is configuration plus the existing API image only. Encryption, off-host copy, DB/volume backup, artifact semantics, uncompressed diff-ID validation and application restore/boot have NOT been verified. Management and inference key settings remain identical; this is still a separate pre-cutover security task. No key changed.

## Why a separate narrow connectivity branch exists

The native U1 frontend in PR #9 requires the native Hostinger API that has not yet been installed. Shipping all of PR #9 would not safely resolve the current live Gateway error. PR #10 branches from current production 50bea79 and changes only the Gateway browser transport/Vercel rewrites, tests/docs and the already-reviewed dependency/CSS remediation. It preserves the old API and frontend contracts and all page/navigation behavior. This is NOT a new product or a replacement project.

Narrow candidate code: `36b7af9c2084af551948ff7b0794209bd985c7eb`.
Branch: `codex/firbo-connectivity-hotfix`.
Draft PR: https://github.com/conpol84/javris-clone/pull/10
Matching transport/config/test files are also applied here in PR #9 so the eventual unified release does not regress this fix. Native UI still requires its matching backend; do not promote PR #9 alone.

## Changed

- Hosted Firbo Gateway calls use same-origin paths rather than editable desktop URLs or browser cross-origin calls.
- Three fixed Vercel rewrite families forward only to `https://api.firboai.app`: `/v1/gateway/*`, `/v1/firbo/*`, and `/firbo-backend-health`.
- No tokens/keys injected by the proxy, no arbitrary upstream URL, no iframe/CORS security weakening. Existing Supabase session verification remains in the API. Missing cloud sessions do not fall back to stored desktop keys.
- Explicit private/no-store browser and CDN response headers. API paths cannot silently become index.html.
- Local/desktop behavior preserved; tests cover canonical/owned-preview hostname selection and impostor-host handling.

## Verification obtained for the NARROW candidate

Connectivity CI 37097720845, job 111130964009: npm installation, full and production-only npm audit at low threshold, frontend tests, four proxy boundary/config tests, full TypeScript and production build all completed SUCCESS. No claim of authenticated-user or live inference success is inferred from CI. The four config tests also passed locally.

Vercel preview `dpl_7JvWyWce9mX5emdVCef4EBcbjjhe` is READY for exact SHA 36b7af9. URL:
https://jarvis-command-center-qmd3cpxg3-conpol84s-projects.vercel.app

Real HTTP checks through the connected Vercel tool:
- `/firbo-backend-health`: HTTP 200 JSON `status: ok`, Via Caddy, Cache-Control and CDN-Cache-Control no-store, x-vercel-cache MISS. This verifies a real Vercel -> existing Hostinger API path, not model execution.
- `/v1/gateway/__connectivity_check`: HTTP 404 JSON `detail: Not Found`, Via Caddy, private/no-store headers; confirms unknown API paths do not become the SPA HTML.
- `/v1/gateway/overview` without a Firbo session: the tool returned 401 and classified it as Vercel deployment/share-link authentication failure. The response body was unavailable, so this check is INCONCLUSIVE about the upstream authenticated route. Do not report it as a verified backend authorization pass or a gateway outage.

The exact authenticated Failed to fetch in the owner's browser has not been reproduced; stale URL and cross-origin transport are concrete risks addressed by this candidate. Wrong sessions or backend errors may still need separate handling.

## Next owner action — browser only

Open the EXACT narrow preview above (not the full-unification preview). If Vercel asks, sign in with the existing Vercel owner account; then use normal Firbo login. Open AI Gateway -> Overview without changing routes/keys or running Playground/agents/integrations. Report whether provider/model counts appear, otherwise only the visible error/status. Never send tokens, passwords, raw network headers or HAR.

Do not change Hostinger, run more recovery scripts, or promote either PR for this check. The old Admin iframe remains expected to reject embedding; this narrow candidate does not pretend to replace it.

## Remains

Real-account narrow candidate verification; approved controlled frontend release/rollback; consistent database and volume backups, encrypted off-host copy and restore/boot rehearsal; isolated native Hostinger backend; distinct verified key scopes; real native admin/tenant and gateway/fallback tests; missions/audio; durable server-owned accounting/atomic budgets; integrations including TikTok/YouTube/Salesforce/QuickBooks; migration reconciliation; MCP/shift hardening; monitoring and real-device QA.

No production alias, DB/function, provider key, agent selection or VPS runtime was changed in this work unit. Final PR #9 CI after syncing these files is a separate result; no pass is claimed here until observed.

Documentation: https://vercel.com/docs/routing/rewrites ; https://vercel.com/docs/caching/cache-control-headers .
