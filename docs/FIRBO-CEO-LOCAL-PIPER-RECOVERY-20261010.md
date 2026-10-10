# FIRBO Talk to CEO — bounded local Piper voice recovery

Checkpoint 2026-10-10. Branch stacked on reviewed Draft PR #127 exact SHA 8f7158d149358218eb96476827d1e08203e10998. Scope FIRBO source only. The untouched PickFantasy and TradeAthletes databases are NOT deployment targets.

## Actual bug

FIRBO agent-speak v30 POST returned HTTP 429 twice on 2026-10-09 UTC. An org-wide usage guard includes non-TTS usage events (154 events, only 12 TTS in 24h before second denial), and the default Firbo Dark profile used browser-only speech fallback on 429/5xx. Existing separate Firbo Local mode calls private-network Piper through the authenticated first-party /v1/firbo/free/speech route, but the CEO's cloud fallback never used it. Model inference failures are separate: local Piper cannot repair agent-chat model_error.

## Changed (FRONTEND only)

- Extract existing local Piper request into a bounded helper without changing the backend route or membership/plan guards.
- For Talk to CEO only, opt in with allowLocalFallback:true. On cloud TTS 429 or 5xx (not 401/402/403 and never after partially spoken audio), attempt exactly one authenticated first-party local Piper request (15s timeout), check content type and WAV envelope, and play audio.
- If local Piper unavailable, denied, or invalid before playback, use device browser speech once as before, clearly marked as browser, without any second paid cloud TTS request.
- Preserve Stop, strict turn ownership and no replay after partly spoken audio. Keep local preset's own behavior, but fix partly spoken local audio not to repeat via device TTS.
- No automatic model switch, no database/Edge mutations, no change to other company product sources. This does not bypass paid voice auth denials.

## Run and release gates

1. Exact-head frontend voice tests, full 8-language frontend tests and TypeScript/Vite build must PASS; SAST/workspace checks remain mandatory.
2. Verified owner-authenticated FIRBO user with org enabled for existing local speech. Confirm live /v1/firbo/free/speech returns real WAV, valid org JWT + fixed first-party endpoint, and dedicated backend sound on physical Android/desktop.
3. Verify cloud 429 path has exactly one cloud attempt and one local attempt, zero extra cloud billing, truthful voice source status, Stop, audio end and onerror behavior.
4. Controlled Vercel preview acceptance (no new Edge function required for this source change), rollback SHA pinned; production only after owner acceptance.
5. Current observed local Ollama model inference is independent and remains handled in Master Issue #52 and PR #127.

**No production release authorized by this source PR.** Native Piper installation and physical device TTS remain unverified until an authenticated live test. No Hostinger credentials, model settings or Supabase projects were changed.
