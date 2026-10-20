# Independent review: release tooling bootstrap

Date: 2026-10-20. Scope: the three-file release bootstrap fix for payments PR #5.

## Disposition

**No material P0, P1 or P2 findings in the reviewed change.** The fix addresses
the reproduced cold-runner import failure in both release jobs while preserving
the existing admission, archive identity and publication boundaries. It is ready
to be included in the integration commit and exercised through the required
hosted Checks and authorized release workflow.

This review establishes the scoped code/configuration result and the local
bootstrap/assembly evidence. It does not claim that an authoritative GitHub
release has run. The local assembly fixture deliberately uses synthetic Checks
run ID `1`; `verify` and `publish` were not invoked by that fixture.

## Exact reviewed input

The defect baseline is commit
`d303f2a36774555bd885df63e536b97428c200a0`. During review the root agent added
the documentation/evidence-only commit
`36211b455b3574698c600bbb84be93f3bf476620`. The release tools, policy, dependency
inputs and Checks workflow are unchanged between these commits. The reviewed
working-tree fix is limited to:

| File | Reviewed SHA-256 |
| --- | --- |
| `.github/workflows/release.yaml` | `da5c0278eef01673ab4e6b4fb806ca11a1fac4645a9764b8a852c85340c854cb` |
| `docs/releasing.md` | `04a8c1d41fdf5850708d5e27ac5a29f629b792f2df27d510dcc9e918b171184f` |
| `docs/node-or-bun-adoption.md` | `ac49cc5b41f25278de6349852a8277838744614b8011877b4aa72bb9cbea59ab` |

The exact `git diff --` of those three files has SHA-256
`63cc9b8b6734f960b8734eed1054eadbebf4ee65703cd107561a9767b1a937bc`, equal to
the retained [bootstrap.diff](release-bootstrap/bootstrap.diff). The workflow
adds four lines to each job: the existing SHA-pinned pnpm setup action, pnpm
store caching under Node setup, and a named frozen install with
`--ignore-scripts`. The guides correct the previous built-ins-only assumption
and distinguish installed tooling from delivered SDK archive bytes. No release
tool implementation, package manifest, catalog, lockfile, patch or required gate
is changed. `git diff --check` passed.

I read the repository agent instructions, developer stack, accepted plan,
architecture and the changed guides, plus the retained organization quality
standard and Q source. The retained current organization read-back at
`a34ecc6bc9bb165771f3962dccd25970dd5c0d98` has the same quality-standard bytes
as the provided retained baseline:
`a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587`.

## Defect and ownership

Every operation in `tools/release-candidate.ts` statically imports
`tools/package-artifacts.ts`. That shared helper statically imports
`createProcessExecutor` from `node-or-bun` and `createNodeProcessAdapter` from
`node-or-bun/node`. Both old release jobs checked out trusted `main` and set up
Node without installing dependencies. Consequently even `verify` or `publish`
cannot start on a dependency-free runner; dispatching to a different operation
does not avoid module resolution.

The [before-install record](release-bootstrap/before-install.json) and
[Node 24](release-bootstrap/node24-before-install.log)/
[Node 26](release-bootstrap/node26-before-install.log) raw logs reproduce
`ERR_MODULE_NOT_FOUND` for `node-or-bun` at both qualified floors, with no
checkout `node_modules`. This is a release workflow bootstrap responsibility.
It does not justify a second executor, copying the library implementation or
changing the SDK runtime dependency boundary.

The proposed fix installs the already selected workspace dependencies before
the first tooling command in **both** jobs. It retains the one shared command
helper and actual adopted Node adapter. The declared direct version is still
`0.2.2`; Foundation's separate transitive `0.2.1` pin remains unchanged.

## Boundary review and concrete counterchecks

