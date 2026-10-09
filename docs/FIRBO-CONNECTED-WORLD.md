# Firbo Connected World — implementation and activation boundaries

Continue MASTER-PLAN-V2 and PR #9. The owner requires all four previously planned apps plus a connected-device future. This is implementation in the existing product, not a new unrelated app or a production certification. See FIRBO-CONNECTED-WORLD-VERIFICATION.md for exact evidence.

## Implemented candidate scope

The existing Computers route now contains a dark cyan/navy holographic device workspace. PC, mobile/tablet, home and car tiles expose their different capabilities; original enrollment, permissions and job history remain. Command Center links to it. No route or existing integration was removed.

- PC uses existing paired-device records; a count is not proof of a successful job. Real browser/OS input and signed Desktop remain open.
- Mobile reports only this browser/PWA and microphone permission. Permission checking does not start recording. Installing the web app does not pair a phone executor or control other phone apps.
- Home Assistant reads up to twelve explicitly selected sensor/binary_sensor/light/switch/climate states from an operator-approved HTTPS origin. No cameras, locks, security panels or service commands.
- Traccar reads selected tracker status. No GPS history, IMEI, driving, unlocking, immobilising or engine commands. It requires a compatible Traccar service; it is not direct support for every car.
- YouTube OAuth: own channel identity and reported statistics. TikTok OAuth: profile and recent public video metadata. Salesforce OAuth: bounded Account-record sample. QuickBooks OAuth: CompanyInfo only. Refresh/revocation and authenticated connection persistence are implemented. Publishing/uploading, CRM mutations, invoices and payments are NOT implemented by these read adapters.

The four apps have actual gated setup/authorization/read flows rather than a Coming soon list. Missing backend/schema/flag/credentials is shown as setup required, not Live. Merely clicking a card or adding a connected query parameter cannot establish a new connection.

## Security and consent contract

The existing integrations function delegates explicit new actions and refuses new providers through legacy paths. Owner/admin/manager access is checked server-side. OAuth state is hashed, short-lived, tied to original user/company/origin and single-use claimed. The public callback does not exchange/link the account: the original authenticated Firbo user completes it. The temporary code travels in a fragment that the UI clears.

A provider read verifies the account before a transaction saves integration and secret. PostgreSQL locks the company for quota checking. Refresh has a lease and re-reads the token after acquiring it. Secrets use the existing server-only table, not browser/localStorage or public config. This stage does NOT add separate field-level encryption or certify backup security.

Salesforce API and Intuit accounting scopes are broader than the read-only methods Firbo exposes. The UI discloses this; restrict the provider account too. Model/browser input cannot choose arbitrary provider URLs, SOQL queries or upload/vehicle-command paths. Requests have per-request time/size bounds and sanitized errors.

Home/car origins require an operator allowlist. This is not automatic LAN discovery or complete DNS-rebinding protection. Aggregate multi-resource deadlines/cancellation and hostile-network tests remain prerequisites for customer bridge rollout.

Local disconnect deletes the Firbo integration/credentials first. Failed or manual remote revocation is explicitly reported rather than declared successful. Publishing, financial actions and exactly-once external-action receipts remain separate gates.

## Activation — operator steps, not a command for the owner now

1. Preserve live and obtain the required recoverable database/runtime baseline. Reconcile actual schema/grants. Do not apply the incomplete repository migration history blindly.
2. Apply the candidate connected-services migration to a matched staging database. File: supabase/migrations/20261003221256_firbo_connected_services.sql, generated with official CLI in run 37157584014. Template: deploy/schema/firbo_connections.sql. Check states/secrets/service RPC grants, RLS, quota/replay/concurrency and deletion cascade against the actual schema; the minimal CI fixture is not the live database.
3. Deploy integrations with its three new shared modules. Verify public GET callback reachability and authenticated POSTs; do not remove application authorization to make OAuth work.
4. Set exact APP_URL/FIRBO_APP_ORIGINS and SUPABASE_URL. No wildcard preview origins. Register the exact callback from the manifest with providers.
5. Server secrets: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET; TIKTOK_CLIENT_ID/TIKTOK_CLIENT_SECRET (client key is ID); SALESFORCE_CLIENT_ID/SALESFORCE_CLIENT_SECRET; QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET. Salesforce/QuickBooks default sandbox; explicit environment changes require reconnection.
6. Register/configure provider applications, eligible test accounts, scopes and real owner consent in official dashboards. Required provider approval cannot be fabricated or inferred from tests.
7. For optional bridges, approve controlled HTTPS origins in FIRBO_DEVICE_ALLOWED_ORIGINS. Do not expose unsecured LAN endpoints or put secrets in chat. Use restricted accounts and specific IDs.
8. Enable FIRBO_CONNECTIONS_ENABLED=true only after schema/backend/config gates. Use real test accounts in a matched preview; test denial, stale/replayed state, wrong account/company, refresh races, revoke and outages.
9. Release only the accepted scope with rollback. Viewing the disabled frontend is not evidence of a working provider connection.

## Future direction — proposals, not completed features

**Cross-device continuity:** one task ID follows a phone instruction to an approved PC run to a saved/read-back report with receipt on both screens. QR enrollment can simplify consent without granting blanket authority. Reuse E1, not a second job system.

**Work / Home / Travel spaces:** separate permissions, context and retention. Home sensor values should not automatically enter company prompts. Local/cloud model processing needs explicit privacy choices.

**Opt-in daily briefing:** combine permitted calendar/tasks, selected home states and supported vehicle information; explain missing/stale data and propose actions. Never silently buy, unlock or start engines.

**Low-risk home scenes:** later, separately authorized office lights or bounded comfort settings, with read-back and real device tests. These are future service calls, not current read-only states; safety-critical actions require stronger constraints.

**Watch, display, NAS and AR:** optional notifications, TV/display summary, a local work-folder bridge or the same assistant in AR. Each requires compatible hardware/software/API and independent consent. A tile is not device support. No claim of physical free-space holographic projection.

The product goal is useful continuity: speak, choose an allowed target, perform the work, verify the artifact and stop when requested. Current UI/read adapters are progress toward that goal, not its completion.

## Prior obligations retained

Holographic visual acceptance, natural voice/real microphones, all mobile routes/popups/languages, native Firbo API/OmniRoute, iterative tool execution, durable server ledger/atomic budgets, runtime Free-only policy, signed Firbo Desktop/updater, pairing/revoke/local Stop, visible browser then opt-in OS input, approved publishing/integration writes, reproducible migrations, encrypted off-host backup/restore, monitoring and final assessment remain required. Do not repeat completed model registration or local configuration/API-image archive checks.

New copy is complete in EN/EL; six other languages have translated entry labels but some new diagnostic/provider text falls back to English. This is NOT complete new-copy localization. Physical installation/device access, backend activation, natural voice, provider production approval and real consent have not been tested by this slice.

## Primary references

- https://developers.home-assistant.io/docs/api/rest/
- https://www.traccar.org/traccar-api/
- https://www.traccar.org/api-reference/
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.tiktok.com/doc/display-api-overview/
- https://developers.tiktok.com/doc/oauth-user-access-token-management/
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_oauth_and_connected_apps.htm
- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
