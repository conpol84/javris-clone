# FIRBO CEO, VPS and company workers — 9 October 2026

The CEO submits the owner's original goal. The authenticated backend loads the
current company's worker inventory and asks the VPS which worker can perform
that operation. The VPS selects by capability, platform, current heartbeat,
permitted hours and queue load. An explicit device remains binding. The selected
worker executes through the existing durable Connector queue and returns its
correlated result. A successful selection or heartbeat is not task completion.

| Work | Executor | Completion evidence |
| --- | --- | --- |
| Existing server agent tools | VPS administrator or existing company sandbox | Existing tool and inference receipts |
| Native app/browser, mouse and keyboard goal | Online company computer with native desktop capability and Full Control | Stored goal, actual observations, final Connector receipt |
| File, explicit command, browser plan or app launcher | Company computer advertising the requested operation | Matching operation, parameters and durable receipt |
| Explicit Mac/Safari request | Compatible Mac from that company | Its own result; never a silent switch to Debian |

## Concrete changes

- OpenJarvis adds an optional API-key-protected `/v1/firbo/dispatch` selector. It
  executes no model, shell command or device action and holds no Supabase secrets.
- `computer-dispatch` authenticates an Owner/Admin, checks Business/Enterprise for
  advanced work, loads trusted inventory, previews the decision, then rechecks
  current authorization and forwards the original user's token to the Connector.
- Both CEO entry points use this path. The stored Voice laptop remains a voice
  preference, rather than an automatic worker assignment. An approved preview
  carries its request UUID and selected worker into dispatch.
- Employee computer and server tools also consult the VPS. Native employee goals
  keep task claims while work is pending. Each native observation rechecks the
  employee, task claim and computer power. Employee approval still uses Inbox.
- A request UUID is its Connector job ID. The original approved request is saved
  atomically beside the job. Retries reuse its first worker and cannot change an
  adapted app, goal, target or parameters. Lost acknowledgement never schedules
  replacement work. Stop targets the same known ID.
- Terminal employee results are published from correlated device receipts, not
  model prose. Blocked, stopped, incomplete and uncertain work remain explicit.
  Existing pricing admission, inference accounting and server sandbox rules stay
  on their current execution paths.

## Release order and operator handoff

This candidate retains shared `470724bedbcd9805ca305b3d5cfd6e01ed2a9abe`, parity
`ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` and native repair
`df6d86e95a65cb893aa6d5712d7fcb060e94eff2`. Do not re-pair or reinstall Debian.
The owner confirmed its native input repair and all three desktop vision/rate
settings. Password/login repair is complete; the requested management dashboard
is still a separate unfinished product item.

1. Require exact-candidate Python/auth/rollback, frontend, handler, source closure
   and stock PostgreSQL migration checks. Re-read coordination and live source.
2. Run the hash-pinned `deploy/hostinger/install-worker-dispatch.py --source SHA
   --apply` as `root@srv2027143`. The operator script verifies source, backs up
   owned files, enables only the administrator dispatcher, checks authenticated
   selection and anonymous denial, preserves runtime identity and box service,
   and rolls back a failed acceptance. It queues no computer task.
3. Apply only the new `worker_dispatch_native_approval` migration after checking
   applied migrations. Deploy complete reviewed bundles for Connector,
   computer-dispatch and agent-runner. Preserve existing JWT settings; the new
   user-session-only computer-dispatch has platform JWT verification enabled.
4. Deploy the exact frontend only after the VPS selector is available. Verify
   all six critical function closures, source/deployment identities and unchanged
   served Connector assets. Preserve the observed production rollback deployment.
5. Owner requests a real CEO goal, verifies the chosen worker's screen/result,
   receipt and physical Stop. Record actual evidence separately from CI.

## Evidence and remaining work

Local candidate checks: 673 frontend tests and production build; 24 Python
selector/auth/real-file rollback tests; 280 employee/handler/policy tests; 16
actual shared-helper/Edge dispatch tests; 9 Connector idempotency/approval tests;
17 terminal receipt/authorization tests; strict Edge TypeScript. Native approval
SQL passed against embedded PostgreSQL 17.5 with the actual prerequisite
migrations. Stock PostgreSQL and exact-source CI are release checks, not inferred
from embedded or mocked tests.

The current owner Debian advertises `desktop_task`/Full Control. Polis1984
(Macmini6,2, Catalina 10.15.7) advertises only legacy file/exec/browser_open
capabilities. Routing cannot install missing native Mac capabilities. That
compatible native adapter and its owner-device acceptance remain necessary.
This company-worker dispatcher does not turn private text-digest PR104 into
isolated cross-tenant platform workers, and does not complete the broader master
plan: management UI, useful business artifact/readback, OAuth/provider/customer,
off-host restore and operations/load acceptance remain tracked on Issue52.

No claim of physical task success, live rollout or full-plan completion follows
from this candidate document. Final exact source, CI and runtime states belong
in the coordination handoff.
