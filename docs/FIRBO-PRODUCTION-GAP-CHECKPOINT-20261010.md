# FIRBO AI — Source + Live Gaps / Coordinated Finish (2026-10-10)

**Master:** [Issue #52](https://github.com/conpol84/javris-clone/issues/52). **This file extends, not replaces, the master.** Do not start audits from zero or silently claim untested production capability. Do not overwrite Claude/Codex PRs.

## Real platform snapshot (FIRBO Supabase project `bfeinnsorgjycivozcau`)

These are read-only, live PostgreSQL checks on 2026-10-10. Counts can change:

| Subsystem | Verified live facts | Honest implication |
| --- | --- | --- |
| CEOs | One enabled CEO per company in three companies; owner company has 52 CEO conversations | **One CEO identity exists**. The two visible CEO experiences were losing the chosen active session; PR #124 fixes the client pointer and validates against owner-scoped DB rows |
| Memory | 31 rows, 30 ownerless `source=learned` proposals, one owned manual memory, 0 embeddings | Safe owner-only RLS policy (SG-MEM-01) live, 30 proposals protected. No automatic trusted company sharing or actual semantic/vector search yet |
| Inference | `agent-chat` v50 ACTIVE; `agent-runner` v101 ACTIVE | New service-role reads are explicitly scoped to authenticated user. Agent-runner was redeployed as complete pinned 19-file import closure, **not** a single-file patch |
| Skills | 52 enabled skills | Catalog/persistence exists, but enabled skills alone are not proof a specialist produced a work artifact |
| Agency specialists | PR #116 source and its reviewed adaptation integrated into stacked PR #124, not PR #116 modified | Five professional methods for new Research/Developer/QA/DevOps/Content hires only; no silent changes to existing employees or extra permissions |
| Workflow engine | 0 workflows, 0 workflow runs | Native engine exists in source, but the actual user company has no live, recurring workflow configuration |
| Connected apps | 0 integration rows | Live Gmail, Outlook, Telegram, WhatsApp, social, Google Sheets, Slack, Discord and automation acceptance **not completed** |
| Knowledge | 0 knowledge sources/chunks | Codebase Memory MCP is only a reviewed candidate (PR #118); not running as a cross-company service. No real indexed knowledge to search |
| Mac | Polis1984 paired, Catalina 10.15.7, `browser_open` but no reported `full_control` | Full native desktop/browser task, pointer and screenshot on this actual Mac **not accepted**. Current Playwright updater requires newer supported OS; do not suggest unsupported Catalina macOS upgrade |
| Debian | My shell paired/heartbeat, full control reported, desktop_task supported | Physical YouTube media clock/voice and cold reboot/X11 login/linger not independently verified; old local_operation_failed job must not auto-retry |
| Backups | No encrypted off-host restore acceptance evidence | Database and server images need verified encrypted export, remote copy, isolated restore timing, documented revocation/rollback |

## What has now been implemented on this stacked branch

1. **One person, one company, one CEO record.** AI CEO + Talk overlay recover the same explicitly selected personal conversation, and Agent Chat can enter it through `/chat?ceo=1`. Client pointer contains *only an ID*, scoped to organization/user/agent, never a transcript. It must match freshly scoped server conversation rows or is discarded.
2. **Owner-scoped memory.** The live Edge inference code (agent-chat v50, runner v101) has the fail-closed PR #122 user filter, including runner `memory_search`. Model-learned NULL-owner rows remain unaltered and unavailable to normal answers. No freeform `metadata.visibility` self-attests company sharing.
3. **Bounded historic recall.** CEO searches up to 60 own historical sessions and 440 historical message rows in two bounded reads, while the actual answer prompt still limits historical context to 1,700 characters. This is *keyword/salience* recall, not Mem0 or semantic/vector memory. Past AI claims are labeled unverified.
4. **Specialist methods.** Five pinned, MIT-attributed PR #116 adaptations are shown in Store/HireDialog, affect **new hires only**, retain underlying template IDs/tool policies/plan gates, and never execute upstream code.
5. **Regression gates.** Personal-session selection across org/user/agent, malicious/stale local pointers, ownerless legacy exclusion, exact 19-file runner release closure, full frontend/build, real rendered specialist HireDialog with synthetic plan/auth, and tenant-safe read boundaries.

## Remaining work by original Master Issue #52 (do not lose any)

- **Stage 1–3:** Mac Catalina-compatible local native executor with owner-granted accessibility and proof; Debian physical video-playing/timing + Stop; owner-authenticated website → assigned worker → real file/artifact → independent read-back SHA-256 → terminal receipt. Keep server/VPS, Mac and Debian separate; no raw secrets or uncontrolled remote execution.
- **Stage 4:** Private MCP ingress and egress allowlist, live tool permissions and receipts, provider catalog + real per-token prices, OpenJarvis Rust Memory 503 root cause, accounting/reconciliation and honest errors. Do not conflate codebase graph with human company memory.
- **Stage 5:** Google and Microsoft OAuth refresh/revocation on both domains, Gmail/Outlook/Drive/Calendar/Sheets, Telegram & WhatsApp signatures/two-way approvals, Slack/Discord/Teams, GitHub/Notion/Linear, n8n/Zapier/Make and selected socials. Requires external provider authorization and full account-scoped tests; none is populated live as of this snapshot.
- **Stage 6:** CEO meeting → delegated agent task → actual result → CEO synthesis, durable workflow execution and schedules, skill edit/removal and scoped tool permissions, safe reviewed fact promotion and shared-company ACL for legacy 30 rows; Mem0 semantics + provenance, Codebase Memory MCP pilot in segregated repo runtime, Superbrain and local Mac recovery model after real benchmarks.
- **Stage 7–9:** Real mic/TTS/hands-free and local browser fallback on phone; second **real** customer and multi-account RLS tests; status/UX consistency across chat, overlay, mobile and desktop; access review, prompt-injection and financial approval policy checks; check Supabase Auth leaked-password protection.
- **Stage 10–11:** Encrypted DB and VPS/config backups with off-host copy, isolated restore and elapsed-time evidence; alerting and load/failure drills (gateway/model down, DB off, VPS offline, Mac offline); GitHub PR/source reconciliation. PRs #116, #118, #121, #122, #123, #124 are stacked/draft or separate; do not force-merge a 791-commit divergence into main. Exact source/function/deploy and rollback read-back before release.

## Mandatory stage checkpoint

**Changed:** Source changes only where explicitly mentioned. **Tested:** Only current-turn exact-head CI and read-only/live readbacks count. **Passed:** Only confirmed CI and deployed versions. **Failed:** Any physical use, external connector or restore not tested is *NOT TESTED*, not PASS. **Remains:** All items above until independent receipts exist.

Never disclose Tavily, gateway, GitHub or device tokens in issues, source or responses. Prior exposed Tavily URL token requires rotation before launch. No automatic external social posting, writes, funds movement, or unattended device privilege escalation.
