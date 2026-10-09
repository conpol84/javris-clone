# FIRBO mission and meeting role evidence — 8 October 2026

## Changed

Continues accepted PR102 on shared `6ec34990c6c9fa878f568072bc74751374603382`.
The actual mission handler now uses the existing role-evidence policy for each
meeting speaker's current enabled company-scoped DB type. CEO meeting minutes,
mission planning and synthesis use CEO evidence rules because those operations
already act as the CEO, including the existing fallback when no explicit CEO
row is present. Request-body role labels do not override the scoped speaker.

This preserves owner instructions, language selection, roster scope, model routing,
token caps, budget admission, per-speaker reservations and settlements, and task
creation semantics. It adds one existing shared dependency to the mission bundle,
which now contains five files. Chat and runner behavior are unchanged.

## Tested and passed

The new tests invoke the actual TypeScript handler, replacing only the SDK import
with synthetic auth/DB objects and the provider HTTP transport with fixtures.
There are 64 meeting cases (8 roles × 8 languages), 16 CEO plan/synthesis cases,
one unknown-role/body-override case, and three denied-auth/membership/admission
cases. Each successful model request checks its actual system prompt, scoped
agent selection and existing accounting identity/settlement. Owner instructions
and language remain present. No live customer data or inference is used.

Before the fix the old handler failed 81 of these 84 cases; all three denial
cases passed. After the fix 84/84 pass, and 349/349 combined mission, Chat,
runner, memory and bundle regressions pass on local Node24.19. The dedicated
workflow repeats the same assertions on Node22.22. Final exact-head CI status
and immutable source identities are recorded in the PR and Issue52 checkpoint.

## Failed

The 81 pre-fix failures are the demonstrated missing policy binding, not a
production model-quality measurement. No final local assertion failure remains.

## Remains

Source-only. No backend deployment, frontend release, DB migration, provider call,
configuration, permission, device job or Mac/Debian/VirtualBox action.
Current production mission v30 has four files and does not contain this change.
Release requires fresh coordinated complete-bundle/configuration/accounting
preflight and full observed live-byte verification. PR100–102 Chat/runner source
changes also remain pending their coordinated backend rollout.

Prompt-binding tests do not prove factual model answers, semantic quality,
business acceptance or independent truth of saved employee reports. Mission
Memory/Knowledge/Skills retrieval is not implemented by adding this policy.
Measured multilingual factuality, contradictory/stale/injected evidence and real
approved business evaluations remain separate gates. This stage does not change
existing meeting action creation or claim new receipt enforcement in that path.

Mem0 remains uninstalled/default-disabled. Dedicated DB accounting/publication,
service/vector-store/filter/price/quality gates, universal computer executors,
CEO media ingestion, website-native receipt, OAuth/customer/provider/recovery
acceptance remain in the consolidated PR102 production matrix. No full-plan
completion claim is made. Preserve existing OpenJarvis/OmniRoute/FreeLLMAPI,
both contributors and rollback history.
