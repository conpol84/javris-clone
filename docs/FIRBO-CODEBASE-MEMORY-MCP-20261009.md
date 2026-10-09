# FIRBO AI — Codebase Memory MCP evaluation & controlled adoption

**Date:** 2026-10-09. **Owner directive:** evaluate https://github.com/DeusData/codebase-memory-mcp, reuse as much as is useful, and carry it forward with existing FIRBO tools. **Master:** [Issue #52](https://github.com/conpol84/javris-clone/issues/52). This addendum does **not** replace or reopen the master plan, and is **not** a runtime deployment or a completed physical device acceptance.

## Decision

**ACCEPT as an optional, isolated source-intelligence MCP sidecar for authorized Engineering/Developer, QA, and later architecture-review agents. NOT as FIRBO's general chat/company memory, as a desktop operator, or as a shared multi-tenant machine with global access.**

Pilot the **complete reviewed executable and its useful MCP capabilities** in a separate non-production Linux developer runtime. Do not vendor its whole C engine into FIRBO/JS/Supabase, blindly run the upstream installer, or activate its 45 automatic agent-client configuration modifications on the production VPS. A full fork is permitted by MIT, but is not necessary for the first useful integration. We can selectively surface gated tool capabilities through existing FIRBO tools/agent policies after acceptance.

This is an optional addition after the current CEO→correct worker→actual artifact→read-back→terminal receipt→physical Stop gate; it does **not** supersede the critical path.

### Immutable upstream references verified

