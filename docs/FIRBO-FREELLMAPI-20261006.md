# FreeLLMAPI integration checkpoint — 6 October 2026

## Changed

Based on shared Claude/Codex commit 3fd0c86182fe71874958b9da422820961b3749f8.
Production Vercel deployment dpl_9BwGdUMw7nVveTBhutx1Ek2pTDrr is READY at that commit.
Mission-runner v28 and its three live dependencies match this source byte for byte:
the previously reported live/source drift is closed. No backend redeploy is needed.

Fixed the Mac updater's pinned Connector hash to match the new shared source
84b40bfd71bf4b4a0b28baf4737e72dc99613fcc290997781ce464d56e626c92.
Its previous hash rejected the new release. Existing pairing and approvals remain.

Added an optional private FreeLLMAPI Compose overlay and a read-only readiness probe.
The overlay is disabled unless its profile is selected. It preserves the existing
Firbo services and routing, stores SQLite persistently, binds the dashboard to
loopback, requires an immutable image, limits memory/CPU/logs and bounds inner
failover. Compression/cache remain off to avoid competing transformations.

Upstream reviewed: tashfeenahmed/freellmapi at
a6b2158c7c36ce19f888d0411846a1a0f2aa3f06. The owner fork conpol84/freellmapi
became available during this turn; its main head matches that exact upstream SHA.
The integration does not require embedding either gateway's code in the frontend.

## Activation contract

1. Check VPS free disk, available RAM and the current Compose project/overrides.
   Reserve at least 512 MiB available RAM plus host headroom; image disk size must
   be checked before pulling. The service does not host model weights.
2. Set FREELLMAPI_IMAGE to a reviewed immutable ghcr.io image digest in the host
   environment. Create .env.freellmapi (0600) with a fresh 64-hex ENCRYPTION_KEY.
3. Create freellmapi-bootstrap.json (0600) containing the initial admin account
   under admin.email/admin.password. Never commit either file or credentials.
   This closes first-run account claiming before the listener starts.
4. Add the overlay to the CURRENT Compose arguments and start only freellmapi
   with --profile freellmapi up -d --no-deps freellmapi. Do not recreate the stack.
5. Reach the dashboard via SSH forwarding to localhost:3001. Add selected provider
   keys and copy its unified inference key into OmniRoute's server-side connection.
6. In OmniRoute add an OpenAI-compatible provider node: name FreeLLMAPI,
   prefix freellmapi, apiType chat, baseUrl http://freellmapi:3001/v1. Add its
   API-key connection, then register a verified model from its /v1/models list.
   The existing OmniRoute fork supports this provider-node contract. If its URL
   guard rejects a private target, stop and use a scoped solution; do not turn
   off global SSRF protection. Verify runtime versions before management writes.
7. Test a dedicated manual model route before adding it to any combo. Verify
   text, SSE streaming, tools, JSON, 401, 429, timeout and cancellation. Record
   the actual upstream model/provider (X-Routed-Via) rather than claiming auto
   identifies the model. Existing Firbo gateway traces mark fallback unverified.
8. Only then opt a canary agent into the new route. Existing economy/quality
   combos remain intact. Keep provider permissions and company budgets in Firbo.

Do not point FreeLLMAPI back at OmniRoute: that creates a routing loop. Keep
outer attempts bounded and no automatic paid fallback for a zero-cost route.
No claim of free capacity is justified by model registration alone. Provider
terms and actual quota eligibility must be checked for commercial use.

## Rollback

Remove the canary route, stop only freellmapi, and preserve its volume and
ENCRYPTION_KEY for recovery. Never use down -v. Existing Firbo routing continues.

## Failed / remains

Passed locally: 8 readiness/security tests, Ruff lint/format, Compose structure
and private-profile checks, and 64 current mission/computer/connector tests.
The Compose file was parsed with PyYAML; Docker runtime validation was unavailable.

No VPS execution connector is exposed in this session; no server installation,
capacity measurement, provider account connection or real inference occurred.
Mac browser control still requires the paired device's local update and consent;
signed-in meeting and second-customer acceptance remain open. These cannot be
declared completed by a Vercel build or synthetic tests.
