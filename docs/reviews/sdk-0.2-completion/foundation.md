# Independent final-profile review: Engineering Foundation adoption

**Final-head update:** the source-bound recheck is complete at clean `95e996ff0bbe8edb003fcd42ab66c6aa429a7253`; no material P0/P1/P2 finding. The original pending-recheck statements below describe the initial fixture snapshot and are superseded by the final section.

## Disposition and subject

**No material P0, P1 or P2 finding in the Foundation integration reviewed here.** Both findings in the [initial independent review](../foundation-profile.md) are corrected: the complete lint command inherits Foundation's Node/type-aware preset with its real backend, and the standard local lifecycle scripts are present. The actual installed type-aware backend accepts permitted code and rejects an unhandled Promise in runtime, root tooling, package tests and qualification sources. Isolated compiler-option controls demonstrate that runtime and checks files use their separate owning strict projects.

This is an independent review of the meaningful, selected Foundation profile, not a requirement to enable every optional producer capability. It covers configuration, scripts, strict project routing, development-only dependencies, source/declaration enforcement, CI fail-closed behavior and the new adoption record. It does not re-review payment algorithms, assert that all final-source gates have run, or establish production readiness.

The initial executable fixture snapshot was copied while HEAD was **de5324cb09259fe74514f3421f6e340672a74e31**, with concurrent scoped source corrections in progress. Every existing tracked file's SHA-256 at that snapshot is retained in `foundation-final-evidence/snapshot-sha256.json`. The root delivery agent subsequently committed source corrections; the lint/compiler configuration inputs inspected so far are unchanged from the snapshot. **An exact final-head source/configuration recheck remains owed.** Final hosted proof belongs to the delivery owner and is not supplied by these focused witnesses.

## Authority and inspected sources

Read this repository's `AGENTS.md`, `docs/developer-stack.md`, the Foundation and dependency/strict-project sections of the accepted implementation plan, `docs/architecture.md`, the initial independent memo, retained organization quality standard `sources/org-quality-5499550.md`, organization agent route and exact retained Q source `sources/q-5f1b5aef.md`. The organization text is explicitly a retained inspected revision; this reviewer did not independently fetch a new live revision.

Inspected the actual installed Foundation **1.10.1** presets/manifest/public CLI implementation; root/package manifests, catalog and lock; `.oxlintrc.json`; all owning tsconfigs and root project references; `tools/toolchain.ts`; both Foundation policy files; `foundation.config.yaml`; boundary witness tests; packaged consumer/archive dependency rejection; `.github/workflows/checks.yaml`; release workflow; `docs/node-or-bun-adoption.md`, its actual command helper and tooling artifact record; Get Modular's package guide and development/runtime peer declarations. Also read the newly written `docs/foundation-adoption.md`.

The initial memo supplies the exact official producer consumer-adoption and capability contract sources at Foundation source revision `66984d7a71b469acfe557131f9a95295cc6b8553`. Those sources are not silently updated by this recheck. The installed published preset bytes and behavior are independently inspected below.

## Corrections and current integration

The root lint configuration extends the installed `presets/oxlint/type-aware.json` once and retains the three stricter local rules. It does not replace inherited plugin/category settings or disable new shared rules. The effective installed configuration has `typeAware:true`, `typeCheck:false`, unused-disable severity `deny`, and ESLint disable-directive respect disabled. It includes shared Node/import/Promise rules and the typed unsafe/Promise checks. Compiler checking remains an independent gate; `typeCheck:false` is the producer preset's deliberate setting.

`oxlint-tsgolint` **7.0.2001** is exact in the central catalog and frozen lock, installed beside Oxlint **1.83.0**, and included in development-only package policy. The installed Oxlint manifest requires backend `>=7.0.2001`. The retained tooling artifact record describes this exact profile honestly and records the newer registry dist tag without calling the selected pin the latest release. There is no new SDK runtime dependency on Foundation, Oxlint, the backend or node-or-bun.

The root solution references all four package source projects plus `tsconfig.checks.json` and the observation qualification project. Package source projects retain declaration emission; checks own root tools/tests/examples and package tests. The strict compiler ownership guard still requires one owner, strict enabled and declaration checking enabled across all maintained roots. No blanket exclusions, new lint suppression, TypeScript suppression or findings baseline was introduced to obtain lint success. Descriptive existing `@ts-expect-error` consumer-authority witnesses remain intentional negative tests.

