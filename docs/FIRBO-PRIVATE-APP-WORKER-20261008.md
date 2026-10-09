# Private FIRBO application worker — 8 October 2026

## Changed

Owner decision: macOS is his personal computer; Debian is a separate private
application worker helping the server. Website tenant-Connector pairing remains
unchanged and is not converted to cross-tenant access.

`deploy/worker/firbo_worker.py` provides an executable, standard-library-only
private coordinator and pulling client. This first version accepts only bounded
`text_digest` jobs: UTF-8 SHA256, byte count and character count. It establishes a
real transport/queue/receipt baseline before adding expensive or privileged work.
It is not yet a build runner, model/embedding service or universal desktop executor.

The coordinator persists up to 100 jobs in SQLite with atomic admission/claim,
one active lease, immutable job identities, fixed administrator-approved company
scope, duplicate-result acceptance and cancellation serialized with publication.
Expired queued/running jobs become `review_required`, never automatically retried.
Separate long random admin/worker bearer credentials prevent the worker from
creating or inspecting admin jobs. Worker scope also validates the company and
worker identity received from the server. Lost completion ACKs resend a cached
receipt without claiming or computing another job. Changing the configured
endpoint/company/worker cannot send old cached receipts to a new scope.

No command, file path, provider request or destination URL is accepted in a job.
Both private processes use explicitly prepared non-root users and private
directories/configuration. The coordinator binds loopback only with 8 active
connection slots, bounded request/result sizes and a five-second connection
watchdog. Client TLS verification stays enabled and redirects are rejected.
HTTP is allowed only at literal loopback addresses for an authenticated SSH tunnel
or local acceptance. DNS/pre-socket timeout is not universally certified.

## Tested / passed / failed

17 local Python3.12 tests pass using actual SQLite, threads, temporary private data,
actual HTTP coordinator and actual worker client. They cover duplicate/conflicting
admission; Unicode/size/expiry bounds; unsupported shell/provider/path and tenant
denial; concurrent single lease; offline lease expiry without requeue; Stop vs
publication races; forged identities/results; duplicate receipts; lost ACK cache;
changed endpoint/scope rejection; malicious job scope rejected before computation;
independent server-side hash readback; separate credentials; duplicate HTTP auth;
private configuration and symlink refusal; immutable persisted queue scope; TLS/redirect rules. No physical Mac,
Debian, deployed VPS, provider or paid operation was tested. Exact-head CI runs the
suite on Python3.11/3.12/3.13. Final source identities/status are in the PR/Issue52.

No previous implementation is replaced. Initial local tests passed; added
Unicode transport-envelope and cached-scope regression checks also pass.

## Installation handoff (not performed)

Use the accepted immutable commit from the PR, never an arbitrary default-branch
download. Coordinate with the existing Mac/VPS chat. Do not repeat device pairing,
native artifact acceptance, OS installation, partitioning or permissions changes.

1. VPS operator prepares a dedicated unprivileged service user, a private0700
   state directory and a private0600 server JSON config. Choose a distinct worker
   UUID, authorized company UUID list and two independently generated random
   secrets (at least43characters; e.g. Python `secrets.token_urlsafe(48)`). Store
   secrets in the private config files, never Git, browser, command arguments or
   chat. Server config fields are `worker_id`, `organizations`, `worker_token`,
   `admin_token`. Existing services and FreeLLMAPI remain untouched.
2. Debian operator prepares a separate unprivileged worker account/state0700
   and private0600 config containing `worker_id`, `organizations`, `worker_token`
   and `server`. It must not contain the admin credential or Supabase service-role
   key. `server` is the actual reviewed HTTPS origin or the loopback origin of a
   separately authenticated, restricted SSH forwarding channel. Do not expose
   port8095 publicly or invent a working TLS domain.
3. Run the coordinator as its non-root user from the pinned checkout:

   ```bash
   python3 deploy/worker/firbo_worker.py server --config /actual/private/server.json --state-dir /actual/private/server-state
   ```

4. Run one acceptance attempt on Debian as its worker user:

   ```bash
   python3 deploy/worker/firbo_worker.py worker --config /actual/private/worker.json --state-dir /actual/private/worker-state --once
   ```

   With no job the result must be `idle`. An administrator then creates one
   harmless `POST /jobs` from the trusted private server using the admin token,
   unique job UUID, an approved `organization_id`, `kind:"text_digest"`, known
   non-sensitive `text` and `ttl_seconds:120`. Run the worker once again. Read
   `GET /jobs/JOB_UUID` separately with the admin credential and compare its hash
   independently against the exact source text. The worker must report accepted,
   the coordinator done, and the independent SHA must agree. A text-digest receipt
   is not a saved user-file artifact or a provider invoice.
5. Test `DELETE /jobs/JOB_UUID` before completion and disconnection/lease expiry;
   neither must publish success or auto-retry expired work. Only after this real
   acceptance, configure reviewed supervision/restart/log limits and operator
   shutdown. The client exits on network/receipt errors with its pending cache
   retained; it does not secretly continue or retry a different job. A reviewed
   restart may resend the same cached receipt. An expired cache needs operator
   reconciliation, not automatic deletion or a replacement job.

Paths above are explicit placeholders: deployment cannot be marked complete until
actual paths, users, origins/tunnel and private credentials are prepared and the
real receipts are read back. This session has no working VPS/SSH execution access.
No installer, firewall, service, credential or device job was performed.

## Remains

This is a bounded private bootstrap, source-only. Queue retention deliberately
halts new admission at100entries; reviewed tombstone/retention/monitoring/backups,
key rotation/revocation, encrypted data protection and load evaluation are still
needed before long-running production workloads. Initial fixed company scope is
an administrator configuration, not a dynamic application membership/RLS check.
The FIRBO API/CEO adapter that authorizes current company jobs and routes work to
this coordinator is not installed or implemented here. Do not expose its admin
API to website clients or treat tenant Connector pairing as platform enrollment.

The only executable work is deterministic bounded text digest. If interrupted
before receipt caching, the same still-valid lease may recompute this pure digest;
it cannot write customer files or repeat model/tool side effects. General-purpose
executors need separate durable pre-dispatch/ambiguity accounting and sandboxing.
Stop blocks result publication but is not an OS/process kill switch for future
long-running work. There is no model, build, arbitrary code, camera/microphone,
mouse/keyboard or GitHub/Vercel/Supabase credential access from this worker.

Preserve pending PR100–103 backend release/pricing/live-byte gates; Memory review
and semantic quality; Mem0 DB accounting/atomic publication/service/vector/quality;
personal desktop/media; website-native receipt; MCP/page ingress; provider/OAuth/
customer/business/voice/signed OS/offhost restore/load gates. PR103 all18merge
families passed; no redo. Production unchanged, no full-plan completion claim.
