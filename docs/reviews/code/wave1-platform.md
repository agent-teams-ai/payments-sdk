# Payments SDK implementation review — wave 1, platform and delivery

## Review identity and scope

- Frozen production commit: `7bc3f71a2db4d7364870f6b25365986611195916`.
- Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w1-platform`.
- Production source was not modified by this reviewer. Later review-only changes normalize three manifest license fields and repair the packed-consumer harness so downstream declarations can be checked; these changes are identified below and are not silently counted as baseline passes.
- Reviewed `AGENTS.md`, authoritative `docs/implementation-plan.md`, retained Q v1.1.2, the four package manifests/public entrypoints, Get Modular integration/source/tests/readme, host examples, CI and packaging/toolchain/Foundation gates. Released GM profile is Core/Assembly 0.5.0, Resources 0.1.0, Conformance 0.3.0. Pending Observation is intentionally gated, and absence of unpublished hooks is not a finding.
- Known Foundation policy allowlist/node:crypto failures and the in-progress PostgreSQL worker/test work are excluded from new findings, as requested. Previously assigned core/Paddle/consumer findings were not duplicated.

## Findings

### P1 — The packed adapter consumer cannot resolve the just-built unpublished internal core

**Location:** `tools/packed-consumers.ts:16–26` (frozen source).

The fixture makes all four packages root `file:` dependencies, but the tarballs' internal dependencies are correctly rewritten by `pnpm pack` to ordinary core versions. pnpm does not satisfy a transitive semver dependency from a sibling root `file:` dependency automatically. The fixture then installs offline, with no local registry and no internal-package overrides. As a result the adapter consumer attempts registry resolution of `@agent-teams/payments-core@0.1.0` instead of using the tarball it is intended to qualify.

**Reproduction:** First correct only the three license metadata blockers described in the next finding inside the detached worktree. Then run:

```sh
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm test:packed
```

**Observed:** exit 1:

```text
[ERR_PNPM_NO_OFFLINE_META] Failed to resolve @agent-teams/payments-core@0.1.0
This error happened while installing the dependencies of @agent-teams/payments-paddle@0.1.0
```

This blocks the required quality job on a clean store. A store containing published metadata would also undermine the gate's purpose by allowing a registry core to satisfy adapter dependencies rather than the new core tarball.

There is a second reproducibility weakness in this same lock-free offline install: after adding internal tarball overrides, `@types/pg`'s `@types/node: "*"` resolved to uncached `26.6.5` from the local metadata mirror, producing `ERR_PNPM_NO_OFFLINE_TARBALL`, although the root qualification install had cached the pinned `24.13.3`. A lock-free offline consumer cannot assume cached manifests choose the root lockfile's versions.

**Required change:** Configure the consumer to resolve every internal package dependency to its freshly packed tarball, and make the isolated qualification dependency graph deterministic. With pnpm 11 the configuration belongs in `pnpm-workspace.yaml`; `package.json`'s `pnpm.overrides` is explicitly ignored. The focused repair used internal `file:` overrides plus the qualified `@types/node: 24.13.3`. All four strict consumer profiles then passed, as did runtime imports and the physical Resources identity assertion.

### P2 — Package license metadata contradicts the mandatory archive gate

**Locations:** `packages/payments-core/package.json:7`, `packages/payments-get-modular/package.json:7`, `packages/payments-paddle/package.json` (missing license), `tools/package-artifacts.ts:28–29`.

`packPackages()` asserts `license === 'Apache-2.0'` for every delivery package. Frozen core and GM manifests say `MIT`, while Paddle has no license field. Therefore both `test:packed` and `release:dry-run` fail before packing the first package. This is an actual required-gate failure, independent of source compilation or packaging consumer closure.

**Baseline reproduction:**

```sh
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm test:packed
```

**Observed:** exit 1 from `tools/package-artifacts.ts:29`:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'MIT'
- 'Apache-2.0'
```

**Required change:** Align delivery manifests and packaged license notices with the selected repository license. Do not weaken the mandatory check. The root reviewer has acknowledged this correction. Review-only normalization of the three manifests allowed `release:dry-run` to pass archive/license/exports checks for all four packages; no publish was attempted.

