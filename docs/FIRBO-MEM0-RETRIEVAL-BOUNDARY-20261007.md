# FIRBO Mem0 retrieval boundary — preparatory source stage

The owner selected Mem0 alongside the four now-live Skills adaptations. Mem0
is still not installed. This separate source stage implements the boundary that
a future self-hosted, accounted Mem0 search must cross before it can influence
CEO/agent memory. Existing Supabase memories and Knowledge remain authoritative.
There is no new live consumer, SDK, vector store, ingestion, network dispatch,
provider request, database write, migration or deployment in this stage.

## Contract and trust

`buildMem0SearchRequest` defaults disabled. Explicit server enablement constructs
an OSS `search` query using organization AND (company-wide OR current employee)
metadata filters. Query length and result count are bounded. Scope must come from
authenticated server context and verified organization/employee membership, never
from model arguments, frontend claims or Mem0 output. This utility does not itself
authenticate anyone or grant permission to dispatch. Returning a request is not
accounting admission or an approved provider route.

Mem0's documented filters vary by vector store; some unsupported operators are
silently ignored. Therefore matching request filters alone cannot establish
tenant isolation. `resolveMem0Search` treats its response only as a list of
untrusted references. It ignores returned text, provider identities and scores.
It asks an injected reader for the referenced authoritative FIRBO rows AFTER
search completion, independently verifies organization and company/employee
scope, and returns exact current database text and source task IDs.

`memoryIndexReference` generates a SHA-256 revision from the authoritative ID,
organization, employee, actual content, update time and expiry. A future indexer
must store these four `firbo_*` metadata fields with each indexed reference.
This is a new FIRBO indexing convention, not an existing Mem0 or live DB feature.
Changing content invalidates an index entry even without an advanced update time.
Missing/deleted rows, metadata tombstones, expired notes, invalid dates,
wrong-employee/company rows, stale revisions and duplicate DB identities cannot
be returned. Unsupported/malformed envelopes and DB failures propagate rather
than substituting stale/provider text. There is no automatic retry or hidden
provider fallback in this utility.

The reader's future implementation must enforce scoped membership/RLS, limit the
query to these IDs and obtain current rows with fields matching the existing
`public.memories` schema. Supplied rows and scope are trusted only after those
server checks. Tests exercise the callback contract with fixtures; they do not
prove a real DB transaction or new authorization path. A DB snapshot can change
after read-back: this module does not provide an atomic read/publication lock.

At most 64 engine references/read-back rows are accepted. Output is capped at 12
complete notes, 4,000 characters per note and 12,000 characters total. Notes are
never truncated into partial facts. Contradictions remain separate with source
IDs; the adapter does not invent a merged conclusion or certify truth. Provider
response bytes, query privacy, service deadline, DNS and JSON transport decoding
must be bounded separately before this module receives a parsed response.

## Next integration sequence

1. Select a supported pinned self-hosted Mem0 version/vector store. Disable
   unreviewed cloud defaults and telemetry; prove its actual filter behavior.
2. Bind authenticated FIRBO organization/employee context and the fresh Supabase
   reader. Preserve existing memory and Knowledge as the fallback authority.
3. Define minimal approved index ingestion, source IDs, corrections, expiry and
   delete propagation. Never automatically ingest conversations or credentials.
4. Configure authorized extraction and embedding routes separately with actual
   pricing, capability/dimensions, output bounds and durable accounting. Even
   search can incur embedding cost; this stage supplies no free-price shortcut.
5. Provide bounded private egress/service access and supervision, verify exact
   installed bytes, then exercise harmless admitted requests with actual receipts.
6. Compare useful retrieval against FIRBO's current baseline using authorized
   provider tests, including contradictions, deletion, expiry, outages and
   cross-customer isolation. Only then wire a default-disabled live consumer
   through a coordinated exact-head release and owner acceptance.

No pending provider task may be settled or retried merely to exercise Mem0.
This stage neither resolves the current timeout/reconciliation backlog nor
changes the Catalina Mac's advertised capabilities.

## Primary references reviewed 7 October 2026

- [Mem0 OSS metadata filtering](https://docs.mem0.ai/open-source/features/metadata-filtering)
  documents AND/OR search filters and differing vector-store implementations.
- [Mem0 Python quickstart](https://docs.mem0.ai/open-source/python-quickstart)
  documents the `results` envelope and default extraction/embedding/storage stack.
- Existing FIRBO `20261001000002_agents_chat_memory_knowledge.sql` supplies the
  authoritative memory fields. No migration replay or schema change is required
  for this isolated source utility.

## Checkpoint

**Changed:** four new files only: pure TypeScript reference/query/resolution
boundary, adversarial executable Node fixtures, a dedicated pinned CI workflow
and this integration contract. Base shared acf9aa350279722d943287a2096394806bc21dae
preserves both completed PR83/84 and prior Claude/GPT/parity contributions.

**Tested / Passed locally:** 17 executable cases exercise forged provider text,
two-company/employee scope, corrections without timestamp changes, deletion
between search and read-back, expiry at/during validation, duplicate identities,
malformed/oversized input, DB outages, context bounds, contradictions/provenance,
scope/reference mutation across awaits and invalid/backward clocks. No provider
or device calls. Strict TypeScript check and 11 existing Skills/runner-accounting
cases also pass. Fresh complete live runner93 read-back matches the unchanged
shared parent in all 16 files. Final exact-head acceptance is recorded in the
associated PR; no runtime file is redeployed for this source stage.

**Failed / limits:** no installed Mem0, real provider quality, actual database
reader, atomic publication, transport deadline or physical-device acceptance is
established. This is a preparatory boundary, not a completed memory engine.

**Remains:** the reviewed integration sequence above and existing Issue52
provider/VPS/physical Mac/OAuth/customer/workflow/restore/load gates. Current live
Skills/runner/production and rollback are preserved. No full-plan completion.
