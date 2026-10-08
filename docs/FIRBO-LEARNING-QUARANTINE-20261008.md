# Runner learned-memory quarantine — 8 October 2026

Owner requires role-specific intelligence and trustworthy durable memory. A saved
model output and a task ID prove neither truth nor owner approval.

Changed:
- Reproduced actual old handler inserting fabricated revenue into memories as a
  fact. Model `learned` text now stays in the claim-bound task result under
  `learning.status = unverified`, as proposals; there is no automatic memory insert.
- The runner's initial memory context and actual loop memory-search both exclude
  legacy `source: learned`, non-null deletion markers, expired and invalid-expiry
  rows. Existing company/global-or-own-agent DB scope stays enforced. DB filters
  precede limits; defensive row filtering also rejects synthetic bad responses.
- Existing rows are not deleted or rewritten. Manual non-learned Memory and
  Knowledge stay available. No approval/review UI or verified promotion API is
  invented; proposals require a future explicit evidence/review workflow.
- Updated only two changed bytes/hash entries in the complete runner manifest.

Tested/Passed:
- Old actual-entrypoint fixture failed because one invented fact was inserted;
  fixed handler writes zero memory rows and publishes the unverified proposal.
- Initial context and actual loop memory-search fixtures withhold poisoned legacy,
  deletion and expiry rows while retaining manual notes and org/agent predicates.
- Focused helper/handler/bundle suite, exact remote bytes and final-head CI are
  recorded in PR/Issue52. Synthetic auth/DB/model transports are used; this is
  actual handler code, not a live PostgreSQL/device/provider acceptance.

Failed/corrected:
- Initial local checkout lacked chat/mission test dependencies; fetched exact base
  source. A draft insertion placed proposal metadata before parsed initialization
  in the error path; regression tests rejected it and it was moved to final result.
  No erroneous draft was deployed or applied to live data.

Remains:
- This is source-only until coordinated exact bundle release/live read-back. No
  deployment, migration, provider call, permission change or customer-row mutation.
- Other chat/mission/native memory consumers are not certified by a runner-only
  filter. Existing non-learned rows are not independently truth-verified here.
- Task reports/summary/pulse may still contain model assertions: evidence-bound
  business/role evaluations and provenance-aware synthesis remain separate gates.
- Durable reviewed promotion/corrections, dedicated Mem0 accounting/atomic DB
  publication, pinned service/filter evidence and actual prices/quality remain.
  Mem0 is uninstalled/default-disabled. This is not model training or Superbrain.
- Preserve current production, rollback, all histories and existing real-account,
  device/provider/OAuth/customer/restore/load gates. Mac/Debian/VirtualBox untouched.
