# FIRBO Mac updater compatibility — 7 October 2026

## Changed

Owner supplied a real Mac installer failure: Playwright refused Chromium on
macOS 10.15 after npm installation. The earlier updater stopped before replacing
the Connector/browser files or asking for Full Control; it had already changed
the isolated browser npm installation. Existing pairing was retained.

This isolated candidate descends from shared
0f6af35cdd98442d298003b5adb2d4bfdd74ff44 (merged PR75), preserving Claude and Codex
parity ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a. Both downloadable and reviewed
Mac updater copies now validate sw_vers before Node, confirmation, downloads,
package installation, runtime replacement or permission changes. A missing or
malformed version fails closed. The supported browser installation baseline is
macOS 14 Sonoma or newer, following current official Playwright documentation:
https://playwright.dev/docs/intro

This is a supported-platform policy, not a claim that every older release fails
at the identical Chromium installer boundary. No package downgrade, alternate
browser bypass, repair, re-pairing or automatic OS upgrade is introduced.

## Tested / Passed

27 local Node cases pass: 16 updater cases and 11 existing native-control cases.
The updater tests execute Bash with disposable HOME and stub OS/command
transports. Catalina 10.15.7 and macOS 11/12/13, malformed versions and sw_vers
failure stop without invoking Node/npm/curl/install or modifying the pairing
sentinel. macOS 14/15/26 reaches existing owner confirmation; declining performs
no installation. Source/download equality and both runtime SHA256 pins pass.
Bash syntax and git diff whitespace checks pass. Exact-head CI acceptance belongs
in the PR body after independent completion/read-back.

## Live / Failed / Remains

Fresh firboai.app lookup confirms READY production
dpl_HC9J4wFkXMBEiDxYFFidqCB3H6zj at PR75 accepted source
bd9a7e8968ea6d8119a38f36753aba71179d565d. This preflight is source-only and is
not served by that deployment. No merge, deployment, migration, provider call,
physical-device job or permissions mutation occurred for this candidate.
The active separate firbo-final worktree was read only and is not modified.

The owner's hardware model, architecture and Node version are not yet supplied.
No hardware-compatible OS upgrade or physical browser readiness is certified.
The existing Catalina failure remains a real-device blocker; a preflight improves
failure handling and does not make Catalina supported. Keep the existing pairing.
Choose a supported OS/computer only after model compatibility is checked, then
use the accepted updater and require actual owner-approved browser/Stop/offline
and useful artifact read-back acceptance. Previous source/CI passes do not prove
the CEO executes on this Mac.

Runner dependency/pricing and deployed egress gates, real provider invoices,
OAuth/channel approvals, customer isolation and the remaining master-plan gates
remain. FIRBO only; no other product changed. FreeLLMAPI stays installed/private.
Never merge PR13 or replay applied migrations.
