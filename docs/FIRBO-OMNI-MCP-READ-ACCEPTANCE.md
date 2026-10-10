# FIRBO ↔ OmniRoute one-system MCP — restricted read acceptance

Checkpoint 2026-10-10. This is NOT a new FIRBO service or an enabled MCP pilot.

## Real owner evidence

An authenticated status read using the owner-created narrow MCP key on the Hostinger VPS now returns HTTP 200 with all four expected states: `mcp_enabled=true`, `mcp_online=true`, `mcp_transport=streamable-http`, `mcp_per_tool_scopes_enforced=true`. Previous status was MCP OFF, stdio and scopes OFF. The operator has enabled OmniRoute's EXISTING settings. Actual tools/list and scoped tools/call have **not yet** been observed in production. The copy of the public A2A card is not proof of A2A execution.

## Narrow next-stage acceptance (source-only)

The operator may run `deploy/hostinger/firbo_omniroute_mcp_read_acceptance.py` in their Hostinger terminal:

- Default (NO tool calls): one bounded HTTPS GET to the *fixed* `/api/mcp/status`, then one standard MCP session handshake and `tools/list` via the fixed `/api/mcp/stream`. It returns **only tool counts and the intersection with the five locally approved read-only tool names**; never raw advertised schemas or sensitive responses.
- Explicit `--read-health` opt-in: same handshake/list, then exactly ONE fixed `tools/call` to `omniroute_get_health` with empty arguments. Returns only boolean success with no provider, cache, memory, quota or secret details. The gateway should record the tool in its **existing OmniRoute MCP audit**, distinct from FIRBO's still-not-enabled Integration receipt.
- The script prompts securely in the owner's terminal for the **existing dedicated MCP-only key** and blocks if the terminal may echo characters. It never accepts the key via argument, writes it to disk, prints it, uses proxies, follows redirects, uses other hosts or executes other tools.
- A failed, ambiguous, denied or timed-out request **is never replayed automatically**. Limit to no more than five pages and 100 discovered tool IDs; no downloads, webhook callbacks or changes to OmniRoute settings.
- Inference remains OmniRoute-primary, while all FIRBO MCP pilot and owner Qwen backup flags remain OFF.

### Source canary command (one tool-list read, owner terminal)

This command fetches a pinned GitHub branch without changing the checked-out production worktree. The exact commit must match before the script can run.

~~~bash
(
set -euo pipefail
SHA="<EXACT_REVIEWED_PR_HEAD>"
BRANCH="codex/firbo-omni-mcp-restricted-read-acceptance-20261010"

WD="$(docker inspect firbo-api --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
test -d "$WD"
REPO="$(git -C "$WD" rev-parse --show-toplevel)"
ORIGIN="$(git -C "$REPO" remote get-url origin)"
case "$ORIGIN" in
  git@github.com:conpol84/javris-clone|git@github.com:conpol84/javris-clone.git|https://github.com/conpol84/javris-clone|https://github.com/conpol84/javris-clone.git) ;;
  *) echo "REPOSITORY_NOT_VERIFIED"; exit 1 ;;
esac

git -C "$REPO" fetch --no-tags origin "$BRANCH"
test "$(git -C "$REPO" rev-parse FETCH_HEAD)" = "$SHA"
git -C "$REPO" show "$SHA:deploy/hostinger/firbo_omniroute_mcp_read_acceptance.py" | python3 -
)
~~~

Run `python3 - --read-health` in place of `python3 -` **only after reviewing the clean tools/list result**; it makes an actual read-only tool request, recorded in OmniRoute's existing audit. Do not print/paste the key or any provider result.

## After owner acceptance

1. Real tools/list names are mapped to the five allowlisted read-only operations. An explicitly approved health call must show success and increase MCP audit. Do not trust advertised tool names alone.
2. Confirm existing FIRBO `FIRBO_MCP_EGRESS_URL` and `FIRBO_MCP_EGRESS_TOKEN` are configured securely without printing secrets; they point to the pinned egress, not direct arbitrary user-controlled fetch.
3. Take a release/rollback checkpoint, then stage the existing FIRBO `mcp` function source from PR #142/#143 using **existing** Integrations, company roles and private credentials. Test unauthenticated access, non-platform-admin and foreign-company denial, and tool mutation denial BEFORE enabling the shared pilot. No new MCP backend or tables.
4. After deployment, only with owner acceptance, turn on `FIRBO_OMNI_MCP_PILOT_ENABLED` and require real FIRBO audit receipts. Unknown outcomes must not auto-retry.
5. Separately release the reviewed native Docker image from PR #139 onto Hostinger after resource preflight, rollback-tag and authenticated Qwen tenant isolation. The live FIRBO Docker image is still old and native route HTTP404.
6. The wider Master Issue #52 Stage 0–11 remains authoritative (CEO memory, real Mac/Debian control, voice, specialist agents, backups and restoration).

No change to A2A, skills auto-install, pricing, model routing, gateways, payment keys, production Vercel, Supabase or PickFantasy/TradeAthletes in this stage.
