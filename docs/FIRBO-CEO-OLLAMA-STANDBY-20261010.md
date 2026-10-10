# FIRBO CEO — cloud-primary, server Ollama standby (2026-10-10)

Product decision: **OmniRoute remains the main inference router.** Ollama/Qwen on the existing Hostinger VPS is a strictly authorized local BACKUP, not the permanent primary model. The previously coded owner-only local-primary mode (PR129) remains disabled unless separately approved; do not enable FIRBO_CEO_LOCAL_ONLY_PRIMARY for this backup configuration.

Voice: CEO audio is reported working by the owner. Do not modify its chosen voice/profile, local Piper or TTS config in this source stage.

## Contract and actual behavior

1. New CEO request normally routes to the original OmniRoute model. An inference failure returns the original error with retry_safe=false and preserved accounting/unknown provider outcome. **Never automatically replay the same request**, never silently issue a second paid or free completion in response to an ambiguous 502/timeout.
2. The same owner's client observes a genuine model_error and trips a *four-minute, user/org/CEO-agent-scoped, in-memory* local standby circuit. It stores only IDs and expiry (no keys/prompts/history). A separate user, company, agent, computer job or employee is unaffected.
3. On the **next user-initiated NEW CEO turn**, the frontend sets prefer_local_backup=true and sends an independent fresh request_id. The server independently validates role owner/admin, actual user session, CEO auto model, no own BYOK key, exact org in existing FIRBO_FREE_ORGANIZATIONS and server-only FIRBO_CEO_OLLAMA_BACKUP=on.
4. After authorization, agent-chat chooses the existing native /v1/firbo/free/local/chat/completions route *before attempting cloud*. Native endpoint checks signed JWT, owner/admin membership and forces cloud_allowed=false; verified Ollama model and no paid provider fee in receipt. The same CEO conversation and message history are preserved; there is no second CEO identity.
5. On expiry of the 4-minute circuit, the next NEW turn normally returns to OmniRoute. A new cloud failure re-trips local standby. A local failure clears standby to avoid trapping the owner in a broken native route; the reply fails visibly, never auto-replays on another provider. Stop still fences late responses.
6. The server treats a requested but unauthorized backup as a safe 403 before reserving budget or sending any model prompt. Invalid backup flag types are 400. Nonowner, cron, BYOK, unrelated company/agent and manual model are never rerouted to Ollama.

**Limitations:** This is a guarded _future-turn_ fallback, not a promise of literal zero downtime. The first ambiguous cloud failure still requires a *fresh user message*; automatic replay would risk duplicate execution and charges. Its cooldown memory currently exists in a single browser runtime; future server-wide outage detection or shared circuit state needs a dedicated, audited control plane before implementation. If Ollama, Docker, server network or the owner's internet fails, local backup may also be unavailable.

## Deployment order (all must pass)
- Verify native Ollama is genuinely online and the already reviewed native owner-only local endpoint is running with a Qwen3 digest. Read-only installed container/network checks do not suffice; require one owner-authenticated real answer and a denied nonowner/foreign-company request. Never reinstall or recreate the existing service.
- Confirm original correct FIRBO My Org Supabase project bfeinnsorgjycivozcau, no PF/TA changes, and production Edge versions/source read-back; deploy native backend first with rollback image, then exact Edge function dependency closure with new helper and rollback.
- Enable FIRBO_CEO_OLLAMA_BACKUP=on ONLY alongside explicit FIRBO_FREE_ORGANIZATIONS UUID allowlist once backend native health/accounting proves valid. **Leave FIRBO_CEO_LOCAL_ONLY_PRIMARY off.**
- Deploy controlled frontend preview to verified owner, test cloud success, cloud failed first turn (no replay), next fresh owner local turn with zero paid provider attempts, 403 cross-tenant/nonowner, 4-minute recovery, history and voice/Stop on physical device. Use pinned SHA and rollback for all.
- Do not change FreeLLMAPI/OmniRoute production economy/quality or customer routing. Separate provider quota/credits from FIRBO budget caps.

## Duplicate credential guard
Owner's private Compose readback returned duplicate_credential_configuration (parse_private_key_presence). The old gateway-credentials.py intentionally refuses multiple recognized key assignments rather than choosing one. New firbo_duplicate_credential_audit.py uses the exact same previously audited Compose runtime/private-file reader and returns ONLY the recognized duplicated key NAMES, line numbers, count and whether values are identical. It does not reveal, hash, copy, export or edit values; no credentials are stored in GitHub/CI. No automatic dedup or permission changes: a human must review which assignment actually belongs to the running services before any config edit/restart. See Master Issue #52 and PR131 source.

**Status:** SOURCE CANDIDATE, default OFF, no VPS commands, no Supabase modifications/migrations, no provider inference or production deployment from this PR. Preserve every previous PR #126–#131.
