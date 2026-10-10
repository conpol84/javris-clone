# FIRBO One-System MCP — Real Omni 110-Tool Catalog Reconciliation

Source checkpoint: 2026-10-10. Branch stacked on Draft PR #143. No production changes.

## Exact owner readback

The previously reviewed ephemeral owner-only MCP probe (PR #143, SHA \`67cae030223b0e326180a1d177dc7ca8bad1e1f0\`) was executed on the owner Hostinger VPS with a dedicated MCP-only key in a hidden TTY. It returned the complete read-only inventory:

- \`advertised_tool_count = 110\`
- \`mcp_session_initialized = true\`
- \`mcp_tools_list_completed = true\`
- \`scope_enforcement_observed = true\`
- Exactly **five** allowed tool names are present: \`omniroute_get_health\`, \`omniroute_check_quota\`, \`omniroute_cost_report\`, \`omniroute_list_models_catalog\`, \`omniroute_list_combos\`.
- \`mcp_tool_called = false\` and \`firbo_pilot_changed = false\`. Not a provider authentication or scopes error. No actual tool execution/audit receipt yet.

## Actual defect in EXISTING FIRBO MCP Edge

The existing \`supabase/functions/mcp/index.ts\` (extended source in PR #141/#142) reads tools through \`listTools()\`, with a **hard stop when output reaches 100 items**. The shared OmniRoute gateway advertises 110 items. The existing caller *applied the five-tool allowlist after that 100-item stop*. If any of those five are placed after item #100, FIRBO silently loses them despite the valid MCP session.

This is **not** solved by the operator probe's own 100→256 change in PR #143; the actual company MCP Edge needs a corresponding safe fix.

## Scoped source-only solution — existing connector, not a second system

- Extract only the tool-discovery loop to \`supabase/functions/_shared/mcp-tool-discovery.ts\`; keep the existing \`mcp\` Edge function, \`integrations\`, stored secrets, company RBAC, plan limits, per-call human confirmation, \`audit_log\` and MCP egress transport intact.
- For **shared OmniRoute ONLY**, scan up to 256 distinct advertised names across at most 8 cursor pages, fail closed on duplicate/invalid advertised names, malformed or cyclic cursor, over-limit or incomplete pagination. **Do not store or return** the other ~105 tool descriptors or schemas, even if the remote gateway advertises them. Emit only the existing five read-only tool objects.
- For **all ordinary third-party MCP connections**, retain the previous 100 tool/5-page cap and duplicate/invalid-name skip behaviour.
- The existing platform-admin + organization-manager gates and \`FIRBO_OMNI_MCP_PILOT_ENABLED\` default-OFF remain in place. This change cannot enable the shared gateway itself and does not authorize any mutation or inferencing via OmniRoute MCP.
- Unit tests: 110 tools with all five approved names deliberately AFTER tool #100, 211 tools across cursor pages, exact 256 and 257 failure, invalid/duplicate/cyclic/incomplete response, giant schemas, and legacy third-party caps. Run existing Edge strict TypeScript + all frontend/voice/computer tests + build in GitHub CI.

## Next real gates

1. Owner separately executes PR #143 \`--read-health\` **once with explicit user action**, then checks that \`omniroute_get_health\` completed with \`read:health\` and appears in the existing OmniRoute MCP audit. The owner must not paste their key or private provider payload.
2. Verify operator-scoped \`FIRBO_MCP_EGRESS_URL\` / \`FIRBO_MCP_EGRESS_TOKEN\` existing egress configuration and independent negative tests for unauthenticated/non-platform-admin/foreign-company callers.
3. Stage this source through the **same existing FIRBO Edge** with rollback, then perform one real end-to-end FIRBO tool receipt. Only after that review consider setting the shared pilot flag. No automatic merge or production deployment from green CI.
4. Separate issue: live Hostinger FIRBO API Docker image is outdated and its native owner-scoped Qwen endpoint remains HTTP 404; the CI-built replacement is not yet deployed. Continue the existing source provenance and rollback plan before production promotion.

**One FIRBO CEO, one agent workforce, one company memory, one FIRBO ledger, and one existing MCP integration.** OmniRoute stays the operator-managed AI gateway. AgentSkills do not auto-install and A2A task execution remains disabled/not tested.
