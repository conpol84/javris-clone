# FIRBO cross-chat coordination and release checks

Owner directive, 7 October 2026: finish the existing master plan while retaining
both Claude and GPT work and coordinating active chats. Issue #52 remains the
master plan. This document does not create a second project plan or grant new
provider, device, account, network or credential access.

## Active work and release ownership

1. Read current Issue #52 **body and comments**, AGENTS.md and the collaboration
   rules. Check the actual shared and parity branch heads, open PRs and relevant
   worktrees. Another worktree's name is evidence of activity, not an agreement.
2. Add an Issue #52 coordination comment with a unique session/branch label,
   UTC timestamp, base commit, exact file scope, status, release owner and expiry.
   Use a separate worktree. Prefer adding/updating your own comment over replacing
   the entire Issue body, which can lose another chat's concurrent edits.
3. Read other active claims before editing overlapping files. Ask for an explicit
   handoff in the issue when scopes conflict. An unacknowledged comment is only
   a declared claim: it does not notify, lock or control another chat.
4. Preserve all newer shared/parity work as actual Git ancestry. Never force-push,
   discard dirty files, reset another worktree or silently use an older copy.
   Re-read GitHub refs after a rejected expected-head operation.
5. One designated session releases a given candidate. Right before release,
   re-read active claims and branch heads. Changes require renewed reconciliation,
   combined tests and an exact-source preview. Do not independently redeploy an
   earlier frontend while another session is releasing newer code.
6. Complete each claim with Changed / Tested / Passed / Failed / Remains, exact
   source/deployment identities and the next owner's scope. Release the claim.
   A stale/expired claim requires reading actual state before takeover, not a
   silent assumption that another session's work disappeared.

This is advisory coordination, not a cross-chat messaging service or atomic lock.
Git expected-head writes and exact source checks provide additional safeguards.
Never merge PR13; leave unrelated product repositories and Supabase projects alone.

## Read-only release tool

`tools/firbo-release-check.mjs` reads immutable Git source. It never deploys,
executes a task, enables services, grants permissions, reads credentials or changes
provider configuration. It covers the five critical production Edge functions:
agent-chat, agent-runner, connector, integrations and mission-runner.

Source closure (also exercised in CI):

```bash
node tools/firbo-release-check.mjs --source FULL_COMMIT_SHA --source-only
```

Before an **already-authorized** function deployment, generate its complete
payload from that exact accepted commit, avoiding hand-selected dependencies:

```bash
node tools/firbo-release-check.mjs --source FULL_COMMIT_SHA --bundle agent-runner > /tmp/firbo-agent-runner-payload.json
```

Inspect the current live function and compare it first. Pass the complete payload
to the Supabase deployment tool only for the exact FIRBO project and only when a
reviewed change needs deployment. Preserve the observed per-function JWT settings:
mission-runner has platform `verify_jwt:true`; the other four use `false` and
authenticate inside their handlers. Any change requires review. A generated
payload is not deployment permission or a live test.

After deployment, capture fresh provider read-backs for **all five functions**,
the READY production frontend identity/aliases, and actual HTTP 200 SHA-256 hashes
of the three served public assets. Use the provider tools; do not substitute
expected source bytes for observed live bytes. Keep the snapshot private/temporary;
it contains function source, not provider keys or user task data.

Evidence shape (field names are exact; example placeholders are invalid values):

```json
{
  "schema": "firbo-release-evidence/v1",
  "project_id": "bfeinnsorgjycivozcau",
  "repository": "conpol84/javris-clone",
  "captured_at": "FRESH_UTC_ISO_TIMESTAMP",
  "source_commit": "FULL_ACCEPTED_COMMIT_SHA",
  "shared_head": "OBSERVED_SHARED_SHA",
  "parity_head": "OBSERVED_PARITY_SHA",
  "functions": ["FIVE_UNMODIFIED_GET_EDGE_FUNCTION_OBJECTS"],
  "frontend": {
    "deployment_id": "ACTUAL_DEPLOYMENT_ID",
    "state": "READY",
    "target": "production",
    "source_commit": "OBSERVED_VERCEL_GITHUB_COMMIT_SHA",
    "aliases": ["firboai.app", "javris.firboai.app"],
    "assets": [
      {"name":"FIRBO-Mac-Browser-Update.command","status":200,"sha256":"OBSERVED_SHA256"},
      {"name":"firbo-connector.mjs","status":200,"sha256":"OBSERVED_SHA256"},
      {"name":"firbo-browser.mjs","status":200,"sha256":"OBSERVED_SHA256"}
    ]
  }
}
```

Run the post-release comparison:

```bash
node tools/firbo-release-check.mjs --source FULL_ACCEPTED_COMMIT_SHA --evidence /tmp/firbo-release-evidence.json
```

The command independently reads current shared/parity refs with `git ls-remote`.
It fails if the repository/project is wrong, a head moved, either contributor is
missing from ancestry, evidence is older than 15 minutes, function files are
missing/extra/duplicated/different, deployment metadata is incompatible, frontend
code differs, or any served asset differs. A documentation/tooling-only commit can
keep the existing frontend if the complete `frontend` subtree is unchanged and its
production source remains an ancestor. No unnecessary production rebuild follows
from this tooling change.

A pre-deployment parity failure may identify the exact planned changes; it does
not mean replacing evidence with expected bytes. Deploy only reviewed complete
bundles in backend-first order, then collect new evidence and require a passing
post-release check. Run the relevant actual HTTP boot/auth probes separately.

## What green means

Passing means source/deployment parity for the captured state. It does not prove
live owner login, model/provider work, physical Mac control, playback, useful
artifact/read-back, invoices/pricing, OAuth, another customer, backup or restore.
Evidence is operator-collected, not a cryptographic provider attestation. Snapshot
freshness reduces races; it cannot eliminate a concurrent deployment after capture.
External supervision/TLS/secrets/build environment remain separate release gates.

## Initial checkpoint — 7 October 2026

**Changed:** declared release-control ownership on Issue52, isolated from the
observed CEO-command worktree; added immutable-source bundle generation and fresh
five-function/frontend/asset reconciliation; linked coordination from AGENTS.md.

**Tested:** focused tests reproduce missing runner dependencies, old Connector
code despite a newer version label, moved branch heads, missing ancestry, wrong
project, stale evidence, duplicate files, preview/asset mismatch, transitive imports
and exact committed bytes in a real disposable Git repository.

**Passed:** 15 focused tests and source closure for all five functions (8/16/2/4/4
files) on shared 7e67c9e8. Final exact-head CI and fresh production read-back are
recorded in the associated PR and Issue52 coordination comment.

**Failed / corrected:** the initial real-snapshot check rejected mission-runner's
platform JWT setting. The generator/checker now preserve its existing `true`
setting independently from the other four functions; no live setting was changed.

**Remains:** no runtime/UI behavior is changed here. Other chat's scope
requires explicit acknowledgement; do not claim direct communication from this
file. Physical Mac compatibility/playback, authenticated UI, VPS/service/provider,
OAuth, customer and recovery gates remain open. Supabase is accessible directly by
its exact FIRBO project ID even when its project-list response omits FIRBO.