| Concern | Reviewed result |
| --- | --- |
| Frozen dependency provenance | `pnpm/action-setup` is pinned to `b906affcce14559ad1aafd4ab0e942779e9f58b1`, already used by Checks. With no `version` override it selects `packageManager: pnpm@11.25.0`. The explicit `pnpm install --frozen-lockfile --ignore-scripts` runs in each trusted `main` checkout. The catalog, integrity-bearing lockfile and approved Drizzle patch remain unchanged. |
| Runtime execution dependency | Both release jobs need the real tooling dependency because the CLI imports the shared helper before selecting an operation. The fix supplies it through the existing package manager; no lazy bypass or duplicate process implementation is introduced. The installed `0.2.2` artifact has its own prebuilt exports and no runtime dependencies. |
| Lifecycle/token custody | Dependency lifecycle scripts are disabled. Checkout still uses `persist-credentials: false`; no registry authentication or npm publication secret is added. `GH_TOKEN` remains step-local to candidate admission and prerelease publication and is absent from the install steps. The release job's existing job-scoped `contents:write` permission still applies to its pinned Actions; this review does not claim that omitting an environment variable removes the Actions token context. |
| Cache correctness | pnpm is set up before `actions/setup-node` requests the pnpm cache. The same root lockfile and cache mechanism are used by Checks. This is a store cache, not restored checkout `node_modules` or SDK build output. Frozen installation remains mandatory after a cache hit or miss; a missing cache cannot authorize another version or skip admission. |
| Archive source selection | The candidate still verifies the exact target commit and selects one unexpired `release-dry-run` artifact from the admitted Checks run ID. It downloads to `.artifacts/ci`; `assemble` reads exactly four versioned archives from `.artifacts/ci/packages`. Installation runs before download, has no lifecycle scripts and runs no package build/pack command. There is no path from freshly installed workspace packages to delivered archive selection. |
| Main-push admission | The repository restriction, trusted `main` checkout, ancestry check, full lowercase 40-character SHA requirement, all-four-manifest/tag match, latest exact-SHA authoritative main-push Checks requirement and successful `Required checks` aggregate are unchanged. PR, fork, feature-branch, skipped or failed evidence remains insufficient. |
| Publication and tag invariants | The dependent release job and its permissions remain unchanged. Publication rechecks manifest/archive digests, peels annotated tags, requires the remote tag to resolve to the admitted commit, and creates only a prerelease. Only explicit manual dispatch can create a missing tag. There is still no npm publish, release-edit or `--clobber` path and no change to concurrency or no-overwrite behavior. |

The documentation correctly explains that dependency installation supplies
tooling from maintained `main`, while the four delivered SDK archive bytes come
from the exact admitted commit's CI artifact. These are different provenance
sources by the existing release design; the change does not conflate them.

## Focused evidence inspected

I inspected the raw commands, fixture driver and [results.json](release-bootstrap/results.json)
instead of relying only on the producer's summary. The probes are local,
disposable and contain no GitHub mutation. Their environment removes
`GH_TOKEN`, `GITHUB_TOKEN`, `NODE_AUTH_TOKEN` and `NPM_TOKEN`.
The final [source-binding.json](release-bootstrap/source-binding.json) agrees
with my independently read Git blobs and overlay hashes. I ran
`sha256sum --check SHA256SUMS` in the evidence directory; all 28 retained files
passed, including the successful and separately retained failed-install records.

| Probe | Observed result and significance |
| --- | --- |
| Empty-store candidate install | [candidate-install.log](release-bootstrap/candidate-install.log): Node 24.21.0 and pnpm 11.25.0, explicit frozen install with scripts disabled, 91 downloaded/installed packages, exit 0 in 4.645 seconds. |
| Independent release checkout | [release-install-shared-store.log](release-bootstrap/release-install-shared-store.log): starts without checkout dependencies, uses the same isolated store, reuses 91 packages, downloads zero and exits 0 in 1.897 seconds. This demonstrates installation after a populated store rather than a borrowed warm `node_modules`. |
| Actual archive assembly, both floors | [Node 24](release-bootstrap/candidate-assemble-node24.log) and [Node 26](release-bootstrap/candidate-assemble-node26.log) each report four audited archives and exit 0 through the unchanged actual release CLI/helper. The output copies, manifest digests and checksum checks agree with all four existing input archives. |
| Real command helper, both floors | [Node 24](release-bootstrap/release-import-node24.log) and [Node 26](release-bootstrap/release-import-node26.log) import the actual shared helper in the independent release checkout and capture `release-captured-command-ok` from a real child process. Both exit 0. |
| Actual release CLI import, both floors | [Node 24](release-bootstrap/release-cli-load-node24.log) and [Node 26](release-bootstrap/release-cli-load-node26.log) load the actual CLI with no operation and reach its expected usage error, exit 1. This expected failure proves static imports resolve without invoking admission or publication. |
| Workflow parse | [workflow-yaml-parse.log](release-bootstrap/workflow-yaml-parse.log) records successful YAML parsing. The independent source review also confirms action pinning and step order. |

