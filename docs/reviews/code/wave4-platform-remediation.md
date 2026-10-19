# Wave 4 platform remediation and final-delta recheck

## Exact subject and disposition

- Repository: `agent-teams-ai/payments-sdk`.
- Exact combined candidate: **`7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`**.
- Installation-recipe correction included: **`70db2ef`**.
- Isolated detached worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform`.
- Review date: 2026-10-19 UTC.

**The original wave-4 platform P2 is corrected and independently verified. No new actionable P0/P1/P2 was established in this bounded remediation and platform-delta recheck.** The original `wave4-platform.md` remains historical evidence for frozen revision `fcd57f9ad4887338edab351cb1ef6457e97644a1`; this report records the correction and current packaged consumer result.

No production source was edited, committed or pushed. No release/tag/API mutation or npm publication was performed.

## Public tarball recipe: independently followed and passed

The corrected `docs/releasing.md` explicitly explains why adding all local tarballs in one command does not resolve unpublished transitive SDK dependencies. It supplies the three plain-host `file:` overrides in the **host workspace root's** `pnpm-workspace.yaml`, directs readers to preserve existing settings, and gives the optional fourth Get Modular override and exact qualified peer command. Relative paths are clearly relative to that configuration file.

This review did not substitute `tools/packed-consumers.ts` for the public recipe. It independently:

1. Checked out the full exact candidate and ran `pnpm typecheck`, rebuilding the current package declarations/runtime while compiling the strict tests/tools/examples project.
2. Ran `pnpm release:dry-run` to produce and audit **current-candidate** tarballs. The four archives passed with core/Paddle/Postgres/GM entry counts **30/23/40/15**.
3. Extracted the corrected guide's actual YAML and `pnpm add` shell fences.
4. Created two new consumer directories outside the repository, each starting from only a private ESM host manifest, current tarballs in `payments-candidate`, and the literal applicable guide YAML.
5. Executed the guide's plain `pnpm add` shell fence verbatim in both consumers; the independent modular host then executed the guide's optional Get Modular fence verbatim.
6. Imported every selected SDK package through its public package export and compiled the installed declarations with actual TypeScript **7.0.2**, `strict:true`, `skipLibCheck:false` and both NodeNext/Bundler resolution on both supported Node floors.

No extra SDK override, `@types/node` override, workspace alias, declaration suppression or packed-harness helper was added. In the modular consumer the only additional overrides/peers were those actually written in the guide. Both fresh installations succeeded; the registry-core 404 from the original finding no longer occurred.

### Actual consumer verification

| Fresh external consumer | Node runtime | Public runtime imports | Strict NodeNext | Strict Bundler |
| --- | --- | --- | --- | --- |
| Plain core/Paddle/PostgreSQL recipe | 24.21.0 | Passed | Passed | Passed |
| Plain core/Paddle/PostgreSQL recipe | 26.11.1 | Passed | Passed | Passed |
| Same recipe plus documented Get Modular variant | 24.21.0 | Passed | Passed | Passed |
| Same recipe plus documented Get Modular variant | 26.11.1 | Passed | Passed | Passed |

The modular consumer also independently resolved and compared the physical Resources entry used by the host and by `payments-get-modular`; their real paths matched on both runtimes.

Independent orchestration source: `/tmp/payments-w4-remediation-recipe.ts`. Fresh consumers and machine-readable result: `/tmp/payments-w4-independent-recipe-f8XDJT/result.json`. These are separate from the coordinator's earlier recipe experiment and use this report's exact combined candidate, including its later PostgreSQL corrections.

### Commands executed

With qualified Node 24.21.0 and `/tmp/payments-sdk-tools` prepended to `PATH`:

```sh
pnpm typecheck
pnpm release:dry-run
node /tmp/payments-w4-remediation-recipe.ts
```

The final command runs the literal documented installation fences under pnpm **11.25.0**, then invokes each actual Node executable for runtime imports and TypeScript compilation. All commands above exited **0**. The independent result records all **eight** strict consumer/runtime/resolver combinations as passed.

## Final platform-delta inspection

Compared `fcd57f9ad4887338edab351cb1ef6457e97644a1` with this exact candidate. The production Get Modular module/contracts, package manifests, workspace/catalog/lockfile, compiler configuration, Foundation policies, packaging tools, release tools and both workflows are unchanged. Consequently the earlier public `processReclassification` authority/physical-close probe remains applicable to the unchanged GM production implementation; it was not needlessly repeated. The GM test-only delta supplies the new neutral observation fields and is included in the successful strict typecheck.

The changed public core observation contracts add provider-neutral status interpretation, collection semantics and item profile fields. They import no Paddle, PostgreSQL, Get Modular or Foundation types. The new `tests/fixtures/consumers/adjustments.ts` is a pure nonproduction evidence-qualification helper with a type-only dependency on core; it does not acquire either owner's storage, policy authority, transaction or acknowledgement responsibility. Its use therefore does not introduce a cross-owner Unit of Work or shared runtime ledger. Financial correctness of these corrections remains assigned to the domain/provider and consumer reviewers.

The PostgreSQL admission/job-generation changes remain within the existing storage/worker adapter boundary. Their durability, concurrency and repair semantics remain assigned to the PostgreSQL reviewer. This platform review inspected their boundary impact rather than duplicating that semantic qualification.

The new `docs/implementation-status.md` maps P0–P7 to maintained implementation and evidence, while explicitly keeping exact-commit CI, live provider behavior, production owners, physical restore/HA, the browser declaration blocker and Observation artifact admission separate. The review index retains historical findings and identifies correction qualification as in progress. No new source/link/delivery regression was established in this inspected delta.

## Release controls and limits

The release candidate workflow remains unchanged from the previously inspected exact-main-push admission design. The coordinator reports installed immutable `v*` update/deletion protection (ruleset `25434236`), strict main Required checks, no invented human-approval requirement and default read-only contents permissions. This recheck did not independently query or mutate repository protections; that report is owner-supplied evidence, separate from the local commands above.

No successful main-push Checks run or live release is claimed for this still-unmerged candidate. Its exact final merged commit must earn the maintained aggregate CI and unexpired artifact before release. This recheck did not repeat the financial/real-PostgreSQL/E2E suites, qualify an unpublished Get Modular Observation train, run a real Paddle browser/account flow, publish npm packages, or perform backup/PITR/HA exercises.

The established installation defect is closed for this exact candidate by a fresh public-recipe installation and strict consumer verification using its current archives.
