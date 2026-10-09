# Firbo U3 preparation — verified checkpoint and next owner action

Verified on 2026-10-03. Continue draft PR #9 and the existing production plan; do not restart the audit.

## Code and release identity

- Repository: `conpol84/javris-clone`.
- Working branch: `codex/firbo-unified-gateway`.
- PR #9 target remains `claude/omniroute-engine`; the PR is not merged.
- Tested code commit: `cae9040c6563d03302a1c2c742cd8f67197d8462`.
- Last U2 checkpoint: `f3a8a345578d8209bb9f223e3025a2618b102ca6`.
- Verified production deployment: `dpl_8MfPgVXcD8oPWSp4JsU9JJd2Vdxd`, READY, still code `50bea79134fb28aacc9d5d3fcd949ba8d8239d78`.

**The npm dependency blocker is resolved at this registry snapshot. Actual Hostinger deployment/recovery and live integration gates are still OPEN. This is not an all-in-one production-ready declaration.**

## Changed

Removed the unused installed shadcn CLI tree, keeping its exact 4.21.0 CSS locally with its MIT license. The only application import was changed to the local stylesheet. Existing local UI components, page/navigation code, model handlers, Supabase data/functions, credentials, agent settings and domains were not changed in this slice.

The npm-generated lockfile removes 195 package entries and changes four retained version entries, all patches: brace-expansion 5.0.9 -> 5.0.12 and nested 2.1.4 -> 2.1.7; dompurify 3.4.13 -> 3.4.16; fast-uri 3.1.7 -> 3.1.8. No unreviewed shadcn downgrade or audit suppression was used.

Added the read-only Hostinger preflight script, nine tests and a diagnostics CI workflow. Temporary candidate-building files were removed after use. Final comparison to the U2 head reports 11 changed files, with no retained repair workflow or production deployment step.

## Passed: final normal PR workflows at tested code SHA

| Workflow | Result | Run |
|---|---|---|
| Frontend CI | SUCCESS: npm test, native/shared routing tests, isolated Edge typecheck, full frontend TypeScript, production Vite/PWA build | 37090986209; build job 111111087555 |
| Firbo dependency release gate | SUCCESS; all severities zero in both all-dependency and production-only graphs | 37090986123; job 111111087159 |
| Firbo control-plane security | SUCCESS | 37090986138 |
| Firbo read-only VPS diagnostics | SUCCESS | 37090986179 |
| Existing security-sast | SUCCESS | 37090986137 |

The final dependency job logs explicitly show total 0 for both scopes at 2026-10-03 02:47:03-04 UTC. These are npm advisory snapshots, not proof of the absence of undiscovered vulnerabilities or of secure runtime operation.

The independently built dependency candidate (run 37090708937, job 111110254821) passed all 196 existing frontend tests plus 94 Node tests (11 native contracts/languages + 43 gateway transport/routing + 40 actual handlers with mocked services). The final normal frontend workflow repeated these same test steps successfully. The unchanged U1 security suite contains 26 tests; its final workflow passed. Nine preflight tests passed locally and their final workflow passed.

The Edge check uses the documented SDK stub, not the real deployed Deno runtime. Mocked handler tests do not establish live RLS, gateway credentials, actual model responses or hardware microphone behavior.

Compiled application CSS was byte-identical before/after dependency remediation, SHA-256:
`2d08619059340e9d351415f2972eb57eabd44546dd1e6b9fd491003b9b4d0b74`.
Machine-readable evidence: `docs/FIRBO-DEPENDENCY-REMEDIATION.json`.

Existing oversized-bundle, ineffective dynamic import and deprecation warnings remain. No warning-free build or performance improvement is claimed. The first candidate failed a CSS-comment usage check; the scan was corrected without weakening the exact-CSS or zero-advisory checks. That failed attempt did not change production.

## Επόμενο βήμα για τον Κώστα — μόνο έλεγχος, όχι εγκατάσταση

### 1. Άνοιξε τη σωστή κονσόλα

