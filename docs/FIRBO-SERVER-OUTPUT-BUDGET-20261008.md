# Native server output budget — 8 October 2026

## Changed

Continuation from shared `5fd365b82368c4d736285d88b14acba64ab1b6ec`, retaining
parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`. The owner supplied a live
routes.py SHA256 `a7f73bb266da83e01ced8faa6add7f295f087ca857908240a511df77e94bc8ad`,
identical to the inspected source. Both local services reported
firbo-quality/orchestrator/multi, loaded, with four/three tools respectively.

An explicit `max_tokens` together with `firbo_include_execution:true` now bounds
the sum of reported native orchestrator generation output across tool turns and
continuations. Each dispatch receives at most the remaining allocation; missing,
invalid or excessive usage prevents any subsequent dispatch through the wrapper.
Provider exceptions are not retried. Complexity scoring cannot enlarge this
explicit budget. Both streaming and direct-tools budget routes fail before work;
other agent implementations are not advertised as supported. Existing requests
without the explicit receipt-plus-cap combination retain their behavior.

The existing per-agent model lock protects engine/model/limit replacement for the
entire run. The original objects/settings are restored on both success and error.
Successful receipts use the wrapper's aggregate usage, including continuations
that ordinary orchestrator metadata previously omitted. A failed budget is an
HTTP502, never a successful task. Tools may already have run before a later budget
failure: preserve runner reconciliation and do not replay the request.

The rollout helper checks immutable source bytes, known installed baseline,
host/user/package identities and native services. It reuses the SHA-pinned prior
atomic updater, keeps a private backup, and restores originals on failed health
or verification. It runs actual installed handlers with a fake engine and reads
both live info endpoints; it never sends an inference request, changes prices,
provider routes, permissions, device pairing, service configuration or Supabase.
Only the two OpenJarvis services restart during an explicitly requested apply.

The native approval controller's exact bundle is updated to include the new
dependency. Use the matching controller when next issuing an exact-action grant;
an old downloaded controller intentionally refuses the changed runtime hash.
Grant semantics and approval-policy modules are unchanged. The standalone output
rollout does not search for or overwrite old operator scripts elsewhere on disk.

## Tested / passed / failed

Actual HTTP and native orchestrator tests cover continuation and tool-turn usage,
exhaustion with no next generation, malformed/absent/over-limit usage, exceptions,
concurrent per-request restoration, unsupported-route zero dispatch, complexity
and legacy compatibility. Temporary-file tests cover pinned bytes, modified and
linked helper refusal, installed selftest and rollback. Existing native approval,
receipt, runtime and concurrent model-override tests are retained.

Initial test fixture used raw OpenAI tool-call objects instead of the engine's
normalized name/arguments contract; corrected without relaxing tool-success
assertions. Native approval manifest regression caught the new dependency; its
complete installer bundle and verification were updated. Optional broader server
test collection lacked PyYAML locally; no claim for that unexecuted suite. Local
and exact-head CI counts/identities belong in the PR and Issue52 checkpoint.

## Remains

This bounds native agent engine dispatches/reported output, not provider internal
fallback charges, hidden reasoning usage, arbitrary model-calling tools, external
subagents or input tokens. A provider that violates its requested limit can incur
excess before the returned receipt is rejected; no refund is invented. Input
reservation currently derives from the initial payload, although an agent adds
system/tool/history content across turns. Actual heterogeneous-route pricing,
aggregate input admission and independent usage/invoice reconciliation are still
release gates; no execution flag is enabled by this repair.

Owner's firbo-quality catalogue contains Claude Haiku, OpenAI GPT-5.5 and three
Cloudflare-playground aliases. OpenAI lists input5/output30, without a confirmed
unit/billing contract in the supplied excerpt. No zero or uniform route pricing
is inferred. Provider auth rows were only partially supplied. Mac and Debian
tenant Connectors are online; private application-worker deployment, Mem0 and
all master-plan physical/business/provider/recovery gates remain separate.

No live rollout or whole-plan completion is claimed by this source checkpoint.
User receives an immutable, hash-checked manual command only after acceptance.
