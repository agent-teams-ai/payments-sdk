# Independent review: cold TypeScript build dependency repair

## Disposition and exact source

**No material P0, P1 or P2 finding.** The repair correctly gives each no-emit consumer project explicit dependency edges to the four runtime declaration producers it consumes. Strict ownership, the real typed-lint backend, consumer no-emit behavior and runtime declaration emission remain intact. The change is suitable for integration, subject to the delivery owner's required exact-head local and hosted gates.

Reviewed the clean committed head **`d303f2a36774555bd885df63e536b97428c200a0`**, relative to **`95e996ff0bbe8edb003fcd42ab66c6aa429a7253`**, on 2026-10-20. Independently read HEAD and empty `git status --porcelain` after the review. The exact committed diff is byte-identical to `cold-build/fix.patch`: **3 files, 17 insertions, 1 deletion**, SHA-256 **`538dc9b01661af58a85afc86838f91cae72fcbafec85eead2295535defc2eccf`**.

| Changed input | Final SHA-256 |
| --- | --- |
| `tsconfig.checks.json` | `ead663c843a01263fb768628f3057966492c38ab17cdcada37f5b909719a6637` |
| `qualification/observation/tsconfig.json` | `00b16345291f9d0cab880a356c5d4793594d0fb7638ab384a839fc48b23e1e32` |
| `docs/foundation-adoption.md` | `10caf602b8c8428890e8648332d7572e94b05b889b89baca1804be14b6a7f243` |

All **212 tracked files** independently match the fixed hashes in `cold-build/source-manifest.json`. That manifest's changed-path set is exactly the three paths above. This binds the producer's baseline-plus-patch evidence to the actual reviewed commit without treating a future source revision as already qualified.

## Authority and review scope

Read the repository `AGENTS.md`, `docs/developer-stack.md`, relevant accepted implementation-plan and architecture sections, the exact retained Q source, the retained organization Engineering Quality Standard and the earlier independent `pr-foundation-final-review.md`. An attempted fresh `gh api` read of the maintained organization standard failed at the sandbox proxy socket (`operation not permitted`). Accordingly the explicitly identified retained `sources/org-quality-5499550.md` supplies the applicable reviewed guidance here; this memo does not claim a fresh live-policy read.

Inspected the root solution/base/checks configs, all four producer configs and manifests, observation config/source imports, root scripts, lint config, ownership guard, both workflows, packing/archive helpers and both published-consumer generators. This review concerns the changed project dependency graph and its effects on strict compiler ownership, typed lint discovery and consumer/release isolation. It does not re-review unchanged payment, database, provider or process algorithms.

The earlier Foundation review's 21 enforcement/configuration input hashes still match, except for the two intentionally changed consumer configs. Its ten source/document bindings still match, except for the intentionally changed adoption document. The two installed native lint inputs and all five installed Foundation preset files in the producer's independent install match the earlier review's recorded hashes. Reusing the unchanged policy, lifecycle, packaging and runtime-source conclusions is justified by these byte comparisons; changed project discovery received new executable witnesses below.

## Why the dependency graph is correct

The checks project consumes all four runtime packages through root examples/tests and package tests, including relative imports of adapter `dist` entrypoints. Observation qualification imports core, Paddle, PostgreSQL and Get Modular's observation export. Their explicit references therefore describe real declaration dependencies rather than speculative coupling.

Before the repair, the root solution listed producer and consumer projects as siblings. That listing made all projects discoverable but did not express a consumer-to-producer prerequisite. The added edges point from each development consumer to the existing composite runtime producers. Adapter producer projects still reference only core; core has no outward project dependency. There is no cycle, no producer-to-test edge and no dependency on either no-emit consumer from a runtime project.

The package manifests still resolve their public type exports to `dist`. Waiting for the declaration producers addresses the observed missing-module failure while preserving public package resolution and the existing consumer tests. The fix does not substitute source aliases, disable declaration checks, serialize the entire CI graph, or weaken any required gate.

I independently ran the installed TypeScript 7.0.2 `-b --dry --verbose` against an exact copied fixed source tree with no local generated outputs. It discovered the four runtime projects, checks, observation and the root solution, with the producers before the two consumers. This read-only graph witness corroborates the inspected references; it is not represented as a second cold build execution.

## Independent effective configuration and ownership checks

Created `/tmp/payments-cold-independent-bm90n32p` from the retained exact baseline source archive, overlaid only the three final file bytes, and linked the producer's separately installed dependencies for focused diagnostics. No maintained source, shared build output, shared dependency installation or producer evidence file was modified. This copy has dependency links to the producer fixture, so it is deliberately not called an independent frozen-install or cold-build reproduction.

Executed `tsc -p PROJECT --showConfig` for all six owning projects with the admitted Node executable and actual installed TypeScript 7.0.2. The effective settings are:

| Project family | Strict | skipLibCheck | noEmit | Declaration emission | Composite |
| --- | --- | --- | --- | --- | --- |
| Four runtime producers | true | false | false | true | true |
| Checks | true | false | true | false | false |
| Observation qualification | true | false | true | false | false |

Root-file ownership still contains **78 maintained `.ts` sources and zero ownership mismatches**. Each source belongs to exactly one owning project's explicit file set. The counts remain runtime 8/5/10/6, checks 43 and observation 6. References did not broaden either consumer's include patterns or move any runtime source into a consumer's explicit ownership set.

