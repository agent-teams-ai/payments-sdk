# Independent review: complete, useful Engineering Foundation adoption

## Subject and disposition

Reviewed read-only on 2026-10-20: `implementation/payments-delivery`, clean source **`12303ff94a5c49c7d31de1409ef1441e66006cc3`**. This memo concerns Foundation integration and the enforcement supporting the SDK's accepted architectural boundaries. It does not re-review all financial algorithms or repeat resolved findings in the SDK 0.2 reports.

**No P0/P1 found in this scope. Two P2 adoption gaps remain at this subject:** missing documented local lifecycle scripts, and omission of the shared Oxlint correctness/type-aware preset. The existing source-dependency and workspace-declaration capabilities are real, appropriately scoped, and connected to fail-closed CI. Calling that report “full” means full execution of its two declared capabilities; it does not mean every optional Foundation capability or every semantic property has been checked.

Useful complete adoption means satisfying the applicable consumer contract while preserving consumer-owned boundaries. It does not mean installing FMS, enabling every capability, importing development tooling into payment runtime, or inventing historical API baselines.

The reviewer ran no build, test, install, database operation or user-source code. Official public GitHub reads, source/configuration inspection, tracked-file inventory and hashes of retained evidence were read-only. Only this requested memo was written. Findings below are source-established adoption defects, not claims of newly reproduced runtime bugs.

## Authority and inspected sources

Current Foundation `main` is **`66984d7a71b469acfe557131f9a95295cc6b8553`**. Its package manifest declares `@agent-teams/engineering-foundation` **1.10.1**. The official release collection records that exact Foundation release at **2026-10-19 19:38:57 UTC**. The repository's latest aggregate release is a separate FMS 0.1.2 release, which does not imply a newer Foundation package or require FMS adoption.

Official sources read through the GitHub connector:

