# FIRBO browser accessibility and screenshot adapter

Candidate reviewed 6 October 2026. This stage continues the OpenJarvis parity
matrix from the current shared Claude/Codex checkpoint `5c6a0bc`. It does not
claim a Mac installation, a real account task, or a production release.

## Changed

- Extended the existing closed `browser_task` plan with two bounded actions:
  `snapshot` and `screenshot`. No new device job kind, database migration,
  pairing flow, shell grant, or automatic permission was added.
- `snapshot` captures the current page body's Playwright ARIA snapshot at depth
  12, clips it within the existing 20 KB task text budget, labels it untrusted
  page data, and returns it in the durable company job receipt.
- `screenshot` captures only the visible viewport as PNG, caps it at 4 MiB,
  verifies the PNG signature, and writes it by exclusive creation to an existing
  locally allowed folder. Only path, size, hash, verification and local-only
  metadata return in the receipt; image bytes do not leave the computer.
- Both capture actions require a second local confirmation after the whole plan
  is approved. The screenshot additionally requires the existing local write
  grant. `--auto` cannot approve either capture.
- The server and Connector independently validate the same closed schemas.
  Screenshot filenames must end in `.png`; unknown fields and full-page capture
  requests fail closed. The Computers editor exposes both steps in all eight
  product languages.

## Tested / passed

- 91/91 focused browser, server-validator, approval and Connector tests pass.
- All 546 non-rendered FIRBO Node tests pass. The rendered Chromium file is
  intentionally excluded from that count because this workspace cannot launch it.
- 487/487 frontend tests pass, including both task-composer controls and all
  eight language labels. Frontend TypeScript and the production build pass.
- The rendered Chromium test now covers a real DOM accessibility snapshot, local
  PNG bytes and separate capture approvals using synthetic in-memory HTTP only.

## Failed / evidence boundary

- This workspace has neither the pinned Chromium executable nor Xvfb. The local
  rendered test therefore cannot launch and is not counted as passed. The
  existing `firbo-browser-control` CI workflow installs Chromium and runs the
  same test under Xvfb; its exact-head result is required before any merge.
- No Connector was updated on the paired Mac. Source and automated tests do not
  prove Screen Recording permission, user consent, Stop/offline behavior or a
  useful saved/read-back artifact on that device.

## Remains

- Run exact-head CI, review any real failure, and merge only with both histories
  preserved. Deploy the frontend and matching `connector` validator only after
  the accepted source is immutable; do not change `agent-runner`, `agent-chat`,
  `mission-runner`, SQL or permissions for this stage.
- Update the already-paired Mac without re-pairing or automatically changing
  grants. Perform a user-approved browser task with snapshot, local screenshot,
  Stop/offline checks and a useful artifact read back by its hash.
- Signed-in CEO/meeting/task acceptance, OAuth, approved messaging, second real
  customer isolation and the rest of the master plan remain open.
