# FIRBO PR #18 release checkpoint

## Changed
- PR #18 merged with preserved history into Claude branch: 7c520cd62531c6cb0fc7fbaa4dc756e97e31a621.
- PR #16 is also merged; newer hardening head 8b22130 is retained.
- Dependency override image-size 2.0.4, PowerPoint pin/lock alignment and migration ledger filename reconciliation are now retained in both contributors' common history.
- Released exact tested source ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a from READY preview dpl_iUFMLC2RxZ6xg31UnyP6U9DiTx7K with withLatestCommit:false.

## Tested / passed
- All seven exact-head PR workflow runs passed, including operational pages, frontend, security and PostgreSQL lifecycle.
- Production dpl_7BjPjgmuseFTEFgTRTtBoJpnqcVX is READY; independent firboai.app lookup returns this deployment and ce421e3.
- Served Connector and browser modules match repository bytes via cmp. SHA256 connector 55c429a7dcb61a1e5a6b19fcc7ffbeda5c24fb62edad13bfeae755b87b9c295b; browser 2748e17b59cbea0c7638eb6dea8c185ac132700b0189699349292ed21c4d4621.
- Post-merge branch comparison reports no Codex changes missing from Claude, zero changed files.

## Failed / limitations
- No real Mac browser task, OAuth, external messaging or second-customer acceptance performed in this continuation.
- Physical Mac installation is unavailable through this execution environment. Existing pairing must be preserved.

## Remains
- Continue latest main continuation and OpenJarvis parity matrix, with physical Connector/browser update and real useful artifact acceptance first.
- Complete real sandbox isolation, OAuth consent/refresh/revoke, authorized Telegram/WhatsApp tests, company adapters, accounting, signed desktop and recovery gates.
- Do not equate complete upstream source presence with complete runtime parity.
- No migration replay, backend redeploy, device permission change or external message occurred here.
- Prior frontend rollback target: dpl_58bZ53W55Y6e76rMgbBd1rcoERmB (354a12d). Preserve migration-aware connector v27 and runner v80.

References: https://github.com/conpol84/javris-clone/pull/18 ; https://firboai.app
