# Execution, Mac and reference design continuation

Owner: finish Jarvis integration, then Mac acceptance, then remaining work;
use the seven attached references for a cyan/navy 3D animated FIRBO interface.
Preserve Claude/Codex and existing tenant boundaries. Never equate prose with work.

Observed live: both agents loaded inventories. Admin has shell_exec, file_read,
code_interpreter, web_search. Artifact test produced zero tools and no file.
Harmless command and client-function probes also produced prose only.
Server access logs show 200, not upstream status. Root cause is not yet proven.

Changed locally on top of PR30 head 37768a7a (Claude base f6442b75 is an ancestor):
- OmniRoute tool-bearing HTTP 400 fails explicitly, without silently stripping
  tools and retrying as prose. Existing local-engine compatibility retained.
- Two transport regression cases; existing compatibility suite retained.
- One read-only gateway probe runs both auto/required against the local configured
  gateway, prints status/tool counts only and never executes returned functions.
- Existing CoreOrb extended with segmented cyan instrument rings and tick marks.
  Existing voice phase, agent satellites, fallback and reduced motion retained.

Tested: 21 Python cases passed; frontend TypeScript and production build passed;
focused Ruff and diff whitespace checks passed. Build retains existing chunk-size
warnings. No claim of live execution, visual acceptance or deployment.

Remaining, in order:
1. Publish matching candidate, run direct gateway probe on VPS, identify real
   provider/route tool support, repair the confirmed cause and repeat artifact
   test. Patching rejection reporting alone does not make a model tool-capable.
2. Engine adapters: company-scoped memory/knowledge, skills, workflows/lifecycle,
   approval continuation, accounting and isolation. Verify against original
   capabilities rather than registry presence. No provider consent fabricated.
3. Mac: preserve pairing and job journal; verify updater/served connector hashes,
   browser capability heartbeat, approval -> execution -> result in same task,
   real saved artifact and browser job. Installation needs the physical Mac.
4. Design: iterate current Command Center, depth/panels/cyan rings, real voice
   reactions, mobile/reduced-motion/performance verification, approvals and
   control visibility. References are not proof of privacy/local-only claims.
5. Operational acceptance: real providers, second-company isolation,
   backup/restore and reconciliation. PR13 stays CI-only.