Hostinger dashboard -> VPS -> Manage στον server του Firbo -> Overview -> Web Console.
Άνοιξέ το κατά προτίμηση από υπολογιστή. Αν δεν ανοίγει, επέτρεψε pop-ups για το hPanel. Μην κάνεις reboot ή reset ρυθμίσεων. Αν ζητηθεί login, τα στοιχεία μπαίνουν μόνο στο Hostinger, όχι στο chat.

### 2. Κάνε επικόλληση ολόκληρου του παρακάτω block

Δεν χρειάζεται git pull ή αλλαγή branch στον server. Το block κατεβάζει ένα προσωρινό αρχείο συγκεκριμένης ελεγμένης έκδοσης, ελέγχει το checksum και το εκτελεί μόνο αν ταιριάζει.

```bash
FILE="$(mktemp /tmp/firbo-preflight.XXXXXX.py)" &&
curl -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
  -fsSL --max-time 30 \
  'https://raw.githubusercontent.com/conpol84/javris-clone/cae9040c6563d03302a1c2c742cd8f67197d8462/deploy/hostinger/preflight.py' \
  -o "$FILE" &&
printf '%s  %s\n' \
  '5991711ca8bd53e834a10531b3148861abc4682bb6c7a51d46878930a9e794a4' "$FILE" \
  | sha256sum -c - &&
python3 "$FILE"
```

Το διαγνωστικό δεν διαβάζει .env, κλειδιά, κωδικούς, application logs, prompts ή δεδομένα βάσης. Δεν κάνει restart, pull, build, docker exec, εγκατάσταση ή κλήση μοντέλου. Επιστρέφει επιλεγμένα στοιχεία των τεσσάρων Firbo containers και δύο δημόσιων health endpoints. Οι διαδρομές αρχείων του host και τα ονόματα volumes δεν εμφανίζονται.

### 3. Στείλε μόνο το αποτέλεσμα

Στείλε το JSON που αρχίζει με `contract: firbo-hostinger-preflight/v1`. Εάν βγει σφάλμα αντί για report, στείλε το σφάλμα και σταμάτα εκεί. Μην τρέξεις repair.sh/setup.sh, μην αλλάξεις permissions και μην επανεκκινήσεις containers για να εξαφανιστεί μια ένδειξη.

Αν εμφανιστεί `firbo_control_v1: false`, αυτό από μόνο του μπορεί απλώς να σημαίνει ότι το καινούριο API δεν έχει εγκατασταθεί ακόμη. Αν κάποιο container λείπει, μπορεί να έχει διαφορετικό όνομα ή layout. Κανένα από αυτά δεν δικαιολογεί αυτόματο restart.

Το download δημιουργεί μόνο ένα προσωρινό diagnostic αρχείο. Η εκτέλεση δεν αλλάζει τις υπηρεσίες ή την παραγωγική διαμόρφωση. Μην στείλεις .env, passwords, tokens ή ολόκληρο docker inspect.

## Still required after discovery

- Identify the actual VPS deployment and image versions; prepare a matching isolated backend and exact frontend-origin access without touching production first.
- Establish off-host backup, verified restore and rollback before replacing services.
- Verify native Firbo login/admin/tenant behavior with real accounts, then a bounded agent request through OmniRoute with correlated request/fallback evidence.
- Consolidate missions and STT/TTS/legacy inference; add durable server-owned request accounting and atomic budget reservations.
- Finish provider/OAuth/key lifecycle, tenant usage controls, database migrations, prior MCP/shift hardening, monitoring, real mobile/microphone/integration tests and the remaining feature matrix.

The repo visibility was previously confirmed public and was not changed. Other sports-product infrastructure remains out of scope.

## Evidence and references

- https://github.com/conpol84/javris-clone/actions/runs/37090986209
- https://github.com/conpol84/javris-clone/actions/runs/37090986123
- https://github.com/conpol84/javris-clone/actions/runs/37090986138
- https://github.com/conpol84/javris-clone/actions/runs/37090986179
- https://github.com/conpol84/javris-clone/actions/runs/37090986137
- https://github.com/conpol84/javris-clone/actions/runs/37090708937
- https://www.hostinger.com/support/how-to-use-the-web-console-in-hostinger/
- https://ui.shadcn.com/docs/cli#eject

Next checkpoint is real Hostinger discovery and isolated backend/recovery verification, not a new audit or an untested frontend promotion.
