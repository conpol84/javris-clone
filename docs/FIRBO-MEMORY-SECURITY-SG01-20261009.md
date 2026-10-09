# FIRBO SG-MEM-01 — Memory isolation, source audit and acceptance

Date: 2026-10-09. Master Issue #52. Base: released CEO Sessions commit abaeee8bdaf9b8f2961460595fe15b10aacee24f. This branch is not a production rollout.

## Verified live findings

- `public.memories` has columns `organization_id,user_id,agent_id,content,memory_type,importance,metadata,embedding,expires_at` (plus IDs/timestamps). Last reviewed 31 rows: 30 without user_id; 30 with agent_id. The live SELECT policy `members read` checks only `private.is_member(organization_id)`. INSERT/UPDATE allow any member of the organization; DELETE allows owner/admin/manager. This is insufficient for personal privacy or integrity of shared memory.
- `supabase/functions/agent-chat/index.ts`, circa lines 212-224: service client queries organization memory and matches agent, expiration and learned source. It then admits `m.user_id===user.id || m.user_id===null || (m.memory_type==='company' && m.metadata?.visibility==='company')`. Null user_id is not evidence of sharing. This is a separate backend leak risk even if RLS is corrected because the admin client bypasses RLS.
- `frontend/src/lib/company/data.ts`, circa lines 455-470: `seedCompanyMemory` writes profile-derived company/project rows with current user_id but no explicitly trusted shared visibility. A new RLS rule must not suddenly break legitimate company profile setup.
- `agent-chat` already excludes learned-source memories and deleted/expired records from prompts. Preserve the quarantine and audit the full learned promotion lifecycle.
- Existing owner instructions and agent-scoped/global memory must remain functional. Distinguish global-to-user agent notes from explicitly company-shared notes.

## Required authorized visibility model (design, not yet implemented)

1. Personal: visible and mutable only to owner `user_id=auth.uid()` in their organization; admin must not automatically receive private CEO memory.
2. Shared organization: visible only if explicitly promoted via a server-authorized trusted workflow (not user-editable metadata alone); write restricted to authorized org roles with ownership/provenance checks.
3. Agent-targeted: same rules as private/shared, plus assignment validation and company fencing.
4. Learned/unverified, tombstoned and expired: never automatically promoted to shared or injected into model context.
5. Existing user_id NULL rows: quarantine until classified by provenance, never blanket-share them.
6. Both direct authenticated Data API and service-role Edge requests must enforce the same visibility rules.
7. Mutation must prohibit changing user_id, organization_id and trusted visibility provenance through arbitrary member writes.

## Build and verification gates

- Inventory all frontend, Edge and RPC memory callers and metadata migrations on the exact candidate SHA.
- Stage migration alongside versioned policy tests, tenant A/B and same-company user A/B, roles owner/admin/manager/member; positive and negative SELECT/INSERT/UPDATE/DELETE tests; forged metadata, spoofed owner, reassigned org and user, expired/deleted/learned records.
- Test `seedCompanyMemory`, manual owner memory, global/per-agent retrieval, CEO session recall, owner instructions and no other-user prompts. Verify JWT-path tests, not only service-role bypass tests.
- Stage backend query fix and compatible UI/seed updates in one coordinated source SHA; frontend tests, Edge typecheck, full CI and sandbox DB RLS harness must pass before live migration.
- Capture production DB backup/rollback and exact deployment ownership; no force push or cross-chat overwrites. After release: validate authenticated allowed/denied queries + Edge chats, advisor and Vercel/Supabase logs, record Changed/Tested/Passed/Failed/Remains in Issue #52.

## Related gates tracked separately

- Auth leaked password protection, eight executable SECURITY DEFINER warnings: audit each RPC rather than blanket revoke.
- Physical Debian CEO browser/playback/Stop, Mac Catalina input/capture, native OpenJarvis Rust memory 503, Mem0 and Codebase Memory MCP pilots: not fixed by SG-MEM-01.
- No changes to TradeAthletes, PickFantasy, VPS, paired devices, keys or customer data.

## Checkpoint

Changed: source-audit and acceptance contract on isolated branch.
Tested: live schema/policies, candidate `agent-chat` and `seedCompanyMemory` source reads.
Passed: identified two independent memory-isolation failures and a company-memory compatibility edge case.
Failed: full two-user/two-tenant authenticated harness not run; no live RLS fix exists.
Remains: coordinated implementation, tests, migration, rollout and physical owner validation.
