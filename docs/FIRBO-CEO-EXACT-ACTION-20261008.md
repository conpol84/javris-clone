# FIRBO CEO exact-action binding — 8 October 2026

## Changed

Continues shared 8cd79b16b5eee7b38ad70dd54f7446cb36e6172a and preserves all contributor history. The direct computer bridge snapshots approved kind, device selection, description and bounded JSON parameters before asynchronous device discovery. Queue transport receives its own copy. Completion requires the same durable job ID, device, kind and JSON parameters, no requested Stop, and the existing operation result. JSON object key order is immaterial; arrays retain order. Unsupported/non-JSON, accessor, cyclic, deep or oversized values fail closed. Current device policy/capabilities are still rechecked before queueing. Windows/Linux capability blockers no longer claim Catalina/macOS; unknown transport errors identify the computer rather than a Mac.

## Tested / passed at authoring

A real async dependency fixture reproduced the old race: approved d1/Word changed to d2/Safari during discovery and the bridge returned done. The fixed bridge keeps d1/Word. Local existing Vitest suite plus new regression cases: 40/40. Tests also cover parameter mismatch, requested Stop, queue-input mutation, object key order, malformed JSON and Windows/Linux blockers. Actual bridge/computers/presence source was used with a deliberately unavailable Supabase client and FunctionsHttpError import stub; no live DB/device call. Local Vitest3.2.4/Node24.19.0. Exact repository frontend/type/build/rendered CI is still required and recorded in the PR after completion. Diff validation passed.

## Failed / corrected

Before the fix the async race queued the wrong computer/application. This is synthetic executable evidence, not proof of an observed customer incident. The local checkout is an isolated source snapshot; its initial commit is not the remote Git ancestry. Remote candidate has the exact shared commit as parent.

## Remains

This fixes existing direct browser_task/open_app dispatch; it adds no native desktop mouse/keyboard executor, camera/microphone job, CEO media ingestion, service installation or provider route. PR97 local capture remains separate, owner-started, source-integrated and not physically accepted. Browser operations and native OS input are distinct. Mac/Debian is untouched. No deployment/migration/config/provider/device/permission mutation. No runtime release owner asserted. No signed-in website-to-native acceptance or production read-back was performed in this scope. Existing production/rollback and all Mem0, private egress/pricing, OAuth/customer, restore/load and physical-computer gates remain.

