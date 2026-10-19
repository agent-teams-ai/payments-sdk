# Wave 4 independent review: platform, Get Modular, packaging and release

## Frozen subject and result

- Repository: `agent-teams-ai/payments-sdk`.
- Frozen full revision: **`fcd57f9ad4887338edab351cb1ef6457e97644a1`**.
- Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform`.
- Review date: 2026-10-19 UTC.

**Changes requested: one established P2 installation finding.** No P0/P1 or additional material Get Modular/runtime/release-policy finding was established in this review's assigned scope. No production source was changed, committed or pushed.

The separately assigned subscription-profile and unknown-transaction-status provider corrections were not duplicated. This review qualifies its frozen subject and the commands below; later source integrations need an impact recheck and their own authoritative exact-SHA CI evidence.

## P2 — Document the local dependency overrides required to install the unpublished candidate

**Location:** `docs/releasing.md:56–65`, the public local-tarball installation recipe and its statement that supplying the matching tarballs together resolves their SDK dependencies.

The candidate explicitly has no npm publication, so this recipe is its sole documented distribution path. In a fresh pnpm 11.25.0 host, adding all three documented tarballs together does **not** bind Paddle's transitive `@agent-teams/payments-core@0.1.0` dependency to the direct local core archive. pnpm requests that package from the registry and the installation fails. A reader following the supported release recipe therefore cannot install the Paddle/PostgreSQL candidate.

The existing packed gate succeeds because it provides a materially different setup: `tools/packed-consumers.ts:26–29` explicitly writes internal-package overrides to the consumer's `pnpm-workspace.yaml`. Those overrides are omitted from the public recipe. The package test's success consequently does not establish that the documented install works.

### Independent reproduction

Built and packed the frozen revision with the actual maintained gates. Created a new directory outside the monorepo containing only this host manifest:

```json
{"name":"payments-docs-consumer","private":true,"type":"module","packageManager":"pnpm@11.25.0"}
```

Under Linux Node **24.21.0**, executed the documented package set using the generated tarballs (absolute paths only replace the guide's download directory):

```sh
pnpm add \
  /workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform/.artifacts/packages/agent-teams-payments-core-0.1.0.tgz \
  /workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform/.artifacts/packages/agent-teams-payments-paddle-0.1.0.tgz \
  /workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform/.artifacts/packages/agent-teams-payments-postgres-0.1.0.tgz \
  pg@8.23.1 --ignore-scripts
