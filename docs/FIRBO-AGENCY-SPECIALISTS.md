# Agency specialist methods — isolated continuation, 9 October 2026

Continues [Issue52](https://github.com/conpol84/javris-clone/issues/52) and the
[conversation handoff](FIRBO-HANDOFF-20261009.md). The owner assigned this chat
later-stage integration while another chat continues VPS/core rollout. This
candidate is separate from PR114 and has no runtime release ownership.

## Implemented behavior

Five existing catalog templates now carry reviewed Agency Agents methods:
Deep Research Analyst, Autonomous Coder, QA Engineer, DevOps Engineer and
Content Writer. Catalog cards disclose the expected deliverable and link to the
immutable upstream source. The same information is expanded before hiring.
All new explanatory UI text is present in the eight existing languages.

`AGENT_TEMPLATES` enriches only those five exact IDs. The existing `hireAgent`
function sends the resulting prompt to the existing company-scoped `hire_agent`
RPC, including owner instructions. The source revision and adaptation version
are retained in the stored prompt. This is real source wiring into the hiring
path, not a standalone catalog document or disconnected import script.

Existing slugs, pricing tiers, names, tool lists/policies and onboarding references
are preserved. Existing hired employees are not modified; the new method applies
to new hires after this candidate is released. An update flow for already-hired
employees would need separate review and preservation of their custom prompt.
Hiring a persona does not enable a computer, provider, source adapter or tool.

## Exact integration boundary

- The upstream persona snapshot and license are pinned to
  `f99f6aa910a442b0197b768ce0ea7751e35e2060`; manifest blob IDs and SHA256 match the
  retrieved source bytes. Static web builds include the license notice.
- Templates use only existing employee permissions. Research may use enabled
  search/page reading. Server work remains subject to the existing server routing,
  entitlement, approval and accounting path. Company sandbox access does not grant
  repository, VPS-admin or physical-device access.
- No Supabase schema/functions/secrets, VPS services, Mac/Debian install, worker
  routing, memory repair or production promotion is included in this PR.
- No upstream global installer, native Agency app or AgentReach adapter was run.
  Tavily credentials and live search acceptance belong to the separate research
  configuration stage. The methods do not claim those services are available.
- Existing selected skills (Superpowers delivery, UI UX Pro Max review,
  Last30Days research and Humanizer editing) remain available in the Skill Library.
  They can complement these specialists through the existing assignment UI;
  this change neither duplicates nor silently assigns them.

## Validation and limits

Local frontend suite: **854 tests /77 files pass**, including new tests for
the actual hiring data function, preserved owner instructions/company/tool
parameters, backend rejection and eight-language rendered method details.
TypeScript and production Vite/PWA build pass; existing analytics/chunk-size
warnings are unchanged. The first typecheck exposed Object.hasOwn exceeding the
repository's configured library baseline; the code uses the compatible
Object.prototype.hasOwnProperty.call implementation.

`tests/firbo/agency-specialists-rendered.mjs` exercises the actual StorePage,
HireDialog and hiring function using synthetic RPCs and localhost-only network:
catalog discovery, keyboard disclosure, translated method preview, custom owner
instructions, company-scoped request, failure without a success transition and
320/390/1280px reflow. The dedicated workflow also verifies exact source snapshots
and runs the complete frontend suite/build. Final rendered/CI evidence is recorded
on the PR and Issue52; do not infer a pass merely from the script existing.

Local Chromium installation returned a truncated/invalid download archive, so
that attempt is not a rendered-test pass. The workflow runs the same pinned
browser setup on GitHub. No live customer hire, provider task or device job was
performed for these tests.

## Merge and release handoff

1. The PR is stacked on `codex/firbo-vps-dispatch-20261009` at b909f0e3; do not
   independently promote its preview over another chat's current release.
2. The release owner reads fresh Issue52 claims/refs, reconciles newer work and
   merges both contributor lines. If PR114 has landed elsewhere, retarget/merge
   this small catalog diff against that accepted source and rerun affected checks.
3. Use exact-source CI/preview and the existing release procedure. This catalog
   delta needs a frontend release only; it introduces no new Edge bundle or DB
   migration. Parent PR114's remaining dependencies still need their own rollout.
4. Verify one new specialist hire in the correct company and read its stored
   prompt/source back. Existing agents must keep their customized instructions.
5. Perform the useful tasks below before claiming specialist quality or complete
   business acceptance. Keep all prior worker, management and recovery gates.

## Five useful-work acceptance cases

| Specialist | Task | Evidence that closes the case |
| --- | --- | --- |
| Research | Compare three relevant providers using official documentation | Source-linked report, actual search/read results, contradictory evidence/gaps and attributed provider usage |
| Developer | Fix a supplied reproducible defect in an authorized test repository | Real patch/artifact, targeted regression check, independent read-back and actual commit/reference if created |
| QA | Verify that fix against original requirements | PASS/FAIL/NOT TESTED matrix, exact source and reproduction evidence, no invented defect quota |
| Operations | Prepare and, where authorized, exercise a recovery runbook | Actual health/backup/restore observations; local backups not labelled off-host recovery |
| Content | Produce a Greek campaign from company knowledge and verified findings | Ready-to-review channel drafts, preserved facts/citations and explicit draft state; publishing is a separate authorized action |

For every worker task: pending is not complete, explicit device selection stays
binding, and terminal results must correlate with the original request/job/device.
No completion date or quality score is inferred from passing source tests.
