# FIRBO runner recovery — 7 October 2026

## Changed

Continues accepted shared `0f6af35cdd98442d298003b5adb2d4bfdd74ff44` (PR75).
Claude and Codex parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` remain ancestors.
PR73/74 CEO fixes and all PR61/62/67–72 network gates are preserved.

The deployed agent-runner v91 contains a current entrypoint with four older
dependencies. Missing exports include serverInferenceUsage, tavilySearchWithUsage
and six image/vision helpers. Importing the actual live bundle reproduces the
missing gatewayImageRequestPayload export. An anonymous GET through the project's
existing pg_net returned HTTP 503 BOOT_ERROR (request 2867). This is now a confirmed
live boot failure, superseding the earlier source-only diagnosis.

This recovery deploys the complete reviewed 16-file import closure. It separates
ordinary runner recovery from external service activation:

- VPS execution requires FIRBO_SERVER_EXECUTION_ENABLED=on, plus the existing
  tenant/role/tool/claim checks and explicit positive billed pricing/output bounds.
- Page egress requires FIRBO_PAGE_EGRESS_ENABLED=on, plus the existing validated
  endpoint/token configuration. There is no direct-target fallback.
- These flags default off. This recovery does not set either flag, configure a
  service, change secrets, grant permissions or invoke a real model/device.
- Accepted VPS calls include the reserved max_tokens in their outgoing payload.
  Actual VPS enforcement and billed provider pricing still require acceptance.

Full VPS/page service activation remains subject to the existing release pricing,
service inventory, TLS/auth, pinned egress and real-receipt gates. A URL/token alone
must not activate those paths. Do not turn on either flag merely to clear an error.
FreeLLMAPI and the existing text routing/accounting paths are retained.

## Tested / Passed

208 focused Node cases pass: actual chat/runner handlers, complete import closure,
runner accounting, server receipt validation, gateway routing, image tools,
page/free-search and egress bundle integrity. Tests include fully populated server
credentials without release enablement (zero VPS calls or reservations), invalid
pricing, explicit output caps and configured-but-disabled page transport.
Both manifests match exact source bytes; git diff --check passes.
Required remote CI, deployment version, live read-back and HTTP probes are recorded
in the PR release entry. Source tests alone are not live task/customer acceptance.

## Live CEO and Mac checkpoint

At this stage's start production was READY deployment
dpl_HC9J4wFkXMBEiDxYFFidqCB3H6zj, source bd9a7e8968ea6d8119a38f36753aba71179d565d.
The public FIRBO homepage loads in the cloud browser; it requires sign-in for
authenticated UI acceptance. Agent-chat v41 matches all eight accepted files.

Polis1984 is paired, not revoked and online; its creator is owner. It still reports
only list/read/write/exec/browser_open. Server policy is Full Control but local
browser_task/open_app/shortcut/full_control capability is absent. No role change,
repair job, re-pairing or local permission change was made.

## Mac compatibility and one-time owner step

Concurrent PR76 was reviewed and preserved as a real merge parent. Its exact
head 8b84e0de469d59f7259791cda32648420eaf7a9e passed all 11 workflow families;
the complete combined tree must pass again. Both updater copies now reject
unsupported macOS before installation or permission changes.

The newer owner read-back in PR76 identifies macOS 10.15.7, Macmini6,2 (Late
2012), x86_64 and Node v22.16.0. Apple lists Catalina as the newest officially
compatible OS for this hardware (https://support.apple.com/en-us/102852).
Current Playwright requires macOS 14+ (https://playwright.dev/docs/intro).
Do not repeat the installer or prescribe an unsupported macOS upgrade for this
Mac. Physical browser acceptance requires a supported OS/computer; no hardware
purchase, OS replacement or permission change is performed by this repair.

For an existing paired Mac on a supported OS:

1. On Polis1984, stop the old Connector terminal with Ctrl+C.
2. Sign in to FIRBO, open Computers, select the existing Polis1984 and download
   FIRBO-Mac-Browser-Update.command. Do not create a new computer/pairing.
3. Run the downloaded file on that Mac, or from Terminal:
   bash "$HOME/Downloads/FIRBO-Mac-Browser-Update.command"
4. Answer y to preserve/use the existing pairing, and y to the explicit local
   Full Control question if you want FIRBO to control this Mac. Allow the macOS
   app permission requested for an app you approve. Keep the terminal running.
5. Return to Computers and verify fresh capabilities: browser_task, open_app,
   shortcut and full_control:true. Only then run CEO -> confirmation -> ksekina.
6. Verify the resulting computer receipt, app/browser behavior and Stop on the
   physical Mac. A browser_open receipt proves only a URL launch.

## Failed / Remains

The prior live runner boot failure is the repair target. Direct scratch HTTP to
Supabase is network-blocked; the existing pg_net provides a non-authenticated,
non-provider smoke probe without new extensions or scheduler configuration.
VPS/Hostinger execution access is unavailable in this session. Real Mac/browser
playback, complete server artifact/read-back, enabled egress, actual provider
pricing, OAuth/channel connections, second customer, business workflow and
encrypted off-host restore/load acceptance remain open in master Issue52.
This recovery is not a full production-ready or YouTube playback claim.