All six producer lifecycle scripts exist as direct public CLI bindings. A read-only `pnpm foundation:status --format json` was executed successfully outside the restricted subprocess sandbox: mode `REGISTRY`, requested/installed Foundation **1.10.1**, actual frozen-lock package key and registry integrity, and `issues:[]`. Neither attach nor detach was executed. Initial sandbox attempts returned a generic admitted-Node error; an independent direct Node spawn probe exposed `EPERM` from the sandbox. The identical status command succeeds when that subprocess restriction is removed, so this is not reported as a repository defect.

The source-dependency configuration preserves schema v2's explicit `packages` universe, four runtime and four development test boundaries, public entrypoints, inward edges and empty opaque runtime-reference allowlists. It does not mislabel root tooling as covered by the selected source graph. The declaration policy still requires exact catalog versions, workspace protocols, reserved scope ownership and exact registry-only Foundation. Its negative fixtures first run the actual unchanged copied policy and graph, then reject outer adapters/Foundation from core, unknown files/packages, private/deep imports and an allowlisted but development-declared runtime dependency.

The CI source remains fail closed. Build/typecheck precedes quality; quality executes complete lint, Foundation checks, both registry/development assertions, real boundary fixtures and packed release gates. The two Node scenario jobs retain real database and published-consumer gates. `Required checks` runs under `always()` and requires every prerequisite result to equal `success`; failure, cancellation or skip cannot become a passing aggregate. No gate or governed root was dropped. Live main protection and Actions settings were supplied as delivery-owner observations, not independently re-read by this reviewer. A configured/protected check and an actual passing final remote execution remain different facts.

## Independent executable typed witnesses

A disposable **copy** under `foundation-final-evidence/strict-copy` preserves actual repository configuration and source files, with installed dependencies linked from the maintained tree. No witness was inserted into the maintained repository. Oxlint used the actual installed backend, **two threads**, the copied `.oxlintrc.json` and ordinary project discovery. No `--tsconfig` override was used.

For each owner, the permitted fixture exports an optional-string guard (`string | undefined`) and an awaited Promise. The rejected fixture exports a function containing bare `Promise.resolve(1)`. Commands follow this exact form, run from the copied root:

```sh
node_modules/.bin/oxlint --config .oxlintrc.json --threads=2 --format=json OWNER/foundation-permitted.ts
node_modules/.bin/oxlint --config .oxlintrc.json --threads=2 --format=json OWNER/foundation-rejected.ts
```

| Owner path | Permitted result | Rejecting result |
| --- | --- | --- |
| `packages/payments-core/src` | Exit 0; no diagnostics | Exit 1; `typescript(no-floating-promises)` |
| `tools` | Exit 0; no diagnostics | Exit 1; `typescript(no-floating-promises)` |
| `packages/payments-core/test` | Exit 0; no diagnostics | Exit 1; `typescript(no-floating-promises)` |
| `qualification/observation` | Exit 0; no diagnostics | Exit 1; `typescript(no-floating-promises)` |

The results report one selected file, 195 rules and two threads per invocation. Full commands/stdout/stderr are in `foundation-final-evidence/strict-witness-results.json`; effective configuration is retained separately.

### Strict owner controls

A second disposable copy changes only a selected owning project's `strictNullChecks` to false and, to avoid an invalid compiler option combination, `exactOptionalPropertyTypes` to false. The baseline maintained configuration is never changed.

| Only modified control project | Runtime source | Root tools | Package tests | Qualification |
| --- | --- | --- | --- | --- |
| `tsconfig.checks.json` | Exit 0 | Exit 1 | Exit 1 | Exit 0 |
| `packages/payments-core/tsconfig.json` | Exit 1 | Exit 0 | Exit 0 | Exit 0 |

Every exit 1 is specifically the typed rules' requirement for `strictNullChecks` (including `no-unnecessary-condition` and `strict-boolean-expressions`), with the same otherwise permitted witness. This separates project routing from a generic typed-rule smoke test: root tooling and package tests take checks-project options, while runtime source takes its package project's options. The tests do not merely assume that any inferred program has the required strict settings. Full commands/results are in `foundation-final-evidence/isolated-owner-controls.json`.