### P2 — GM-managed runtimes omit the audited subscription stream recovery capability

**Locations:** `packages/payments-get-modular/src/contracts.ts:7–9`, `packages/payments-get-modular/src/module.ts:50–52`.

The core public runtime exposes `readSubscriptionSelection` and `selectSubscriptionStream` (`packages/payments-core/src/runtime.ts:265–288`). They are the CAS/read-set and audited mutation pair needed to select a support stream after duplicate initial subscriptions. The core's focused scenario `duplicate initial streams preserve both payments and hold renewals until audited technical stream selection` explicitly uses both methods to permit the selected stream's renewals.

The GM adapter omits both from its `Pick` contracts and actual frozen facet objects. They are also absent from the root instance. Consequently a GM Host can start a purchase, resolve an unknown mutation by accepted-risk retry, and reach duplicate streams, but cannot perform the required technical selection through its managed runtime. Calling `repair()` cannot authorize the choice. The Host would have to construct another raw core runtime or bypass the adapter's managed API, contrary to the planned single composition-root integration.

**Reproduction:** A review-only probe is retained at:

`/workspace/scratch/9e36ca3bbd13/implementation/review-w1-platform/packages/payments-get-modular/test/review-selection.ts`

Run:

```sh
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH node packages/payments-get-modular/test/review-selection.ts
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH node --test --test-name-pattern='duplicate initial streams' packages/payments-core/test/core.test.ts
```

The first checks a real `isolate(paymentsModule, ...)` product and all five capabilities, and reports both methods absent while a core runtime from the same options exposes them. The second passes the existing recovery scenario, establishing the concrete recovery role of the omitted API.

**Required change:** Expose the selection read through the appropriate read facet and the audited selection mutation through Processing or a separately justified operator capability. Apply the same admission/tracking wrapper as every other facet call. Add a compile-time and real-runtime surface probe, ideally carrying the existing duplicate-stream scenario through the GM integration so the omission cannot recur.

## Verification results and limits

| Gate or scenario | Frozen baseline result | Notes |
| --- | --- | --- |
| Offline frozen install | Pass | Pinned pnpm 11.25.0; isolated worktree links |
| Strict `pnpm typecheck` | Pass | TypeScript 7.0.2; Node 24.21.0 |
| `pnpm toolchain:check` | Pass | 41 strict owning .ts sources at the frozen head |
| `pnpm test:modular` on Node 24.21.0 | 10/10 pass | Real published Assembly, Resources and Conformance runtimes |
| `pnpm test:modular` on Node 26.11.1 | 10/10 pass | Same released GM train |
| `pnpm foundation:check` | Fail, 19 errors | Existing known node:crypto and core package allowlist mismatches; excluded from new findings |
| `pnpm test:packed` | Fail | License mismatch before first archive; adapter install failure exposed after review-only metadata repair |
| `pnpm test:packed` after explicit review-only repairs | Pass | Plain+adapters × NodeNext+Bundler, strict `skipLibCheck:false`, runtime imports, plain no optional dependencies, single physical Resources identity |
| `pnpm release:dry-run` after review-only metadata repair | Pass | All four package archives; no publish |
| Focused core duplicate-stream recovery | Pass | Used to confirm required role of missing GM operations |

No additional concrete lifecycle leak was found in the reviewed GM module. In particular, its close path rejects new facet admission through the Resources signal, waits for admitted facet promises before releasing borrowed dependencies, and subsequently joins physical core/provider settlement. The existing held-provider and held-storage-read cases pass on both Node floors. Failed downstream construction and late cancelled resource acquisition are exercised against the real released resources runtime. The two host examples preserve explicit factory/GM composition ownership and do not add fabricated Get Modular lifecycle hooks.

This review does not declare pending Observation released or qualified. The README's pinned future watch/load semantics are kept behind an explicit coherent-train release gate; the durable payment/delivery path is tested with observation absent. No fake hook package is required to close this review.
