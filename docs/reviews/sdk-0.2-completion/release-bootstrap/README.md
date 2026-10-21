# Release tooling bootstrap correction

Recorded 2026-10-20. This is a focused local release-tooling qualification. All assembled provenance is **TEST ONLY**; synthetic `CHECKS_RUN_ID=1` does not admit a release.

The per-command raw logs are available through the
[immutable evidence archive](../../archived-evidence.md). This directory retains
the source binding, exact diff and compact result reports; the outcomes and
original execution subjects below are unchanged.

## Finding and correction

`tools/release-candidate.ts` imports the shared `tools/package-artifacts.ts` helper. That helper statically imports the admitted development dependency `node-or-bun` 0.2.2 and its Node adapter. Both release jobs previously checked out trusted `main` and installed Node but never installed workspace dependencies. A dependency-cold source archive therefore failed with `ERR_MODULE_NOT_FOUND` for `node-or-bun`, before candidate assembly could run. The same import affects the publication job.

The three-file correction adds the existing SHA-pinned `pnpm/action-setup` before Node setup in both jobs, enables the existing `actions/setup-node` pnpm store cache, and runs `pnpm install --frozen-lockfile --ignore-scripts` before either job loads release tooling. The exact pnpm 11.25.0 version remains owned by the existing root `packageManager` field. The documentation now distinguishes installing trusted release tooling from rebuilding or repacking the already-qualified package archives.

This deliberately corrects the previous dependency-free release assumption. A filtered or separate release-tool manifest would add another owned dependency profile and could drift from the one shared helper; a frozen workspace install is the smallest coherent change. The full workspace install downloads some tooling unused by release, measured below. Shared store reuse limits that cost without reusing a checkout's `node_modules`.

## Source and change binding

- Explicit source archive: `d303f2a36774555bd885df63e536b97428c200a0`; source tree `f4b9187cd04fa4097d0e33a9bd84e49cede0e98a`.
- Source archive SHA-256: `8376e85a89d4e2e8f918946f2624241bfa73eed3ac12e2ae9ed8355e0f2ea22c`.
- Reviewed three-file diff SHA-256: `63cc9b8b6734f960b8734eed1054eadbebf4ee65703cd107561a9767b1a937bc`.
- Root advanced to the documentation-only commit `36211b455b3574698c600bbb84be93f3bf476620` during this work. The tooling, runtime, package manifests, catalog and lockfile used by the probes remain byte-identical to the explicit archived base.
- `source-binding.json` retains the three overlaid file hashes and unchanged release-tool/dependency input hashes. `bootstrap.diff` contains exactly the requested workflow and two owning documentation edits.
- Candidate and release fixtures were separately extracted from the source archive. Neither borrowed or symlinked the shared working checkout's dependencies. Their only shared dependency input was a new fixture-owned pnpm content-addressable store.

## Observed results

| Probe | Result |
| --- | --- |
| Actual `release-candidate.ts assemble` before installation, Node 24.21.0 and 26.11.1 | Both reject with `ERR_MODULE_NOT_FOUND` for `node-or-bun`; no fixture `node_modules` exists |
| Candidate frozen `--ignore-scripts` install with initially empty isolated store | PASS; 91 packages downloaded; 4.645 seconds; pnpm 11.25.0; own local `node-or-bun` 0.2.2 |
| Separate release-checkout frozen `--ignore-scripts` install sharing only that store | PASS; 91 packages reused, zero downloaded; 1.897 seconds; own local `node-or-bun` 0.2.2 |
| Actual candidate assembly of the four existing local 0.2.0 archives, Node 24.21.0 and 26.11.1 | PASS; actual shared archive auditor and `node-or-bun` captured command executor; all four input/output SHA-256 values identical |
| `sha256sum --check SHA256SUMS`, both assembly runs | PASS, all four archives |
| Actual shared captured command in independent release checkout, Node 24.21.0 and 26.11.1 | PASS; subprocess stdout round-trips through real helper |
| Actual release CLI load with no selected operation, both Node versions | Resolves all imports and reaches the expected usage error; no verify/publish/GitHub command is selected |
| Workspace dependency input bytes | Root manifest, catalog and lockfile unchanged against explicit base in both installs |
| SDK build outputs | No SDK package `dist` directories or SDK `.tsbuildinfo` files created |
| Workflow syntax | Parsed with the admitted YAML parser without errors |
| Three-file diff whitespace | `git diff --check` passes |

