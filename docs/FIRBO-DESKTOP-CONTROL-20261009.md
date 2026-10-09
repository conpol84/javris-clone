# General desktop control candidate — 9 October 2026

Owner requirement: CEO follows a natural-language task on the selected customer's
own computer, observes results, operates desktop apps/browser with mouse and
keyboard, uses separately enabled shell, and leaves useful apps/media running.
Business and Enterprise only. Source work is not physical acceptance.

## Implemented

- New `desktop_task` durable job; Python X11 screen capture and actual mouse,
  Unicode typing, key chords, scroll and drag. No local listening port.
- Connector owns observe/plan/act loop and checks Stop again after planning,
  immediately before input. Screenshots go transiently to the authorized vision
  route; job receipts contain observation counts/hash and inference request IDs.
- Normal desktop applications persist after a task. The model must match artist
  and title and observe the player clock changing before reporting media success.
  This is model visual verification, not an audio measurement or guaranteed
  interpretation of the screen. A Stop interrupts AI actions, not existing media.
- Native capability is advertised only after an actual capture preflight. Local
  explicit `desktop-control` opt-in plus Full Control required. X11 only initially;
  no claim of Wayland, Windows or Catalina support. General desktop access is an
  account-level capability, not confinement to the Connector's file folders.
- CEO chat/voice send the complete goal, not a first-result selector. Selected
  device remains fixed. Existing simple Mac app launcher and manual browser plans
  remain available with their existing consent. Native Linux handles app opening
  through the vision loop when the legacy app capability is unavailable.
- Server checks organization status, active/trialing Business/Enterprise, owner/
  admin membership, pairing, local capability and enabled Full Control. A SQL
  trigger checks advanced jobs on enqueue and claim, including agent/approval API
  paths and direct shell execution (which otherwise bypasses desktop entitlement). Claim withdraws work after downgrade. Stop/report remain available.
- Model calls use existing inference reservation/settlement; no automatic retry
  after an uncertain model call and no replay of interrupted desktop actions.

## Deployment prerequisites

Apply `20261009020000_desktop_control.sql` only after real PostgreSQL regression
passes and checking live migration history. Connector bundle now includes its
transitive planner/accounting/gateway/computer-policy dependencies; never deploy
only index.ts. Preserve its existing `verify_jwt:false` and in-handler auth.

The gateway must have an actual screenshot-capable model and verified prices:
`FIRBO_DESKTOP_VISION_MODEL`, `FIRBO_DESKTOP_PRICE_IN_PER_M`, and
`FIRBO_DESKTOP_PRICE_OUT_PER_M`. Endpoint and inference key reuse the existing
validated OMNIROUTE configuration. No invented zero price or guessed model is
provided. Screenshot/data-URL compatibility and actual provider usage still need
verification. Generic text-combo health does not establish vision readiness.

Local installer: `tools/debian/install-desktop.py --source FULL_SHA` preflights
without changes; `--apply` explicitly installs/enables the four hash-pinned assets,
keeps pairing/config permissions and a private backup, restarts the existing user
service, and restores the backup on an installation failure. Requires Node22.13+,
xdotool and system Python Pillow (`sudo apt-get install xdotool python3-pil`). Run
as the Debian desktop user, never root/VPS. It derives GUI environment only from
the existing same-user Connector service. It does not grant OS administrator
rights or enable shell permission.

## Verification and limitations

Focused tests cover observation/action ordering, cancellation before input,
network ambiguity without retry, local consent, denied shell, receipt truth,
plan/status matrix, API ownership, device isolation and downgrade-safe Stop.
Existing Connector/durable/browser regression passes locally; full frontend tests
and types pass. Native X11 fixture exercises real capture, Greek text, key chord,
click readback and local corner Stop. SQL fixture exercises actual trigger and
claim, no provider/money/device effects. Exact CI results belong in Issue52/PR.

The loop checkpoints at 128 actions or 15 minutes; it reports incomplete, never
fake completion. Screenshots/observations are bounded to protect memory and
inference admission. Websites/resources/media use the ordinary desktop browser,
not the temporary browser's resource interception/transfer restrictions.

Not yet completed: actual owner's desktop/CEO/provider/media/Stop acceptance,
production migration/backend/frontend deployment, cross-customer live acceptance,
Windows/Mac adapters, and employee task continuation for long desktop jobs.
Existing agent-runner computer powers continue to use legacy jobs; do not label
that path a general desktop executor. Agent advanced jobs still receive the new
Business+ gate through the shared database claim/enqueue boundary.

Preserves shared470724, parityce421e31 and PR110's browser repair. No force push,
main/PR13 change, repeated VPS budget install, new pairing or unrelated project.

## Source acceptance checkpoint

PR111 includes PR110 as ancestry. Local 193 Connector/browser/desktop tests and
628 frontend tests passed, along with TypeScript and bundle closure. Actual CI
X11 passed capture, exact Greek text, replacement key chord, clicked callback and
corner Stop (run37871181274/job113629412634). Actual PostgreSQL claim/entitlement
regression passed (run37871181265/job113629413404). Initial failures were test
fixture event processing/SQL variable ambiguity and formatting; all corrected
without dropping the assertions. Final exact-head status is recorded in Issue52.
No owner's computer or paid vision inference was exercised by these tests.
