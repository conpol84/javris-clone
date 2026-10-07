# VPS file requests must not launch a laptop browser

## Changed

Starting from shared `0fc6b26bc2826328bdcf3d45e60a64e242378647`, retain
both contributor histories and all PR93 native acceptance work. The owner
successfully verified a real native write/read/hash in directory
`/home/jarvis/.openjarvis/firbo-acceptance-7e50xgua` (Issue52 comment6045930478).
The subsequent CEO request to read that same file returned
`No browser-ready laptop is online.`

The browser parser matched `open` inside `.openjarvis` as an action and
`report.md` inside the absolute path as a website. Parse action words separately
from filesystem paths and URLs, require complete English action words, and match
whole destination tokens. Common bare document filenames are not browser
destinations; explicit HTTPS URLs ending in those extensions remain supported.

## Tested / Passed

39 focused bridge/session tests pass. The owner's exact Greek prompt remains
ordinary server chat, without device discovery or a laptop queue operation.
The actual CEO session hook calls sendChat and renders its response. English,
Greek, Windows/relative paths and embedded URL verbs have regressions, while
explicit browser commands retain their behavior. Full frontend suite: 62 files,
594 tests passed. TypeScript and production Vite build passed. Existing chunk
size/dynamic-import warnings remain non-failing.

## Failed / Remains

This fixes a frontend routing error, not server filesystem permissions or
backend connectivity. Mocked session tests do not prove website artifact
delivery. Exact-head CI, deployed frontend identity, and a fresh owner website
read/receipt remain release/acceptance gates, recorded in Issue52. No VPS
reinstall, native acceptance rerun, backend deployment, permission or model
configuration change belongs to this fix.
