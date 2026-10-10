# FIRBO / OmniRoute MCP-only key: exact-source validation and release gate

Date: 2026-10-10. Existing project only, staged on the FIRBO PR #144 source stack.

## Live evidence (owner's Hostinger VPS and OmniRoute dashboard)

- The dedicated key authenticated to `/api/mcp/status`: HTTP 200, enabled/online/scopesEnforced true, transport streamable-http.
- A real `tools/list` returned 110 unique advertised tools including all five FIRBO-approved read-only names, no tool executed in discovery.
- Exactly one owner-authorized `omniroute_get_health` tool call returned `isError=true`; the existing OmniRoute Audit Log identified `scope_denied:missing_scopes` with 0ms. This proves the key lacked `read:health`, not that the gateway was offline.
- There is no need for a second MCP, CEO, gateway, database or model router. The Firbo MCP Edge pilot remains OFF.

## Existing OmniRoute source repair

GitHub [conpol84/OmniRoute PR #1](https://github.com/conpol84/OmniRoute/pull/1) is Draft; its exact reviewed head for this CI is `ac3aa6de9c82c275e795f69cf4805d331919a331`.

It adds a six-scope FIRBO MCP-only key preset to the existing API Manager create/edit UI and the *existing* `/api/keys` and `/api/keys/[id]` protected endpoints:

- `mcp:connect`, `read:health`, `read:quota`, `read:usage`, `read:models`, `read:combos`
- No `manage`, `admin`, write, execution or inference scopes. Server-side `modelAccessMode=restricted` plus zero model/combo allowlists denies model completions.
- The central `CLIENT_API` authorization policy explicitly returns 403 `MCP_ONLY_KEY` on ordinary `/v1` endpoints when an exact MCP key is presented, including model listing and no-model media/batch endpoints. This closes the possibility of use as an inference or unrelated API key; existing ordinary keys retain original behavior.
- Key conversion requires explicit owner confirmation and uses the existing management-authenticated PATCH with existing audit/caches. Do not use key in another application.
- All source remains unmerged/unshipped. The already live gateway does not yet show the new preset.

## Why tests are here

The public fork conpol84/OmniRoute has not reported any GitHub Actions run at its own PR #1 head (the new workflow there was never triggered). No claim that the fork is CI-green is justified. Instead this isolated, read-only FIRBO CI checks out **the exact public source commit**, validates Git HEAD, and runs the *actual* OmniRoute TypeScript, ESLint, six-scope schema and central client authorization tests. GitHub Actions uses only synthetic CI values; it never connects to production, lists live API keys, invokes Omni tools, runs migrations, merges or deploys.

## Current plan and rollback-safe sequence

1. Make this exact-head CI green without relaxing security checks or overwriting previous work; if it fails, fix the OmniRoute Draft source, repin exact SHA in the bridge and rerun CI.
2. Obtain operator consent and existing gateway release procedure/backup/rollback for deploying the tested OmniRoute source to gateway.firboai.app. PR merge is NOT itself proof of live deployment. Check actual image hash and release.
3. Once the new API Manager option is visibly deployed, owner chooses one unique dedicated MCP-only key and converts it with explicit confirmation or issues a new key and later revokes the old one. **Never paste its secret into ChatGPT**; the already exposed VS Code token visible in previous chat must be rotated through its separate client integration.
4. Read back the exact six scopes, then perform one new explicitly approved, pinned `--read-health` call using a hidden prompt. Expect success, and verify the existing OmniRoute Audit Log tool result.
5. Then stage the existing FIRBO `mcp` Edge source from the FIRBO PR #144 ancestry: 110→256 bounded discovery, return only five allowlisted tools, tenant/platform-admin and foreign-company denial, egress source pinning and audit receipts; keep `FIRBO_OMNI_MCP_PILOT_ENABLED=false` until signed-off.
6. Separately promote the reviewed Hostinger FIRBO native API Docker image to fix the old local Qwen route HTTP404 with tested smoke/rollback; do NOT couple it to the MCP key release.

Expected checkpoint format: CHANGED / TESTED / PASSED / FAILED / REMAINS. Do not mark an unrun CI, production release or tool acceptance as complete.