| Item | Evidence |
| --- | --- |
| Repo | `DeusData/codebase-memory-mcp` |
| Reviewed main snapshot (changes frequently) | `72a2c0bcbccfcff666cf46929c4f75e177584f54` |
| Latest published stable release in this review | [v0.11.0](https://github.com/DeusData/codebase-memory-mcp/releases/tag/v0.11.0), published 2026-09-15 |
| Stable v0.11.0 tag commit | `8972ea69c6ad94b1ef1d4ffbf0a92d78d2db1798` |
| License | MIT (retain copyright/permission notices if distributing any part) |
| Source evidence | [README](https://github.com/DeusData/codebase-memory-mcp/blob/72a2c0bcbccfcff666cf46929c4f75e177584f54/README.md), [SECURITY.md](https://github.com/DeusData/codebase-memory-mcp/blob/72a2c0bcbccfcff666cf46929c4f75e177584f54/SECURITY.md), [configuration](https://github.com/DeusData/codebase-memory-mcp/blob/72a2c0bcbccfcff666cf46929c4f75e177584f54/docs/CONFIGURATION.md), [index resource limits](https://github.com/DeusData/codebase-memory-mcp/blob/72a2c0bcbccfcff666cf46929c4f75e177584f54/docs/INDEX_RESOURCE_LIMITS.md) |

**Evidence caution:** Main's README advertises 162 languages, 17 MCP tools, local indexing and speed/token benchmarks. These are upstream claims, not measurements by FIRBO; today's main commit is newer than the stable release. Do not assume every main-branch feature has shipped in v0.11.0. Re-check exact binary, tools, licence, release checksums/Sigstore/SLSA and index format before each pilot.

## What to take, and what NOT to conflate

| Capability from CBM | Useful FIRBO application | Boundary |
| --- | --- | --- |
| `index_repository`, `index_status`, `get_architecture` | Code inventory, package/route ownership and evidence-based planning for Dev/QA | Authorized repository copy only; index isn't a finished production test |
| `search_graph`, `search_code`, `get_file_outline`, `get_code_snippet` | Find symbols and small relevant code snippets; reduce full-file reads | Filter secrets/vendor/generated code; company/repo ACL before returning snippets |
| `trace_path` (alias `trace_call_path`), `detect_changes`, `query_graph` | Trace CEO→dispatcher→Connector code paths and predict patch blast radius | Graph edges are analysis, not proven runtime behavior |
| Cross-repository `CROSS_*` linking and HTTP route graph | Review integration interfaces between explicitly owned repositories | Disabled by default; never link different companies' repositories/indexes |
| `manage_adr` / graph writes and watchers | Later optional engineering change-history and refresh | Not read-only; needs separate authorization, quotas and audit |
| Graph UI on localhost:9749 | Developer-only diagnostics on a controlled host | Never expose directly to internet or to Business+ customers |

**Not a replacement:** FIRBO/Supabase company-scoped Memory, owner instructions, OpenJarvis native Rust Memory (currently has an independent 503 problem), task/job receipts, accounting, OmniRoute model selection, Tavily web research, AgentReach source adapters, Agency Agents personas, scheduler, approvals, Mac/Debian native input or authorized physical Stop. Codebase graph data should be versioned `repo + SHA + path + symbol` and cited as source evidence, not written to customer Memory as unbounded raw source.

Existing external tools remain separate: OpenJarvis (runtime/admin), OmniRoute/firbo-quality (model selection), Tavily (online research), AgentReach (optional source adapters), Agency Agents (select curated role templates, separately reviewed PR #116), and **Codebase Memory MCP (repo/call-graph intelligence)**. One specialized tool should not become an unrestricted path around existing FIRBO permissions.

## Staged adoption (after current execution acceptance)

**A — Source/vendor security review (no deployment):**
- Pin one stable archive and its checksum and compare to published provenance, verify MIT notices, release SBOM, target CPU architecture, glibc and resource assumptions.
- Inspect installer/config writes: upstream `install` can update detected agent configurations, skills, hooks and persistent daemon; the daemon is shared per OS account and installer may stop active sessions. Never run `curl ... | bash` on VPS root or an owner machine, and never auto-update from unreviewed main. Prefer verified binary-only `--skip-config` in a disposable staging environment.
- Upstream SECURITY.md acknowledges a **best-effort GitHub release update check** at MCP initialize. Do not describe it as absolute zero network, even though code/graph/query data is processed locally. Restrict network egress and inspect on-host logs.

**B — Isolated proof-of-use, not customer facing:**
- Linux x86_64, dedicated unprivileged service identity; only an isolated checkout of `conpol84/javris-clone` at a known commit, **not the entire VPS filesystem**, and no production secrets/.env/SSH keys/tokens. Keep Mac Catalina out of this initial pilot.
- Force `CBM_ALLOWED_ROOT` to the exact permitted checkout parent, `CBM_CACHE_DIR` to a private per-service directory with correct Unix permissions, and disable default watchers/auto-index until measured (upstream `auto_index` defaults false; `auto_watch` and `watcher_enabled` default true). Configure finite `index_max_files` and `index_max_source_mb`; bound CPU, RAM, wall time, process count, log retention and disk.
- Start with manual, read-only index/query and UI disabled. Avoid broad user-shell MCP setup. Store reports/provenance with `repo@SHA` and **no environment-secret values**.

**C — Reviewed FIRBO integration:**
- Add a server-side MCP/tool adapter only if pilot evidence is green. Whitelist exact read-only tools initially; pass trusted `organization_id`, owner/member role, repo ID/revision, agent/tool policy and budget from FIRBO server, never from model-authored prompt alone.
- Repository allowlist and indexes must be isolated by tenant/organization, project and ACL. Personal owner repositories and personal Debian/Mac devices are **never** pooled for other customers.
- Backend applies request IDs, timeouts, cancellation/Stop, output caps, audit logs, error receipts, source hashes and model token/cost accounting; code snippets are data and cannot instruct a model to escape security boundaries.
- Agents: Developer + QA first. CEO delegates a scoped architecture question to the specialist and reports **actual tool results**, not invented success. AgentReach/Agency Agents cannot grant tool credentials or more rights.

**D — Acceptance before enablement:**
1. On one pinned repo, `index_status` reports actual indexed revision, bounded resource usage and no unsupported symlink/path escape.
2. Two real queries: (i) trace an explicit CEO command through `useCeoSession` → `laptop-bridge` → `computer-dispatch` → `connector`; (ii) assess the blast radius of a focused source-only patch. Verify returned path/symbol/line evidence against GitHub bytes.
3. Compare same tasks with/without CBM: correct symbol coverage, total inference/tool calls, token usage, response latency, index duration, RAM, CPU, disk, and cost. Performance numbers are measured on FIRBO; upstream marketing metrics are not acceptance.
4. Try non-member cross-tenant access, revoked grants, wrong repo/commit, poisoned source content, symlink escape, oversized repo/output, cancellation, daemon restart, unavailable index and concurrent requests; fail closed, no hidden fallback.
5. Record source pinned hash, tool/binary versions, test failures and rollback. Only then opt in Engineering/QA in stages; full MCP/read-write/ADR/auto-watcher functions need new reviewed gates.

## Current CEO/desktop evidence (not resolved by this MCP)

At the 2026-10-09 UTC backend check, owner's company `45e05812-a860-489e-b758-1f16be8c2db8` had two real `desktop_task` runs on **My shell / Debian**:

| Job ID (prefix) | Actual times UTC | Observed row / receipt | Limitation |
| --- | --- | --- | --- |
| `ae2a3d2d` | 16:26:01–16:27:03 | `status=done`; `result.completed=true`; 10 observations / 9 actions; matching receipt/hash | Summary said Firefox opened but screenshot remained black; visual proof of useful browser content **absent** |
| `c2bcec20` | 16:28:04–16:30:31 | `status=done`; `result.completed=false`; 24 observations / 23 actions; matching receipt/hash | Light-locker/black screen; **no verified YouTube playback** |

These two runs produced **34 settled desktop vision/accounting calls**, average **2,999 ms inference latency** (max 5,627 ms) and **$0.70743** in FIRBO's recorded internal accounting for 16:25–16:32 UTC. This is neither a provider invoice nor end-to-end task timing. Repeated observe/plan/action round trips plus screen lock caused delay. A terminal `Connector` receipt proves the job was processed; `result.completed=false` means the *user's objective failed*. No amount of code search fixes locked-screen capture.

The owner later messaged the CEO that the shell was unlocked (16:32 UTC), but no subsequent physically confirmed successful playback was observed in that backend snapshot. A later Greeklish music request (16:33 UTC) fell through to the model's inaccurate generic claim that desktop control was unavailable. Treat **Greeklish direct-command recognition** as a separate focused frontend regression after the latest PR #117, not a reason to roll back its stable patch. Do not run a new device task without the owner's authenticated execution flow.

**Next execution priorities inside Master #52, in order:**
1. Re-validate unlocked X11 display/visible screenshot on Debian via owner-approved normal device flow; never bypass or automatically disable the OS lock. Detect repeated unusable/black frames early and terminate as `blocked`/`failed` *without unnecessary vision loops*; verify model/worker Stop and useful result.
2. Present physical job status and goal completion separately in UI: terminal `done` with `completed:false` is not success. Preserve receipt; independently verify visible site/title and playback progress.
3. Route current Greeklish owner commands to the correct company worker or explicit clarification instead of hallucinated CEO inability/delegation. Keep full target and no silent Mac/Linux substitution.
4. Continue native Rust Memory 503, native Mac Catalina compatibility, Tavily key/usage, voice, multi-customer isolation, encrypted off-host restore drills and other Master #52 gates.
5. Only then pilot CBM in staging and enable reviewed code-intelligence capabilities.

## Stage checkpoint / evidence tier

**Changed:** External repo evaluated, source/release/license/security/config pinned, integration plan and safe pilot gate specified in this addendum. **No executable installed or customer functionality changed.**

**Tested:** Official GitHub main/release/source/SECURITY.md/config docs read; FIRBO real Supabase job and inference rows inspected; current worker source and desktop planner inspected.

**Passed:** The *assessment* supports optional isolated read-only MCP for Developer/QA. Real Debian job queue/receipts are operating at the backend evidence tier.

**Failed / unknown:** No CBM binary, MCP tools or perf benchmark executed on FIRBO; no proven locked-screen playback or physical Stop; no new live client acceptance. Production “done” can still mean objective incomplete. Stable v0.11 vs main behavior not yet benchmarked.

**Remains:** Resolve physical desktop/true success/latency first, then independent pilot under strict ACL/resource controls. Always leave Claude/Codex branches, PR #116 specialist work, PR #114 and PR #117 release ancestry untouched until explicit reconciled ownership.
