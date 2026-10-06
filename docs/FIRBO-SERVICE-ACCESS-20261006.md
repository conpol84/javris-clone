# Gateway / Jarvis mobile access continuation

## Changed

- Added a shared admin service panel in Gateway, the native console and Jarvis.
  Jarvis chat and routing management open inside FIRBO; external dashboards
  remain separate authenticated applications. Service links remain available
  to independently verified platform admins during a gateway outage.
- Gateway tabs now support URLs, including `/gateway?tab=free`, and browser
  back/forward navigation. Existing tabs and customer membership view remain.
- FreeLLMAPI remains a private VPS service. No public hostname is invented.
  `VITE_FREELLMAPI_DASHBOARD_URL` can advertise a provisioned HTTPS dashboard;
  absent that setting the card explicitly says remote access is pending and
  separately links the Gateway free-model catalogue. These are not represented
  as the same service or as proven FreeLLMAPI inference.
- Jarvis has an explicit, manual arithmetic tool check through the existing
  authenticated platform-admin chat bridge. It requires an inventoried calculator
  or code_interpreter and successful structured tool output containing 323.
  Model prose alone never passes. This is server-reported evidence, not proof of
  every tool or file acceptance. No new backend endpoint, credentials, permission
  bypass, shell command or automatic/background execution was added.
- Status refresh handles transport rejections and clears stale online state.

## Tested / passed

- 528 frontend tests passed, including four manual tool-check cases and the
  existing receipt/transport cases. Production TypeScript/Vite build passed.
- The existing rendered-page suite now exercises the Jarvis link and free-model
  deep link across its existing language/viewport fixtures. CI results and exact
  release identity must be checked before claiming rendered/live acceptance.
- Source preserves Claude f6442b754eb26019c16f4aa40c50a15d6e73c14b and Codex
  parity ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a. Existing PR30 parent is
  44c510363c744e2e358322e2de63fc39892338ee; PR13 remains excluded.

## Failed / corrected

- Initial build found unsupported Array.at in a new test; replaced with indexing.
- User's latest installed-runtime trace has raw gateway HTTP200 responses with
  zero tool calls, before parsing. Both services still have no execution receipt.
  Wrappers failed with ModuleNotFoundError; the missing module is not identified
  in the sanitized trace. Temperature differs from earlier successful probes,
  but causality is unproven. Do not claim parser loss, disable protections or
  force required tools based only on this evidence.

## Remains

- No Hostinger/SSH execution tool is available in this session. User is away from
  the PC: do not ask for more terminal pastes. VPS native execution repair,
  authenticated public FreeLLMAPI access and provider registration remain open.
- Cloud browser reaches FIRBO's public page but has no authenticated session.
  Mobile tool-check UI can be released; its production result is not yet verified.
- Mac updater already pins the served Connector's source hash. Actual local
  installation, browser consent, saved-file acceptance and previous master-plan
  provider/tenant/security/operations gates remain open.
- Previous production rollback: dpl_FXNexnDx9jT5NyZdYaR9uBTsz4qz at b0715ef.
  No Supabase function, database, VPS configuration or Mac runtime was changed.
