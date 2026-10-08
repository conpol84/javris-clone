# FIRBO mission/meeting accounting candidate

This stage extends the released chat ledger to CEO planning, final synthesis,
meeting participants and meeting minutes. It continues the combined Claude/Codex
checkpoint at a823bcb. Source/automated checks are distinct from real-account
acceptance. No new upstream engine clone is needed.

Before each provider attempt, the company/employee reserves the conservative
UTF-8 input bound plus the actual output-token cap. Every fallback gets its own
reservation. Settlement atomically writes one usage row; unknown provider
results or lost settlement responses retain a review reservation. Free/BYOK
calls reserve zero Firbo dollars and remain rate counted. Each participant is
charged to its own agent, preserving the original speaker usage ownership.

The private ledger accepts only agent-chat and mission-runner sources. Existing
role, membership, enabled-agent, company-row lock, agent lock, ACL and empty
search-path rules stay intact. The new migration does not replay prior schema.

The limit now counts model attempts consistently across these routes, including
parallel speakers and fallback attempts. A meeting may have accepted speaker
calls before a later admission denial; those calls remain accounted even when
the meeting fails. An ambiguous previous attempt cannot disappear merely
because a fallback later produced a useful report. Receipts expose that review.

Local checks: 103 handler tests, 519 top-level non-rendered Node tests and strict
Edge TypeScript. CI applies stage 1, indexes, then this additive migration; it
retains original assertions and adds shared chat/mission quota assertions plus
two mixed-route concurrency checks under Read Committed and Serializable.

Release order: exact tested tree, current live dependency comparison, merge with
history, new migration once, mission-runner only, exact bundle read-back and
anonymous authentication boundary. No frontend update is needed.

Remaining: task-runner and speech ledger adapters, reconciliation monitoring,
real signed-in accounting receipts, second-company acceptance and every
remaining master-plan/device/OAuth/backup gate. Mission synthesis claim and
publication lifecycle is unchanged by this bounded accounting stage.
