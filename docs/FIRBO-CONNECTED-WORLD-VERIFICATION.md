# CONNECTED-WORLD-1 — verified implementation checkpoint

Evidence run timestamps: 2026-10-03 UTC. Continue PR #9/MASTER-PLAN-V2. This delivers source, isolated tests and a frontend preview, NOT real connected customer services, complete desktop execution or production readiness.

## Exact identity

- Starting source: 8e65b045363ca299aaf8ccf509f25ea69b248dde.
- Implemented source: a8f18b7890aab528067dcf48bc6192a13cc60d25.
- Test-fixture correction: 0eb8b9655e3fe3de9f36cb172a4d253386643b6c.
- Final tested source: **d2315200c841d6f0a7dbb62f9390160f413f181e**.
- This subsequent document/inventory commit does not change the tested implementation.
- Vercel exact candidate: **dpl_2JnV3fgqd1kfT2jVHdYghCmZTzxY**, READY / Preview, source d231520.
- Preview: https://jarvis-command-center-9ztow4m00-conpol84s-projects.vercel.app/computers . `/computers` returned HTTP200 Firbo HTML at 22:23:13 UTC; it serves index-C_Ynq5Rb.js and index-CjwlGcrY.css. This is not a signed-in physical-device pass.
- **Production identity changed outside this work:** the fresh Vercel read resolves firboai.app to **8e65b045363ca299aaf8ccf509f25ea69b248dde**, deployment **dpl_EALVmeACEx2AMPJDWPrXzCKmAEbz**, READY / production, source redeploy. Stop repeating the obsolete ae82ca9 live claim. I did not promote that deployment or this new device package.
- The project preview has previously been verified against the existing LIVE Firbo Supabase database/functions. No isolated hosted database was configured here; treat this as live-bound and use it only to review UI until backend/consent gates are passed. The served voice bundle remains voice-D0NGCE7i.js, previously read with that database binding.

## Changed

New substantial holographic Connect your devices workspace in existing Computers and a Command Center entry. PC/mobile/home/car have distinct states and boundaries; existing enrollment/permission/history functionality remains. Home/car shows stored sources, not assumed device-online status, and verifies a requested read before displaying values. Mobile permission checks do not record or imply OS control.

Actual four-provider read adapters, OAuth state/finalization, refresh leases and revocation plus Home Assistant/Traccar selected reads. The existing Integrations screen now has six setup cards and a bounded dialog with configuration state, scopes and verified response display. It no longer presents the four as Coming soon, but does NOT label absent credentials/runtime Live. Fixed mobile header/name/action wrapping after observing the failures.

Candidate schema adds service-only OAuth state and atomic connection+secret saving with quota checks, preserves existing kind constraints, and adds refresh leases. Official CLI generated **20261003221256_firbo_connected_services.sql** in run37157584014. Final committed file matches template SHA256 **e751c4d5d18df9a31091383b2ff5323407796620194a583e1bb668cdf53dcd09**. No live schema or function was deployed.

New provider capabilities: YouTube own-channel identity/statistics; TikTok profile/recent public video metadata; Salesforce Account sample; QuickBooks CompanyInfo only; selected HA entity states; selected Traccar tracker status. No video upload/publish, CRM writes, invoice/payment actions, GPS tracking or car/home commands. These obligations are not silently closed.

## Passed / evidence obtained

**315 frontend tests / 33 files passed**, including **51 new connection tests**. Frontend TypeScript, separate shared-provider/service/bridge type checks, production build and isolated world build passed. The provider HTTP and handler database objects in unit tests are fake; no credentials or provider action was used. Existing bundle-size/deprecation warnings remain.

**Real disposable PostgreSQL 17 checks passed:** schema install, no anon/authenticated state/secret read or service-RPC access, unrelated-user refusal, atomic secret persistence, refresh lease exclusion, deletion cascade, state replay refusal, required state, quota and no partial record/secret write. This is actual PostgreSQL, but a deliberately minimal fixture, not the full live schema or full RLS/parallel workload certification.