- [Foundation README](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/README.md), [consumer adoption](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/docs/development/consumer-adoption.md), and [executable capabilities](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/docs/architecture/executable-capabilities.md).
- Exact [published-package manifest source](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/package.json), [capability registration](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/src/composition/capability-modules.ts), source [coverage evaluator](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/src/capabilities/source-dependencies/application/policies/evaluate-source-workspace-coverage.ts), [resolved-edge evaluator](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/src/capabilities/source-dependencies/application/policies/evaluate-resolved-source-dependency.ts), [Oxc parser](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/src/capabilities/source-dependencies/adapters/outbound/oxc/oxc-source-dependency-parser.ts), and [workspace-declaration evaluator](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/src/capabilities/workspace-dependency-declarations/application/policies/evaluate-workspace-dependencies.ts).
- Shared [base Oxlint](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/presets/oxlint/base.json), [Node Oxlint](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/presets/oxlint/node.json), [type-aware Oxlint](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/presets/oxlint/type-aware.json), [Node TypeScript preset](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/packages/engineering-foundation/presets/typescript/node.json), and [producer dependency catalog](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/pnpm-workspace.yaml).
- [Public API lifecycle and consumer activation prerequisites](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/docs/architecture/public-api-compatibility.md#released-baseline-lifecycle), including its currently dormant SDK-growth path, and [quality source coverage](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/docs/reference/quality-source-coverage.md).
- Organization [current quality standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md), its [retained revision](https://github.com/agent-teams-ai/.github/blob/3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0/docs/engineering-quality-standard.md), and current organization AGENTS. The freshly fetched current standard equals the content at the retained `3a203362` revision; local retained source is `research/continuation/sources/org-quality-3a203362.md`.
- Exact [Q source](https://github.com/777genius/agent-rules/blob/5f1b5aefa96d64448d909ae9c04a823afe145ea8/skills/q/SKILL.md), also read from `research/continuation/sources/q-5f1b5aef.md`.
- Official [Oxc type-aware documentation](https://oxc.rs/docs/guide/usage/linter/type-aware.html) and [CLI documentation](https://oxc.rs/docs/guide/usage/linter/cli.html). The [tsgolint resolver](https://github.com/oxc-project/tsgolint/blob/a18037134a44ca331e0e2451e50b2dd2e374acb3/internal/utils/find_tsconfig.go) and [linter](https://github.com/oxc-project/tsgolint/blob/a18037134a44ca331e0e2451e50b2dd2e374acb3/internal/linter/linter.go) explain project-reference traversal and inferred unmatched programs. That is a current source observation, not independent proof that an uninspected npm binary has those exact bytes.

Locally inspected: `AGENTS.md`, `docs/developer-stack.md`, accepted plan's Foundation profile, `docs/architecture.md`, all four package manifests, root manifest/catalog/lock, installed Foundation presets/metadata, `foundation.config.yaml`, both `architecture/foundation/*.yaml`, strict TypeScript projects and `tools/toolchain.ts`, `.oxlintrc.json`, both Actions workflows, `tools/test/boundaries.test.ts`, packed consumer enforcement and current SDK 0.2 reports.

## Findings

### FND-1 — P2: complete lint does not use the shared correctness/type-aware baseline

**Locations:** `.oxlintrc.json:2-10`, `package.json:16`, root `devDependencies`, `pnpm-workspace.yaml`, and `architecture/foundation/dependency-declarations.yaml`.

The local lint config enables the correctness category, three plugin names and three local rules. It does not extend any Foundation Oxlint preset and does not enable type-aware linting. The root dependency graph contains Oxlint 1.83.0 but lacks its optional `oxlint-tsgolint` backend. Therefore the existing successful `pnpm lint` is not evidence of the shared Node correctness rules or typed Promise/unsafe-value rules.

The Foundation consumer contract's shared-preset section directs consumers to use its Node baseline and the type-aware preset in the complete lint gate. The installed 1.10.1 package really exports those preset files, and the installed bytes inspected match the source shape: `type-aware.json` extends `node.json`, which extends `base.json`.

The omitted baseline includes suspicious diagnostics, unused-disable rejection, explicit import cycles/duplicates/mutable exports, several Promise checks and no-eval rules. The omitted typed preset includes `no-floating-promises`, `no-misused-promises`, unsafe argument/assignment/call/member/return checks and switch exhaustiveness. A strict compiler does not establish these same properties. This is a concrete enforcement gap in the requested Foundation adoption, without asserting that every rule currently has a production violation.

**Source reproduction:** read the complete local config, inspect the invoked root lint script, compare it with the installed `presets/oxlint/{base,node,type-aware}.json`, and inspect root/lock dependency entries. This establishes missing configuration/backend without running an injected financial operation or a test. No negative lint fixture was executed by this reviewer.

**Minimum correction:** extend the installed `type-aware.json` once; retain the three stricter local rules and existing generated/dependency/artifact exclusions. Remove the local `categories` and `plugins` declarations unless effective-config inspection proves they preserve all inherited baseline settings. Do not add maintainability budgets incidentally. Keep the existing separate TypeScript build/typecheck; Foundation's typed preset deliberately has `typeCheck:false`.

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": [
    "./node_modules/@agent-teams/engineering-foundation/presets/oxlint/type-aware.json"
  ],
  "rules": {
    "no-debugger": "error",
    "no-unused-vars": "error",
    "typescript/no-explicit-any": "error"
  },
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "**/.artifacts/**"]
}
```

Add `oxlint-tsgolint: catalog:` to root development dependencies, its exact admitted artifact to the catalog/frozen lock, and `oxlint-tsgolint` to the development-only package policy. The installed Oxlint 1.83.0 peer requires **>=7.0.2001**. Foundation's current official catalog and the retained Get Modular consumer both use exact **7.0.2001** with Oxlint 1.83.0. These establish a concrete compatible candidate, not this reviewer's independent claim about the latest registry dist tag. Registry URLs were unavailable through web retrieval and one direct registry read was blocked by sandbox networking; the implementing dependency owner must perform actual artifact/provenance admission.

**Verification owed by implementation:** run the inherited effective config and complete lint against the actual sources; preserve compiler checking; correct material diagnostics without dropping protected roots or globally disabling the shared baseline. Prove at least one permitted case and a typed rejecting witness under a runtime package and root tooling, using the actual installed binary. Build-before-lint is already satisfied by local `check:fast` sequencing and CI `quality.needs: build`.

**Project discovery risk:** `tsconfig.json` currently lists only four source project references. Root tools/tests/examples belong to nonstandard `tsconfig.checks.json`; package test folders are excluded by their nearest package source configs. Oxc documents that `--tsconfig` only changes import resolution, not typed-project discovery. Current tsgolint source searches project references and ancestor solutions, and lints unmatched files in an inferred program. Thus the risk is using inferred rather than owning strict options, not an established claim that those files are skipped entirely. A small routing candidate is adding the existing `tsconfig.checks.json` to the root solution's references. Verify its interaction with `tsc -b` and noEmit; if build mode rejects it, retain the four source references in a dedicated build solution and keep root solution discovery connected to the noEmit checks project. The separate qualification folder already has standard `tsconfig.json`. Preserve the one explicit strict owner and all current declaration flags.

### FND-2 — P2: three required Foundation lifecycle commands are absent

**Location:** `package.json:17-19`.

The official consumer registry baseline lists six scripts. The SDK declares `foundation:check`, `foundation:assert-dev-only` and `foundation:assert-registry`, but omits `foundation:status`, `foundation:attach` and `foundation:detach`.

This does not weaken the current CI registry assertion: it does leave the documented consumer integration incomplete and removes the standard safe local-source lifecycle from normal repository commands. A contributor cannot use the official copyable `pnpm foundation:status`/attach/detach workflow as documented for Foundation consumers. No source-linked state is alleged in the reviewed tree.

**Source reproduction:** compare the `Required scripts` object in the exact official consumer-adoption document against the root manifest's complete scripts object. The three command names are absent.

**Minimum correction:** add direct public CLI commands only:

```json
{
  "foundation:status": "agent-teams-foundation status",
  "foundation:attach": "agent-teams-foundation attach",
  "foundation:detach": "agent-teams-foundation detach"
}
```

Do not execute attach/detach merely to test script presence or mutate the published pin. A read-only installed status check plus public command/script inspection is proportionate; required registry assertions continue to reject a source-linked merge state.

## Actual adoption matrix

| Foundation surface | Current SDK adoption | Assessment / explicit boundary |
| --- | --- | --- |
| Exact registry development dependency | Root exact 1.10.1, frozen pnpm lock; installed pnpm package path | Appropriate. No runtime package declares Foundation. Installed/root lock assertions are executed by CI; no new registry requalification was run here. |
| `architecture.source-dependencies` | Explicit schema v2, `packageRoots: [packages]`, all four runtime/test trees, eight boundaries | Appropriate closed package universe; root-owned test/tool/example/qualification code is outside this capability's selected package universe and separately guarded by strict compiler ownership. This is a scoped contract, not whole-repository source-graph proof. |
| `workspace.dependency-declarations` | Explicit schema v1/pnpm, strict exact central catalog, workspace internal protocol, reserved local scope, dev-only and exact-registry rules | Appropriate. Drizzle is allowed only by its owning runtime adapter's manifest/source policy; MySQL is development-only in the adapter manifest, never an allowed runtime edge. |
| Shared TypeScript preset | Root base extends installed Node preset; strict source/checks projects; skipLibCheck false | Adopted. Toolchain enforces stable >=7.0.2 and one strict owning project. No maintained `.mjs`/`.mts`/JS source found in tracked inventory. |
| Shared Node/type-aware Oxlint | Local bespoke config; backend absent | FND-1. Reuse exact installed preset; qualify actual backend and file routing. |
| Status/attach/detach lifecycle | Not exposed as package scripts | FND-2. Public CLI implementation exists; add direct scripts. |
| Required CI and registry assertions | Real quality/scenario steps plus `Required checks` aggregate | Source wiring is fail-closed, including failure/cancel/skip. A workflow file does not independently prove actual branch/ruleset protection or exact candidate remote success. Root delivery owner retains live-proof responsibility. |
| `quality.suppression-governance` | Not activated | Optional consumer policy, no blanket source lint/type suppressions found. Type-negative `@ts-expect-error` witnesses have descriptive reasons. Do not manufacture waivers or enable an unrelated policy merely for a feature count. Baseline unused-disable settings should be inherited under FND-1. |
| `package.public-api-compatibility` | Deferred, no release-owned API baselines | Do not invent a historical baseline. A real GitHub 0.1 prerelease exists, but current Foundation also requires protected release-owned baseline mutation enforcement before activation and says equivalent consumer protection remains a prerequisite. This repository's release remains GitHub tarballs; npm publication is a separately documented future task. Explicitly retain this deferral/trigger in the local adoption record. |
| SDK-growth v2 / S3 machinery | Not activated | Producer documentation says implemented but dormant; it does not grant consumer release authority. No reason to add it for this task. |
| FMS / `quality.source-coverage` | Not adopted | Deliberate. Current source-coverage capability still requires an FMS topology and is an acknowledged architecture-neutrality exception. Strict `.ts` ownership is already enforced by the local compiler guard. Do not implicitly adopt FMS to use this optional capability. |
| Source-dependency schema v3 | Not adopted | Correct. Producer docs say supporting package/combined qualification and explicit consumer adoption are separate. V2 suffices for the actual workspace package graph. Root strict ownership is not falsely labeled root Foundation graph coverage. |
| `quality.gate-runner` | Not activated | Optional. Existing scripts/CI already compose concrete gates; adding another scheduler does not establish more evidence. No demonstrated need to replace this working orchestration. |
| `repository.agent-workflow` | Not activated | Optional. AGENTS is present and routes current organization policy. Portable agent adapters/changed-file preflight are a separate explicit adoption; no need to add a routing system to satisfy payment boundaries. |
| Maintainability budgets | Not activated | Explicit opt-in in official preset docs. File/function budgets are not a proxy for SRP/SOLID and should not trigger unrelated splitting of cohesive payment responsibilities. |
| Security baseline | Not activated | Optional publishing-tooling policy with its own privilege/provenance/tarball requirements. Existing runtime SDK release audits do not automatically select that tooling-repository profile. No fabricated npm proof. |
| Executable specifications | Not activated | Requires a real donor catalog and independent script connectivity qualification. Existing contracts/scenarios alone do not justify generating a second abstract specification system. |
| Documentation reference/governance/authoring/scaffolding | Not activated | Optional per consumer-owned document inventory, baseline/transaction authority and real use case. Do not scaffold new product architecture or rewrite accepted documents as an adoption shortcut. |
| Protobuf / JSON Schema release capabilities | Not activated | No applicable advertised released family/Buf contract established in this SDK profile. Do not fabricate package evidence. |
| Findings baseline | Not activated | Producer documents say it is not declarable in foundation.config yet. Do not add a blanket lint baseline to bypass new enforcement. |

## Boundary and dependency enforcement inspected

The source configuration protects the intended dependency direction. Core imports only its own policy/contracts and Node crypto. Paddle and PostgreSQL point inward to core. The optional Get Modular adapter owns its framework dependencies and exposes a separate observation subpath. The PostgreSQL adapter owns Drizzle, pg and pg-boss; its public package surface/strict consumers have already been separately reviewed for ORM isolation.

All package runtime sources and package tests are covered by the v2 selected package universe. Each test boundary is explicitly development mode, with separate dependencies and builtins. No runtime boundary is mislabeled development. All `runtimeReferences` arrays are empty; there is no permissive opaque-import escape hatch. No blanket source exclusion or wildcard package permission is present. Existing permitted local/private imports remain within a boundary; cross-owner relative imports must still target a declared public entrypoint and allowed boundary.

The installed Foundation parser observes static and dynamic imports, exports, import types and tracked CommonJS loaders; unsupported computed loading is retained as unresolved evidence. The resolved-edge evaluator independently applies dependency-section legality, source package permission and export checks. The coverage evaluator marks selected unknown files and unknown workspace package roots. Those producer mechanisms match the consumer's declared v2 model; they do not turn unselected root tooling into graph-governed production source.

The SDK boundary test uses disposable copies of actual manifests/configuration and actual package source/test trees, then invokes the installed public CLI. It first proves each unmodified copy passes before its mutation. It covers:

- a permitted same-owner source import;
- core imports of each outer adapter and Foundation rejected by the package-edge rule;
- an unknown source under an existing selected package rejected;
- a new ungoverned package under the selected `packages` container rejected;
- workspace private-subpath and cross-package relative-source bypasses rejected;
- an explicitly allowlisted package that is declared only as development still rejected from runtime code.

The last probe intentionally changes both allowlist and dev dependency, so it tests runtime/development placement beyond a trivial package-allowlist rejection. The deep/source probes currently accept any source-dependency diagnostic rather than pinning the most specific one; combined with the explicit fixture and nonzero installed check this is useful consumer rejection evidence, not a new material defect. No new test framework or duplicative mock checker is needed.

One package-granularity limit remains intentional: the Get Modular source boundary includes both static and observation folders, so source package permissions alone do not prevent the static graph from beginning to import the optional observation peer. The independent packed static consumer imports/runs the actual static exports and explicitly requires Observation to be absent; therefore optionality has a real consumer gate rather than a false fine-grained source-policy claim. Plain-core packed profiles also assert absence of Paddle, PostgreSQL, Drizzle/MySQL, Get Modular/Observation and Foundation.

## Execution evidence and CI limits

I independently hashed the retained complete logs:

| Retained execution subject | Log | Recomputed SHA-256 |
| --- | --- | --- |
| `fb9baa1d463d5b1ab5760aad72fe3fb1ee361f33`, Node 24.21.0 | `.artifacts/full-check-node-24.21.0.log` | `2e52a7d9297df4573fef925b8af83d92f916491f07a09bf6bdf26538519f4fda` |
| Same source, Node 26.11.1 | `.artifacts/full-check-node-26.11.1.log` | `5332a47a664479636f4ef5db0f07de6308c409f74c94c47aa524ae1cbb7114f5` |

The corresponding JSON records name that earlier exact clean source and complete successful install/build/check stages. The raw logs themselves show Foundation full configured coverage, both capability passes, development-only status, registry mode with exact Foundation 1.10.1, and the actual boundary witnesses. These are retained executions, not my new executions at `12303ff`. The prior evidence review binds their archive graph and explains documentation-only delta reuse. A forthcoming change to lint/dependency/configuration inputs needs fresh applicable gates; it cannot inherit the old lint pass by re-labeling the transcript.

Tracked inventory at the reviewed source contains **77 `.ts` files**: core 10, Get Modular 9, Paddle 7, PostgreSQL 17, root tests 13, tools 12, examples 3 and qualification 6. It contains no tracked maintained `.js`, `.mjs`, `.mts`, `.cjs`, `.cts`, `.tsx` or `.jsx` files. The toolchain guard scans those exact maintained root groups (excluding generated dist and node_modules), rejects non-`.ts` sources, observes each project's effective compiler config and checks one owner, strict true and skipLibCheck false. This is a real local check with broader coverage than Foundation's selected package graph, though it is consumer-owned code whose enforcement also depends on protecting its CI invocation and policy.

CI performs build/typecheck before quality. Quality installs the frozen lock, receives built artifacts, then executes lint, the full declared Foundation check, both registry/development assertions, boundary witnesses, packed consumers and release audit. The separate scenario matrix runs both qualified Node floors with disposable PostgreSQL, adapter/financial/E2E, Drizzle, observation and npm consumer gates. The final aggregate runs even after prerequisite failure and requires all three prerequisite results to equal success. There is no continue-on-error or success-on-skip path in this source.

I did not independently establish live GitHub ruleset enforcement, exact candidate remote Checks success, source-to-artifact attestation, npm publication, live Paddle behavior, production runtime security admission, HA/PITR, or capacity. Existing release/security limits remain in force. This review should not be turned into a production-readiness score or a claim that all optional Foundation features are adopted.

## Recommendation

Fix FND-1 and FND-2 in one small tooling change, record a local activation matrix with actual commands and required status, qualify the real typed backend and file routing, and keep the already active source/declaration policies unchanged. Then report complete adoption of the selected useful Foundation profile, with the optional/deferred boundaries above explicit. No new financial layer, repository abstraction, package split, FMS migration or accepted-ADR rewrite is justified by this audit.

Implementation recheck is pending; this memo intentionally retains the initial reviewed subject and original findings.
