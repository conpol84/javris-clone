# Chat memory quarantine — 8 October 2026

## Changed

Agent Chat now reuses the PR100 `memoryBlocks` filter. Legacy model-learned
notes (`metadata.source=learned`), any non-null deletion marker and expired or
malformed expiry values cannot enter its company-memory prompt. Organization
and global-or-own-agent predicates remain in the database query. Source/deletion
filters run before the importance ordering and 12-row limit, preserving slots
for eligible notes; the shared helper defensively filters returned rows too.
The prompt describes saved notes, without asserting every row was owner-approved,
and requires missing or conflicting evidence to be stated.

Existing memory rows are neither modified nor deleted. Current manual-memory
semantics remain; passing this filter does not independently verify a note's truth.
This is retrieval protection, not model training or a Mem0 installation.

## Tested / Passed

The old actual chat handler failed the new tests: invented revenue entered its
model prompt, and an all-quarantined fixture still produced a memory block.
The corrected handler passes 136 combined Node tests, including eight actual
language selections and an all-quarantined/no-block case. Auth, verified company,
agent predicates, manual-note preservation and zero memory writes are asserted.
Provider/SDK/database transports are executable test doubles, not real inference
or PostgreSQL acceptance. A dedicated pinned Node22.22 workflow reruns the suite.
Exact-head CI acceptance is recorded subsequently in the PR and Issue52.

## Failed / corrected

The intended old-handler regressions failed before the runtime change. A local
draft initially used `language` instead of the handler's `lang` input; corrected
before publication and each selected language is asserted in the actual prompt.

## Remains

Source-only. Live chat41 was read back at authoring and its entrypoint equals
the prior shared base; it has not received this change. Runner93 also still needs
the separately accepted PR100 release. No deployment, configuration, pricing,
permissions, database mutation, provider request or computer operation occurred.
The new shared import adds company-pulse.ts to Chat's complete runtime closure;
future release must generate and verify the complete bundle, preserving JWTfalse.

Mission runner has no direct memories-table read in the inspected source; this
does not certify meeting output, native consumers, task-result/history prose,
Knowledge provenance, factuality or physical/provider/business acceptance.
Owner review/promotion, role-specific evaluated quality, dedicated Mem0 accounting,
atomic publication, pinned service/vector filter behavior and real prices/receipts
remain separate gates. Mac/Debian/VirtualBox is excluded from this stage.
