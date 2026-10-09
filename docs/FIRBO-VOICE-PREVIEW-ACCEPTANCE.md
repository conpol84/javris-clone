# Voice preview acceptance: real deployed speech contract

2026-10-03. Continue PR #9 and MASTER-PLAN-V2. This fixes a narrow frontend/backend response-contract gap discovered before sending the owner to a real-microphone preview. It does NOT complete production, all-page, desktop or real-provider acceptance.

## Confirmed before the correction

- Vercel preview at source 5008b453ed8237dc4fdc9eca57bc9f325cdb3248 was READY and served `/ceo` HTML. Its compiled bundle points to the EXISTING live Supabase project bfeinnsorgjycivozcau, not an isolated staging database.
- Fresh connected read of deployed `agent-speak` confirmed ACTIVE v5, returning MP3 bytes with `Content-Type: application/octet-stream` deliberately for the Supabase SDK Blob parser.
- The installed SDK parses this into a Blob with that same type. The new voice frontend incorrectly required `audio/*` and therefore rejected the real successful payload before playback, often using browser-speech fallback instead.
- Prior voice mocks returned audio/mpeg or audio/wav directly and did not catch the exact deployed MIME contract. Their earlier passing results are retained with that limitation, not reclassified as real-service success.

## Changed

Only the voice client and its tests change (plus this document). The existing agent-speak Edge Function and its authentication, budgets, service credentials and MP3 format are untouched.
The client accepts a bounded octet-stream Blob only when its initial bytes have an MP3/ID3 envelope, labels the SAME bytes audio/mpeg and lets the existing playback machinery determine decoder/playback success. Native audio/* responses remain supported. Unknown types and HTML disguised as binary are refused. Header recognition is not full MP3 validation; playback failures still fail. The short header-read operation is inside the existing owned-turn deadline/cancellation fence, so late reads cannot start speech after Stop.
No second server request is added by normalization and no authorization/rate/budget response is bypassed. No model call, real recording, test-account creation or external task was performed by this code verification.

## Evidence actually obtained

Candidate preparation run 37152775335, job 111289881379, on exact parent c152c147afb702b392372d5820719ca9336e97d4:
- Required regression reproduced on OLD source: the real installed Supabase client, given a mocked octet-stream HTTP response, yielded no Audio playback object; assertion failed as expected.
- Correction: all **41 voice tests**, including four new response-contract cases, passed.
- Full frontend: **264 tests / 32 files passed**; TypeScript and production Vite/PWA build passed. npm reported 0 known vulnerabilities during install; existing deprecation/bundle-size warnings remain.
- New tests cover actual SDK response parsing with injected HTTP transport, exact byte preservation/type, raw MPEG header, HTML rejection and Stop during a delayed header read. Playback objects remain mocked; the tiny MP3 header fixture is NOT audible audio and is NOT a physical-device/decoder test.
- Verified candidate tree 736495ee2c6fb7c72fa7598e07f6e26dad2ba31a. Voice blob9004656642c54c4250323d0ec2f590ef58a3ba7e; tests blob3cb05d97b9be030d072855c02fb73a413499f7c9.
- The temporary candidate workflow is removed from final source; it only stored reviewed Git objects, never changed refs/deployments by itself.

Normal PR workflows and exact Vercel deployment/readiness are a separate subsequent check. The owner's handoff must name the corrected preview commit and URL, not the old 5008b45 preview. Do not call a READY HTML build an authenticated microphone pass.

## Owner acceptance scope

Use the exact corrected preview `/ceo` URL supplied with the delivery. Open it in a normal desktop browser first; sign into Vercel if its deployment protection asks, then use the existing Firbo account/company. Do not sign up again or alter server settings/keys.

This preview is a NEW FRONTEND ON THE SAME LIVE FIRBO DATABASE AND FUNCTIONS. Neutral test chat may create real conversation/messages and consume model/STT/TTS quota or credits. Do not upload confidential files, use customer data, trigger tasks or test destructive/account/provider settings. Keep Hands-free OFF initially and limit to a few short utterances.

1. Start with typed neutral text and one short reply, with speech unmuted. Check text and audible answer/hologram state.
2. Press Talk, grant microphone to this preview origin and say a short neutral sentence. Press Send if recording waits. Check transcript, response and audio.
3. During the next reply, press Stop; no delayed playback or microphone capture should restart. Then try Mute and confirm the next text answer is silent. Local media Stop is not proof a billed server request was cancelled.
4. Repeat basic layout/controls on the phone, then report browser/device, text/microphone/audio/Stop results and any exact UI error. Voice diagnostics shown in the UI are preferable to tokens/HAR/network headers. Do not post passwords, recordings, authorization headers or customer data.

Only CEO/Talk/Chat appearance/voice are being accepted now. Full native Admin/Gateway control routes still need the new Hostinger API; they are not a valid release gate for this narrow preview and are not declared ready. Computer Manager and desktop machine control require their independent signed-installer/pairing/permission/Stop acceptance. No Hostinger command or Vercel Promote is requested now.

All previous mobile, holographic identity, real-work/orchestration, ledger/budgets, pairing, full backup/restore, integrations and deployment gates remain open as documented. No reset, new project or silent rollout.
