# Firbo connectivity candidate and successful recovery checkpoint

2026-10-03. The owner supplied status `verified_existing_checkpoint` at 04:40:38 UTC. OCI verifier v2 accepted an index identity, one runnable manifest, one artifact manifest, one empty config and nine layer descriptor hashes. Configuration matched the live runtime. This is owner-supplied evidence, not an assistant SSH session. Do NOT rerun the recovery scripts.

Only configuration and the API image are covered. Database/volume backup, encryption, off-host copy, uncompressed diff-ID verification and restore/boot tests remain unverified/false. The two API-container gateway key settings still hold the same value; do not rotate them without a coordinated rollout.

## Separate production-compatible connectivity candidate

The main unification draft PR #9 is retained. Its native frontend requires the still-undeployed native backend. To avoid shipping that incompatibility, this small candidate branches from the verified production commit 50bea79134fb28aacc9d5d3fcd949ba8d8239d78, NOT from the full unification branch. It preserves the existing screens, API shapes, agent handlers and database. No new native-control UI is enabled.

- Vercel forwards ONLY fixed `/v1/gateway/*`, `/v1/firbo/*` and `/firbo-backend-health` paths to the existing Firbo API. No user-provided upstream host, no management/inference key, no wildcard iframe/CORS weakening.
- Browser Gateway calls on the Firbo production and owned Vercel preview hosts are same-origin. They no longer use stale desktop apiUrl settings or require a browser cross-origin request to the Hostinger API.
- Supabase user authorization is unchanged. Missing cloud sessions never fall back to a saved desktop/server key. The proxy does not grant permissions or supply credentials.
- API responses explicitly forbid browser/CDN caching, and API paths cannot fall through to the SPA HTML. The native `/v1/firbo/*` rewrite is forward-compatible only: current backend may return 404 there.
- Reuse the exact already-reviewed npm/CSS remediation from U3, rather than reintroducing the old vulnerable CLI tree. Existing local components and licensed CSS are retained.
- Add endpoint-selection/ownership and routing/cache-boundary tests. Dedicated CI has read-only permissions and no deployment command.

## Verification boundary

Four proxy-configuration tests passed locally before upload. Full frontend tests, audit, typecheck, production build and Vercel preview checks must be verified at this candidate's commit. Do not infer real-account connectivity or successful inference from a build or public health response.

No production alias, Supabase function/data/keys, agent selection or Hostinger runtime changed. Vercel may build a separate preview from this branch. No real AI request, external write, provider enrollment, payment or automatic repair is part of testing.

## Owner test after preview verification

Open the exact candidate preview, sign in through Firbo's normal login, and open AI Gateway -> Overview. Do not run a model/playground, send integrations or change keys. Report whether provider/model counts load; otherwise report only the visible HTTP/error message, never tokens, passwords, raw HAR or request headers.

The earlier iframe rejection is still expected in the OLD Admin console; use its external dashboard link until native controls are deployed. This narrow candidate does not falsely relabel planned integrations as live or bypass the remaining full-product release gates.

References: https://vercel.com/docs/routing/rewrites ; https://vercel.com/docs/caching/cache-control-headers .
