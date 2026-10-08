# FIRBO Memory workspace isolation — 8 October 2026

## Changed

The actual Memory page now remounts on company, actor and role changes, clearing drafts, selected notes and employee selections. It ignores obsolete reads, writes and notifications after unmount and older refresh results. Loading and failed reads are distinguished from an empty library using existing translated labels.

One synchronous operation lock prevents duplicate submits and competing upload/delete operations before React rerenders. File reads are caught inside the operation; upload checks workspace lifetime before each new row. Selected employees must exist and be enabled in the loaded workspace. Existing writer/manager permissions are retained. Deletes include both organization and memory ID and require exactly that returned row; zero affected rows are an error.

## Tested / Passed

Local actual-page React fixture and actual memory adapter: 34 cases using Vitest 5.0.1, React 19.3.0 and mocked database/identity/file promises. Exact prior adapter fails the seven new scoped-delete cases, corrected adapter passes. Actual page tests exercise remount identity, reversed asynchronous reads, upload/file failure and interruption, duplicate operation guards, employee scope, actor/organization binding, old write success/error suppression, permissions and loading/error states. Existing nine memory selection/file splitting tests retained.

Full repository frontend types/build, regression and Chromium CI are required on the final candidate and recorded in PR/Issue52. Local resolver fixtures for unrelated components/SDK are not published and are not a full frontend build or browser test.

## Failed / limits

Already dispatched database writes cannot be cancelled by unmounting. They remain bound to their original company/actor, and database RLS/composite foreign keys remain authoritative. Upload can partially complete; the existing partial reporting and reload behavior is preserved. No claim of semantic fact verification, automatic learning promotion, training, Mem0 installation, atomic upload, new permission, physical hardware or live database acceptance follows from these mocked tests.

## Remains

Source-only until accepted exact-head CI, coordination and reviewed frontend deployment. No backend, migration, provider, VPS or device change. PR100–103/107 backend rollout remains separate; actual provider prices/output bounds and one coordinated runtime owner remain necessary. Memory evidence review/promotion, current revision/contradiction handling, Mem0 accounting/atomic publication/service/filter quality and multilingual answer quality remain open. Preserve all worker, OS input/media, website-native, OAuth/customer/workflow, restore/load and production gates. No full-plan completion.