The first restricted-network installation attempt failed and is retained
separately as `candidate-install-network-sandbox-attempt.log` and `.json`.
It is not presented as successful installation evidence. The probe driver also
documents a corrected harness assertion: dependency archives can contain their
own shipped `.tsbuildinfo`; the relevant no-rebuild assertion checks the SDK's
`packages` tree. I independently confirmed that both fixture SDK trees contain
neither `dist` directories nor SDK `.tsbuildinfo` files. The dependency-owned
Paddle metadata does not indicate an SDK build during release bootstrap.

## Independent byte checks

I independently compared the baseline Git blobs, retained source tar members,
candidate fixture and current working tree for `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, the Drizzle patch,
`tools/release-candidate.ts`, `tools/package-artifacts.ts`,
`tools/release-policy.ts` and `.github/workflows/checks.yaml`. They agree byte
for byte. The source tar SHA-256 is
`8376e85a89d4e2e8f918946f2624241bfa73eed3ac12e2ae9ed8355e0f2ea22c`.
Both final fixtures also have the three reviewed changed files identical to
the working tree.

After installation I separately rechecked both fixtures' manifest/catalog/
lockfile bytes against the unchanged source. Both installed `node-or-bun`
manifests resolve inside their own checkout, declare `0.2.2`, and have SHA-256
`bc16a17f71a162b4b89c305f2d613f3167d140354791c410e9aee3a18a5f0ee9`.
There is no borrowed root dependency directory.

I independently hashed the source `.artifacts/packages` archive, fixture
`.artifacts/ci/packages` archive and assembled output for every package. All
three copies agree, and these digests also match the already retained integrated
qualification record in `docs/reviews/sdk-0.2-completion/README.md`:

| Archive | SHA-256 |
| --- | --- |
| `agent-teams-payments-core-0.2.0.tgz` | `ba561224ac290ecdcd66a20d130abea942ff886c4b7a72bf70731878c6c3b889` |
| `agent-teams-payments-get-modular-0.2.0.tgz` | `5c2ed1d2d638c9ac1125bd33fef605ab9efc94e31642be05721fa0f24a3e5d99` |
| `agent-teams-payments-paddle-0.2.0.tgz` | `0d2a32ff2203cda85f8cd3277abff7a9b5656b564f0602d8342475b1418bde25` |
| `agent-teams-payments-postgres-0.2.0.tgz` | `9ed9aabdb723b1b5df61e20cecf3362dd099f871c5236b28d9eaf5f6b11a4f39` |

Key raw evidence bindings independently recomputed during this review:

| Evidence file under `release-bootstrap/` | SHA-256 |
| --- | --- |
| `results.json` | `b8e4d57bbcba04d83a42faaf5a3754ed5b3fa6b07015614f2f4a1c8c16f2f94b` |
| `candidate-install.log` | `f63c678e5e1b584f2e463a87f8c3487711bae5389d3506acff23c2bf73d84368` |
| `release-install-shared-store.log` | `bed1002ef9cce201fb3dfaa758678105e6b7dbc11a781c0f7fb649b6f78ab282` |
| `candidate-assemble-node24.log` | `3b96ee3d1949930466c98dc2ad78c3b63342ee6f470d1a8e6062e95a4cbd1ed8` |
| `candidate-assemble-node26.log` | `01e8822db8cb737f62083465b8399f8ade197ebe6ddc8763e8c06388d6cb0d65` |
| `test-only-assembled-release-manifest.json` | `9b6133b707529aee3913dec8bdc0f47b6b0c2a51bf8f185b0f758451103ed510` |
| `test-only-assembled-SHA256SUMS` | `ecccb4611533310e3bd78c8492a9d8cce730197259f581e52cfe8f7a00006443` |

## Remaining integration evidence

The local probes prove dependency bootstrap, native tooling execution and
archive byte preservation. They intentionally do not prove GitHub's hosted
cache transport, exact main-push admission against live API data or actual
prerelease publication. The root agent's already planned required Checks and
authorized release workflow own that final external evidence. The three-file
fix does not require rerunning unchanged local database/full runtime suites
solely for this review, and this review introduces no new approval gate.

No tracked implementation files were modified by the reviewer. The reviewer
performed no install/build in the shared checkout, no database/full gate rerun,
no login and no GitHub mutation. This report is the reviewer's only written
deliverable.