The release CLI's expected usage-error probes intentionally exit 1 and assert the exact usage message. They are successful import checks, not successful publication attempts.

## Archive byte identity

Only copies of the qualified local tarballs were passed into the isolated assembly fixtures. The shared root inputs were read before and after and remained unchanged. Assembly wrote no package build output and invoked no pack command.

| Input and output filename | SHA-256 |
| --- | --- |
| `agent-teams-payments-core-0.2.0.tgz` | `ba561224ac290ecdcd66a20d130abea942ff886c4b7a72bf70731878c6c3b889` |
| `agent-teams-payments-get-modular-0.2.0.tgz` | `5c2ed1d2d638c9ac1125bd33fef605ab9efc94e31642be05721fa0f24a3e5d99` |
| `agent-teams-payments-paddle-0.2.0.tgz` | `0d2a32ff2203cda85f8cd3277abff7a9b5656b564f0602d8342475b1418bde25` |
| `agent-teams-payments-postgres-0.2.0.tgz` | `9ed9aabdb723b1b5df61e20cecf3362dd099f871c5236b28d9eaf5f6b11a4f39` |

## Preserved boundaries

The exact-SHA main-push Checks admission code, Required checks requirement, trusted-main tool source, download run ID, artifact names, archive paths and publication behavior are unchanged. The change does not rebuild or repack packages, publish to npm, introduce an alternate executor, weaken archive audits, change production dependencies, add a fallback import path, grant administrator permissions, or broaden credential scope. Existing step-level `GH_TOKEN` remains limited to verify/publish; dependency installation has no such environment entry. All Actions remain SHA-pinned and checkout credentials remain unpersisted.

## Pinned action source read-back

The public pinned primary sources were retrieved through read-only GitHub API calls and retained in the original disposable fixture:

- `pnpm-action-setup-readme.md`, `pnpm-action-setup-action.yml.txt`, `pnpm-action-setup-install.ts.txt`: `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1`. Omitting `version` reads the root `packageManager`; default `run_install` is null, so this action does not run workspace lifecycle installation before the explicit controlled step.
- `setup-node-cache.md`, `setup-node-cache-restore.ts.txt`: `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`. The action caches package-manager data rather than `node_modules`, reads the root lockfile by default, and keys its pnpm cache by runner OS, architecture, package manager and lockfile hash. Checks and both release jobs therefore use the same cache mechanism and key inputs. Cache availability remains an optimization rather than an admission condition.

## Harness corrections and environmental attempts

The first isolated install attempt was denied network socket access by the default local sandbox and downloaded no dependencies. Its raw log remains available in the archive as `candidate-install-network-sandbox-attempt.log`; this is not a package-install or workflow failure. The subsequent authorized network-enabled install completed successfully into `candidate-online` with a different initially empty fixture-owned store.

After that successful install, an overbroad harness assertion inspected all dependency-owned `.tsbuildinfo` files. Published dependency archives can legitimately contain such metadata. The harness was corrected to inspect the SDK package roots, retaining and reusing the successful install log, now in the archive. The original fixture's `run-probes.py --resume-candidate-install` records this continuation explicitly. No implementation or dependency change was needed for this harness correction.

## Evidence and limits

The retained `before-install.json`, `results.json` and `source-binding.json`, the archived per-command raw logs, and the original fixture's `run-probes.py` and `SHA256SUMS` bind the results. The fixture driver and checksum file were not copied into this repository. `test-only-assembled-release-manifest.json` and `test-only-assembled-SHA256SUMS` are original local fixture outputs only. Their commit field names the source fixture and their Checks URL uses synthetic run ID 1. They must never be used as an admitted bundle or publication input.

No database, full `pnpm check`, shared-root install/build, GitHub mutation, release admission verification, tag creation, release creation or npm publication ran for this correction. The local shared store probe does not execute GitHub's cache service or Actions runners. The real release must run after reviewed merge and successful exact-commit main-push Checks. Existing production runtime security and live Paddle qualification limits remain unchanged.