```

Observed exit **1**:

```text
[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@agent-teams%2Fpayments-core: Not Found - 404
This error happened while installing the dependencies of @agent-teams/payments-paddle@0.1.0
No authorization header was set for the request.
```

The same fresh-host command with `--offline --ignore-scripts` failed earlier with `ERR_PNPM_NO_OFFLINE_META` for `@agent-teams/payments-core@0.1.0`. The unrestricted registry read above confirms that this is an absent-publication resolution defect, rather than merely cold metadata. `--ignore-scripts` suppresses lifecycle execution and does not change the dependency-resolution requirement.

**Required correction:** show a complete pnpm 11 installation procedure that merges explicit `file:` overrides for every selected local SDK package into the **host workspace root's** `pnpm-workspace.yaml`, with an explicit optional Get Modular variant and its qualified exact peers. Preserve an existing host workspace's configuration. Run a genuinely fresh consumer using that written recipe, without extra undisclosed harness setup, then verify public runtime imports and strict NodeNext/Bundler declarations. No package publication, runtime workaround or broader scope is necessary to fix this issue.

## Material inspected and architectural assessment

Read the repository `AGENTS.md`, the frozen implementation plan (including the P6/P7 and actual Get Modular lifecycle/Observation gates), pinned Q 1.1.2, architecture/getting-started/operations/qualification/releasing/upstream-qualification guides, the Get Modular package guide, the wave-3 platform report and review index. Applied Q to real invariants and ownership, without requesting stylistic abstractions or file-count changes.

Independently inspected all four manifests and public exports, exact catalog/lockfile pins, strict compiler projects, the Foundation dependency/source ownership policies and mutation tests, Get Modular module/contracts and real-runtime tests, the public host examples, both workflows and the actual packaging/release tooling.

The four dependency boundaries remain purposeful. Core owns the neutral provider/store/catalog contracts. Paddle, PostgreSQL and Get Modular point inward. The GM package does not pull Paddle/PostgreSQL into its runtime, and Foundation **1.10.1** remains a real installed development-only dependency. Maintained sources use `.ts`, strict TypeScript **7.0.2** projects and `skipLibCheck:false`; emitted packages contain ESM and declarations. The actual typecheck includes the durable `examples/paddle-postgres.ts` host example.

The GM implementation uses the real published static Core/Assembly **0.5.0**, Resources **0.1.0** and test-only Conformance **0.3.0**. Configuration is per-run input, preparation is inert and the module creates the same plain core runtime. The Host retains resource control, shared dependency ownership and worker ordering. Frozen read facets do not acquire command or lifecycle control authority. Real-runtime tests cover borrowed storage, late physical provider settlement, incomplete/rejoined close, sibling ownership, downstream construction failure and cancelled late acquisition.

The new **`processReclassification`** method is present on the public `Processing` facet and the core's tracked public runtime. An additional independent `.ts` probe used the actual published Resources/Conformance runtime and the public module to block `store.processReclassification`. It established all of the following on **both Node floors**:

- The Processing capability and root facet are the same frozen object; the Read capability has no reclassification command.
- The exact configured scope, binding ID and requested limit reach the store.
- Admitted reclassification appears as pending core work, and close returns incomplete/unsettled while the call is physically held.
- The borrowed store remains open through that admitted call; calls begun after close starts reject.
- Releasing the store promise settles the original result, completes a rejoined close, clears pending work and only then disposes the borrowed store.
- No provider checkout or other financial mutation is dispatched by this lifecycle exercise.

Probe: `/tmp/payments-w4-platform-probe.ts`. It modifies only its local fixture store method; no production implementation or database record was patched.

## Static support versus upstream Observation

The inspected docs accurately distinguish the installed static train from the recorded **merged-but-unpublished** upstream Observation implementation. The frozen upstream record identifies main `3e595957424ebc8b0211da7ec5926688f0dd41de` and its 2026-10-19 20:25:36 UTC registry snapshot. No Observation dependency, invented lifecycle hook, replacement runtime or financial event bus is shipped here. The guides retain an explicit coherent-artifact/peer/strict-consumer/hook-behavior adoption gate and keep watch/load limited to replaceable read projections.

This code review inspected that source/artifact separation and the declared future tests. It did not independently run an unpublished Observation runtime or establish a later registry status. Likewise, it did not bypass or requalify the documented official Paddle.js **1.6.5** strict declaration blocker.

## Release and CI assessment

Required checks remains an `always()` aggregate that demands success from build, quality and both scenario matrix runs. The workflow builds once, shares package artifacts and caches installation/build inputs; obsolete PR runs are cancelled. No required gate was disabled by the integrated candidate.

The release workflow is separate from PR events. Its default permissions are read-only; only the dependent publication job receives `contents:write`. Checkout does not persist credentials, Actions are pinned to full SHAs, and target inputs are validated before use as argument-array values. It adds no npm publication or token.

Actual release admission requires main ancestry, version/tag agreement, the latest authoritative exact-SHA main-push Checks run, one successful Required checks aggregate and one unexpired named artifact. Assembly re-audits the four exact versioned tarballs from that run, preserves their bytes and records SHA-256 plus commit/run provenance. Publication rechecks downloaded package digests and remote tag identity and has no release-clobber path. Checksums are honestly described as integrity relative to the manifest, not an npm provenance attestation or detached signature. No additional material defect was established in these policies.

## Verification actually performed

Pinned runtime paths were prepended to `PATH` with `/tmp/payments-sdk-tools`. Dependency installation was frozen/offline and reused all **76** installed packages; no resolution was changed. An initial invocation with the ambient Node 24.19.0 was rejected by the engine guard, after which all reported gates used the qualified runtime below.

| Actual command/probe | Runtime | Observed result |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Node 24.21.0 / pnpm 11.25.0 | Passed; exact Foundation 1.10.1 installed |
| `pnpm typecheck` | Node 24.21.0 / TS 7.0.2 | Passed; build/declarations plus strict tests/tools/examples |
| `pnpm toolchain:check` | Node 24.21.0 | Passed; 58 strictly owned `.ts` sources |
| `pnpm lint` | Node 24.21.0 | Passed |
| `pnpm foundation:check` | Node 24.21.0 | Both configured capabilities passed; zero diagnostics |
| `pnpm foundation:assert-dev-only` | Node 24.21.0 | Passed; DEV_ONLY |
| `pnpm foundation:assert-registry` | Node 24.21.0 | Passed; exact locked/installed registry 1.10.1 |
| `pnpm test:boundaries` | Node 24.21.0 | 14 passed, zero failed/skipped; includes release-policy/archive mutation tests |
| `pnpm test:modular` | Node 24.21.0 and 26.11.1 | 11 passed on each, zero failed/skipped |
| `node /tmp/payments-w4-platform-probe.ts` | Node 24.21.0 and 26.11.1 | New public reclassification authority/physical-drain probe passed on each |
| `pnpm test:packed` | Node 24.21.0 and 26.11.1 | Plain/adapters × NodeNext/Bundler passed; runtime imports, optional closure and one physical Resources identity passed **with the harness's explicit overrides** |
| `pnpm release:dry-run` | Node 24.21.0 | Four archive audits passed; core/Paddle/Postgres/GM entries 30/23/40/15 |
| Actual `release-candidate.ts assemble` plus independent digest/manifest assertions | Node 24.21.0 | Passed; four exact tarball hashes, frozen source commit, `npmPublished:false` |
| Fresh-host documented tarball install | Node 24.21.0 / pnpm 11.25.0 | Failed with registry 404 as detailed above |

The local assembly probe copied this worktree's audited tarballs to `.artifacts/ci/packages`, used `RELEASE_TAG=v0.1.0`, the full frozen `RELEASE_COMMIT`, and synthetic `CHECKS_RUN_ID=123`. It independently recomputed every resulting SHA-256 and verified the manifest's exact commit/package count/`npmPublished:false`. Run 123 is only a local provenance-formatting input, **not** evidence of an actual successful CI run. No remote tag, release, artifact or API record was created or modified.

## Limits and required follow-up

This lane did not repeat the independently assigned financial, real-PostgreSQL, provider decoder or full-system suites. No live Paddle account/charge, real browser overlay, physical backup/PITR, production HA, npm publication or authenticated GitHub release was performed. The exact final merged commit still requires its own successful main-push Checks run and unexpired artifact before release.

Recheck the corrected public installation recipe in a fresh external host and the final integration delta. The established P2 is bounded to concrete pre-publication installation, rather than a request to widen SDK runtime scope or introduce another architecture layer.