**35/35 actual-page browser scenarios passed**, confirmed by reading downloaded results.json. Run **37158008128**, artifact **11285389940**, ZIP SHA256 **b0edf7467666992c96f31afafa881c45ebfef627b12873a4b1277d483808983d**. Ten PNG screenshots retained; desktop Devices/Integrations and Greek mobile Devices were visually reviewed. These render real application components with invented company/device/provider records. All external destinations and service workers are blocked. Not a real home, car, account consent or physical phone.

Matrix: Computers/Integrations at 320/390/768/1440 widths in EN/EL/AR (24 cases), plus home read, selection race, mic-permission query, empty source, failed read, identity switch, member restrictions, all four setup dialogs, backend-disabled authorization, non-manager restrictions and no fake query-string success (11). Full mobile/translation coverage is not inferred.

All **13** PR workflows associated with d231520 completed SUCCESS:

| Workflow | Run |
|---|---:|
| Connected world/provider adapters | 37158008128 |
| Frontend CI | 37158008178 |
| Computer Manager/operational pages | 37158008194 |
| M2 actual-page mobile | 37158008189 |
| M1 shared reflow | 37158008184 |
| Voice/hologram lifecycle | 37158008092 |
| Real local operations | 37158008143 |
| Control-plane security | 37158008054 |
| Dependency gate | 37158008157 |
| Connectivity | 37158008262 |
| Free catalogue | 37158008180 |
| VPS diagnostics | 37158008127 |
| Existing static security | 37158008113 |

PR workflows may check GitHub's generated merge ref associated with the source head; these are not claims that only the raw head tree ran. Preparation tests checked the hash-verified edited candidate. No unrelated base changes were merged into the branch by this work.

## Failures diagnosed and corrected

1. Intermediate preparation commit1fe2884 had an unsuccessful Vercel build before five existing-file edits were incorporated. Integrated a8f18b and subsequent candidates build successfully. Temporary preparation workflows are removed.
2. Initial PostgreSQL run37157448740 installed schema and passed initial privileges, then its TEST cleanup used variable id ambiguously against a table column. Renamed only test variable v_id; runtime SQL assertions were retained.
3. Run37157584014 passed PostgreSQL and all19 Devices browser cases. Integration overflow caused13 of35 cases to fail;22 passed. Long unbroken organization names and compressed linked-app labels/actions were corrected in scoped CSS, without skipping geometry assertions, hiding overflow, deleting controls or shrinking type.
4. Final run37158008128 passes35/35. No remaining case in this suite is suppressed. Prior mobile/voice/Computer Manager regression workflows also pass.

## Not changed / not tested

No production promotion, Hostinger restart/configuration, Supabase DDL/function deployment, provider account authorization, real device pairing, financial action, external publishing or inference call occurred. The only live SQL here was a metadata SELECT to verify the plan_limit function signature. No new provider credentials were added. New backend remains explicitly disabled until installed/configured.

No physical Android/iOS/Safari, actual OAuth consent/provider verification, token rotation against live accounts, home/car resource or signed Desktop test. No new field-level token encryption, full DNS-rebinding protection or aggregate multi-resource deadline. Six non-EN/EL languages still have new-copy English fallback. These limits must survive any handoff.

## Next action / release gate

The owner may view the exact preview's Computers/Integrations appearance and switch device panels using the existing login. Do not ask them to authorize services, paste tokens, pair/run computer tasks or Promote this package now. Setup-required is expected on the live-bound frontend until the matched staging/backend/migration/provider apps are ready. Do not interpret UI review as acceptance of the whole future product.

Continue existing useful-work milestone: phone/voice instruction -> scoped task -> authorized PC execution -> saved/read-back artifact/receipt -> visible result. Complete matched native API/OmniRoute, migrations/recovery, required provider setup/approval and real-account tests, then activate only reviewed capabilities. Signed Desktop/browser/OS input, local Stop, all mobile, natural voice, publishing, budgets/Free policy, monitoring and final assessment remain required.

FIRBO-DELIVERY-MATRIX retains all34routes and19prior requirements, adding device_ecosystem and device_future (21). The connected-world document describes further Work/Home/Travel spaces, optional briefing, watch/display/NAS/AR and bounded home scenes as future proposals, not completed features.
