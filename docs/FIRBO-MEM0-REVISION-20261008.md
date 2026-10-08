# Mem0 canonical revision interoperability — 8 October 2026

Changed: normalize authoritative timestamp instants to UTC milliseconds before
the existing content-bound six-field SHA256. A candidate service-only SQL helper
and scoped current-revision reader compute the identical hash in PostgreSQL.
They reuse the prior authenticated current-row reader and its transaction locks;
all non-null deletion markers are excluded, including empty strings and false.
The pure hash helper is not an authorization or publication operation.

Tested: Node retrieval regressions and offset/fractional spelling, exact content,
tenant/agent/expiry binding, bounded timestamp years; dedicated PostgreSQL17.6 CI
compares actual Node hashes with SQL across Unicode/control characters, own/global
agent, six timestamp cases, three DB timezones, invalid timestamps, client denial,
membership/agent scope, expiry/deletion, and READ COMMITTED/SERIALIZABLE lock races.

Passed at authoring: 21/21 local Node cases. Exact-head SQL/CI results are recorded
in the PR and Issue52 after completion, never inferred from source or mocks.

Failed/corrected: prior raw wire timestamp strings gave different revisions for
the same instant. Default-disabled Mem0 has no live index requiring a rollout or
backfill. Millisecond precision matches JavaScript Date; sub-millisecond timestamp
changes alone do not create a new revision. Actual content changes still do.

Remains: both reader/revision migrations are candidate-only. No live apply,
SDK/service/vector store, provider, accounting admission, atomic publication,
network/index write, model enablement or consumer exists from this change.
Future atomic publication must lock and compute authoritative revision in its
own transaction and verify separately settled extraction/embedding identities;
this reader's earlier snapshot is not atomic authorization for a later write.
Real price/capability/filter quality, private service topology and receipts,
quality baseline, real accounts/computers/recovery remain separate gates.

Base shared: ab677ac36a8a621a1bb893b7c3253c8a406743fd. Preserve all histories.
Production/owner Mac-Debian-VirtualBox are untouched. No runtime release owner.
