# Browser response budget repair

## Evidence and scope

Owner-approved CEO job `6cbc7b20-27e7-4bd7-9d1b-4f72c4a7d090` on Debian
`My shell` failed on 9 October with `browser_transfer_too_large`. Its durable
receipt reports failure. Selection, approval and dispatch reached the computer.
The old transport applied the same 4 MiB limit to every HTTP response and to
file transfers/captures. A separate unauthenticated fetch of the current YouTube
search page found a script of 10,836,937 bytes. The job itself does not record
the offending URL, so this is supporting reproduction evidence, not an exact
capture of that request or successful playback.

Based on shared `470724bedbcd9805ca305b3d5cfd6e01ed2a9abe` (merged PR109),
retaining parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`.

## Changed

Browser-reported document/script/stylesheet requests receive a bounded 16 MiB
response allowance. Other requests, request bodies, explicit downloads, uploads
and screenshots retain their 4 MiB allowance. The task-wide 80 MiB response-byte
budget is now charged on incoming chunks, shared by concurrent requests and
explicit downloads. Failed requests do not refund bytes. Injected transports
are checked too; streaming reports are not counted twice. Oversized response
streams are destroyed and no further chunks are retained. The first network
failure is retained when other requests also fail.

DNS pinning/private-network rejection, scope, local/owner approval, sensitive
fields, isolated profiles and Stop behavior remain. No remote plan can choose
these limits. Mac updater copies pin the resulting browser bytes; Catalina
remains unsupported.

## Verification

Byte-stream tests exercise the old 4 MiB default, larger page responses, the
first excess byte, invalid limit options, request-body limits and immediate
stream destruction. Actual executor tests check resource classification,
parallel shared allowance, no double charging and unchanged file limits.
The rendered Chromium suite includes a real external script above 4 MiB,
DOM read-back and click. Final counts and exact-head CI are recorded in the PR
and Issue52; CI is distinct from the owner's actual website/device acceptance.

## Rollout and remaining work

The narrow manual Debian update replaces only the known browser module after
hash validation, retains a private backup, syntax-checks before restart and
restores the original on service verification failure. Pairing/configuration,
durable journals, subscription and server policies are not rewritten. No
frontend/Supabase/VPS release is implied by this local module update.

After installation, retry the original request once and inspect its new durable
receipt. Other independent website/consent/network failures remain possible.
This does not implement persistent playback, exact-song selection, general
natural-language planning, Business+ entitlement enforcement or full OS control.
Those requirements remain open under Issue52 comment6071254937.