The actual installed native inputs were hashed. Oxlint Linux x64 GNU binding SHA-256: `1833e1637a0a978ae688e77dd75d332d9c208c015cb1a2d038febc3a8fa4eea1`. Tsgolint Linux x64 executable SHA-256: `0f68a012e2e6e26f5ece74536d959f8bb2398567b9c7b325fa0c0218b1640dd3`. Exact resolved paths, sizes and preset hashes are in `foundation-final-evidence/installed-inputs-sha256.json`. These hashes identify executed installed inputs; they are not an independent attestation-signature verification claim.

## Adoption record and optional scope

`docs/foundation-adoption.md` accurately distinguishes shared presets, actual selected graph scope, six lifecycle scripts, strict ownership, root development peers and required final qualification. Its deferred-capability table is appropriate. FMS/source-coverage topology, schema v3, SDK growth, gate runner, budgets and other optional capabilities are not missing requirements merely because the task requested complete useful Foundation adoption. Public API compatibility needs a real release-owned baseline, protected mutation authority and explicit policy; the record states that trigger instead of manufacturing a historical baseline.

Root development Observation/Conformance dependencies are justified by actual strict qualification source imports. The published static consumer and plain-core consumers still enforce optional-dependency absence. Node-or-bun remains the existing captured tooling helper's single mechanism with explicit Node adapter selection, finite per-stream capture, awaited results and no retry. Detailed process semantics and payment/runtime behavior are owned by their separate focused reviews.

## Limits and final recheck

I ran no install, build, database operation, full lint, full test suite or complete gate. The executable work was limited to installed `--help`/effective-config reads, read-only Foundation status, copied typed witnesses and compiler-option controls. The final integration's complete typecheck/lint/financial suites and both hosted Node floors must qualify the actual final source; prior-source logs cannot be relabeled as that proof.

No material defect currently calls for a configuration, dependency or policy change. Before final approval is source-bound, re-read the clean final HEAD and compare lint/compiler/dependency/policy/CI inputs and the final adoption document against this review. If those inputs change, repeat the affected witnesses. Final remote Checks status and branch/ruleset enforcement remain delivery-owner verification obligations.

## Final source-bound disposition — 95e996ff0bbe8edb003fcd42ab66c6aa429a7253

Rechecked the exact clean integration head **`95e996ff0bbe8edb003fcd42ab66c6aa429a7253`** on 2026-10-20. `git status --porcelain` was empty. **No material P0, P1 or P2 finding in the Foundation integration; the two original P2 adoption defects are closed. This scoped source review is complete.**

The final input manifest `foundation-final-evidence/final-head-inputs.json` records the clean head and SHA-256 comparison for 21 lint/compiler/dependency/policy/workflow inputs. Every one is byte-identical to the actual copied witness snapshot: root lint config, root and four package manifests, catalog/lock, root/base/checks and all package/qualification tsconfigs, Foundation config, both architecture policies and both workflows. Therefore the already executed actual-backend permitted/rejecting and isolated strict-owner controls apply to the same final enforcement inputs.

`foundation-final-evidence/final-head-enforcement-docs.json` additionally binds the strict ownership guard, actual boundary witnesses, packed-consumer gates, captured-command/archive helper and release-enforcement sources. All seven are also byte-identical to the witness snapshot inspected in this review. Both installed native lint inputs and all five inspected producer preset files retain their recorded hashes. No repeated optional witness execution or complete gate was needed to resolve an unchanged input.

Re-read the committed `docs/foundation-adoption.md`, developer-stack route and initial-audit navigation. The adoption document's final SHA-256 is `af1bdbfaa02716420e0f3570fa34d4c48522b18aeab9c3d75fc968026a14fa42`. Local Markdown link targets in the adoption record and developer-stack route exist. The final document retains the actual scope, explicit lifecycle behavior, strict-routing claim, root development dependency rationale, selected/deferred capability distinction and requirement for final-source local/hosted execution. It does not turn the v2 package graph into a claim about the entire root tooling graph or imply adoption of FMS and unrelated optional machinery.

The delivery owner reports successful complete lint, all four runtime force builds and checks-project compilation, with the aggregate fast check running at the time of this recheck. Those are owner-reported results, not this reviewer's executions or independently examined full transcripts. This disposition approves the reviewed selected Foundation integration at the exact source above. It does not claim a successful final full financial/database gate, hosted matrix, production deployment, package publication or fresh independent live-protection verification. Final CI and delivery evidence remain the owner's responsibility. Later evidence-only reports may cite this exact source review without relabeling an execution; any later enforcement/source change needs its affected review and gates.