No compiler option changed in this patch. Runtime source still owns ESM/declaration output; both consumers remain no-emit. The unchanged `tools/toolchain.ts` still asserts the admitted compiler/runtime, strictness, `skipLibCheck:false`, TypeScript-only maintained sources and exactly one strict owner. No exclusion, lint suppression, findings baseline, source-dependency policy, package/dependency manifest or lockfile changed.

## Independent actual-backend typed lint discovery

Repeated the affected discovery and routing witnesses against the installed Oxlint **1.83.0** and actual `oxlint-tsgolint` **7.0.2001** backend. Ordinary `.oxlintrc.json` project discovery was used, with **two threads** and **no `--tsconfig` override**. Disposable witness files existed only in the copied tree.

For each of runtime source, root tools, a package test and observation qualification, an exported optional-string guard with an awaited Promise passes with exit 0 and no diagnostics. An exported function containing bare `Promise.resolve(1)` fails with exit 1 and specifically `typescript(no-floating-promises)`.

Then three separate controls changed only one owning project's `strictNullChecks:false` and the necessary `exactOptionalPropertyTypes:false`, restoring its bytes afterward. The otherwise permitted witness produces the expected strict-compiler-option diagnostic only under the modified owner:

| Only modified owner | Runtime source | Root tools | Package test | Observation |
| --- | --- | --- | --- | --- |
| Checks | Pass | Strict-option failure | Strict-option failure | Pass |
| Core runtime | Strict-option failure | Pass | Pass | Pass |
| Observation | Pass | Pass | Pass | Strict-option failure |

Every indicated failure specifically reports that the typed rules require `strictNullChecks`. This demonstrates that adding references did not cause the linter to route tools/package tests through runtime compiler settings, route runtime source through checks, or lose observation's own strict project. The eight permitted/rejected invocations and twelve control invocations completed as expected. Full temporary results remain at `/tmp/payments-cold-independent-bm90n32p/independent-witness-results.json`.

## Packed-consumer and release isolation

The observation qualifier copies `qualification/observation`, including its base `tsconfig.json`, to an installed public-consumer fixture. I specifically checked this possible contamination path rather than assuming the new relative references are harmless.

The actual qualifier creates child NodeNext and Bundler configs that extend this base. Independently constructed the same copied source layout at `/tmp/payments-observation-reference-review-znhea76i`, with **zero producer package tsconfigs**, using the real child-config generation shape from `tools/qualify-observation.ts`. For both profiles, `--showConfig` contains **no project references**: the base's references are not inherited by those child configs. Both actual compiler invocations pass with strictness and `skipLibCheck:false` retained and `noEmit:true`.

This focused check reused the already installed producer fixture's package exports through dependency links. It establishes that the new workspace references do not require absent workspace producer configs in the generated consumer. It does not independently prove archive contents or an ordinary production installation. The real packed gates remain required.

The production npm consumer generator separately writes a standalone explicit compiler config and copies selected `.ts` fixture files, so it does not carry the changed observation base config. Other packed consumers generate their own configs. Runtime package `files`/exports, packing/archive audit source, both workflows and release admission are unchanged. No new runtime dependency, emitted test/tool output or release input is introduced by this diff.

## Producer evidence inspected, with attribution

Independently read the retained producer report, source/patch provenance, installed-link isolation record and raw compiler/lint/toolchain/Foundation transcripts. Recomputed the source archive SHA-256 (**`67bc9eabb363be9f6d6684e570edb62f6fcb4108118ecdae96acb584a56abbcc`**), exact committed patch hash and all eleven retained step-log hash bindings; all match.

The producer records an own-store, frozen independent install into `/tmp/payments-cold-build-pmt69gqn/source`, with all payments workspace links resolving inside that fixture and zero `dist`/build-info outputs before each compiler outcome. Its unchanged lock hash matches the reviewed source. The retained compiler evidence shows baseline `pnpm typecheck` fails with missing adapter modules and cascading type errors; fixed `pnpm typecheck` exits 0 in **8.819 seconds** after all outputs were removed. The retained fixed toolchain/lint checks report 78 strictly owned sources and zero lint warnings/errors, and the outside-sandbox admitted-Node Foundation invocation reports full selected coverage and zero diagnostics.

These executions were performed by the dependency-fix producer. I examined their retained evidence and bound it to the final commit; I did **not** perform a second independent frozen installation or rerun that cold compiler build. The fresh reviewer executions in this memo are the effective-config/ownership checks, dry graph inspection, actual-backend positive/rejecting and strict-owner controls, and isolated generated-consumer compiler checks.

## Limits and remaining delivery evidence

No P0/P1/P2 repair is requested by this review. The original cold-build defect is addressed without weakening the intended integration.

I ran no database operation, full `pnpm check`, shared-root build, full lint, packed archive suite, install, remote mutation or Git mutation. The delivery owner reported starting complete local exact-head gates and push/hosted verification; those results were not complete or independently reviewed here and must not be inferred from this scoped disposition. Final required gates and hosted Checks at `d303f2a36774555bd885df63e536b97428c200a0` remain the delivery owner's responsibility.
