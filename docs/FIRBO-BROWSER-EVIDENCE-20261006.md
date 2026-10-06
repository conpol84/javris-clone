# FIRBO browser accessibility and screenshot adapter

Released 6 October 2026. PR #21 preserved the shared Claude checkpoint
`5c6a0bc` and Codex head `73e51d4` as explicit parents in merge
`9b2b8ce0733762c957eb74377d88e1ae7b8fa247`. This release does not claim a
Mac installation or a real account/device task.

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
- All seven exact-head GitHub workflows passed. The scoped-browser workflow ran
  the updated visible Chromium fixture under Xvfb successfully.
- Supabase `connector` v28 is ACTIVE with digest
  `65e01d4e06a25e8400fe947510214456137a484a17fed5279a052be99f6d37f3`;
  both deployed files match the merge source exactly. Runner v83, chat v37,
  mission v26 and all migrations were preserved.
- Production deployment `dpl_8ekCf1V4MUVuMzKZnoJQ2Q3y2WD1` is READY. The
  public browser module matches the repository byte-for-byte and the served
  Computers chunk includes both actions. A 30-minute error/fatal scan was empty.

## Failed / evidence boundary

- This workspace has neither the pinned Chromium executable nor Xvfb. The local
  rendered test therefore could not launch and is not counted as a local pass;
  exact-head CI supplied the separate rendered-browser evidence.
- No Connector was updated on the paired Mac. Source and automated tests do not
  prove Screen Recording permission, user consent, Stop/offline behavior or a
  useful saved/read-back artifact on that device.

## Remains

- Update the already-paired Mac without re-pairing or automatically changing
  grants. Perform a user-approved browser task with snapshot, local screenshot,
  Stop/offline checks and a useful artifact read back by its hash.
- Signed-in CEO/meeting/task acceptance, OAuth, approved messaging, second real
  customer isolation and the rest of the master plan remain open.

References: https://github.com/conpol84/javris-clone/pull/21 ;
https://github.com/conpol84/javris-clone/actions/runs/37423292153 ;
https://firboai.app
