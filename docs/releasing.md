# Release candidates and future registry publication

The repository's [Release candidate workflow](../.github/workflows/release.yaml) produces four audited versioned package tarballs, `SHA256SUMS`, a source/CI manifest and a GitHub **prerelease**. It never invokes `npm publish`. Package version `0.3.0` in source does not imply an existing npm release, live Paddle qualification or production readiness.

**Current runtime qualification, 2026-10-21:** official corrected Node 24.22.1 LTS and 26.12.1 binaries pass the bounded unmodified-fetch probe. The [runtime qualification record](runtime-security-admission.md) owns their checksum/source evidence, and the [reviewed hosted baselines](qualification.md#reviewed-hosted-baselines) passed. Each later candidate still requires successful exact-commit main-push Checks. These artifacts remain integration/fixture prereleases; separate account and deployment gates still apply. Generated release notes link the runtime qualification and do not claim production admission.

## Exact-commit release admission

Release starts from an explicit `v<version>` tag push, or a manual workflow dispatch from `main` with an explicit version tag and full lowercase 40-character commit SHA. All four package versions must match that tag. A manual run can create its requested missing tag only after the target passes the same admission checks.

The read-only candidate job:

1. Loads the maintained release tools from trusted `main` and verifies that the requested exact commit is an ancestor of `origin/main`. Existing local/remote release tags must resolve to that commit.
2. Queries the authoritative repository's `checks.yaml` workflow, requiring the latest exact-SHA **main push** run to be completed/successful and its **Required checks** aggregate job to be completed/successful. Pull-request, fork, feature-branch, skipped and failed runs cannot authorize a release.
3. Downloads the unexpired `release-dry-run` artifact from that admitted run ID. It reuses the packages already built, packed and consumed in CI; release tooling never rebuilds or repacks those archives.
4. Requires exactly the four expected versioned tarballs. The shared archive auditor checks package name/version, ESM entry/declarations, exports/license, safe paths, no source/tests/node_modules, resolved workspace/catalog protocols and no Engineering Foundation runtime dependency.
5. Computes SHA-256 for each tarball and writes `release-manifest.json` with repository, commit, tag, exact Checks URL, package versions/digests and `npmPublished:false`. It uploads the candidate bundle as `payments-<tag>-<commit>` for 90 days.

Only the dependent release job receives `contents:write`. It downloads this workflow's admitted bundle, verifies its manifest/tarball digests, resolves the remote tag again, and creates the GitHub prerelease with the six assets. If the tag is annotated, it resolves the commit through the public GitHub Git API. Existing releases/assets are never overwritten or edited; conflicting identities fail visibly.

Both jobs first install the maintained `main` checkout's frozen workspace dependencies with `pnpm install --frozen-lockfile --ignore-scripts`. The SHA-pinned pnpm setup action selects the exact `packageManager` version, currently **11.25.0**; Node setup shares the same pnpm store cache as Checks through the root lockfile. This bootstrap supplies the development-only `node-or-bun` adapter used by the shared captured-command helper. Lifecycle scripts stay disabled, and no package build or pack command runs. Installed tooling comes from trusted `main`; the four delivered archive bytes come only from the admitted exact-commit CI artifact. A missing cache changes install cost, not admission or artifact identity.

No pull-request event triggers this workflow. Default permissions are read-only, checkout credentials are not persisted, all Actions use full commit SHAs, and untrusted inputs enter commands as environment values/argument arrays rather than shell interpolation. The workflow uses the hosted runner's `gh`, Git and tar plus the frozen development tooling above; it introduces no npm publication secret. `GH_TOKEN` is provided only to the admission and GitHub prerelease publication steps, not dependency installation.

Protect `main` with Required checks, and restrict creation/update/deletion of `v*` release tags to trusted maintainers/automation. Treat release tags as immutable. GitHub's repository/organization policy must admit the SHA-pinned Actions and the release job's narrowly scoped token. These controls establish who may select a trusted release; they do not add an environment/manual approval step to normal authorized artifact delivery.

## Create a candidate

The examples below target the next `0.3.0` candidate and become usable after its matching release exists. Existing `v0.1.0` and `v0.2.0` artifacts remain unchanged. First merge the reviewed source and wait for its main-push Checks run to succeed. Its dry-run artifacts currently expire after seven days; an expired artifact requires rerunning the original main-push Checks run to produce the exact commit's packages, or choosing a newly qualified main commit. A manual Checks dispatch is a different event and cannot substitute for this main-push gate. A PR's green check alone is insufficient.

For an existing versioned main commit, an authorized maintainer can push an explicit tag:

```sh
git tag v0.3.0 <full-main-commit-sha>
git push origin v0.3.0
```

Or manually dispatch from trusted `main`, providing the exact tag and commit:

```sh
gh workflow run release.yaml --ref main -f tag=v0.3.0 -f commit=<full-main-commit-sha>
```

Replace the placeholders before running commands. The workflow admits the commit and fails if manifests, tag target, CI status or archives disagree. A tag push racing its main Checks run can fail admission; rerun Release candidate after the exact main run finishes. A manual dispatch for an already published tag fails without changing the release.

If upload or GitHub release creation fails after the version tag exists, retain that tag and candidate provenance, correct the transport/configuration fault, and rerun the failed job. Do not move the tag to another commit or overwrite existing assets. If a release was partially created, inspect its assets and checksums under owner authorization before a specific repair; the automatic workflow deliberately has no clobber path.

## Verify and consume artifacts

Download the candidate assets, verify them in the same directory and inspect `release-manifest.json`:

```sh
gh release download v0.3.0 --repo agent-teams-ai/payments-sdk --dir ./payments-candidate
cd ./payments-candidate
sha256sum --check SHA256SUMS
cd ..
```

The manifest binds the tarball hashes to the exact reviewed commit and CI run. SHA-256 detects byte changes relative to that manifest; it is not a detached signing or npm provenance attestation. Obtain assets from the authoritative GitHub release and confirm the expected tag/commit and successful CI.

Install the matching package set from local tarballs. Before npm publication,
pnpm also needs explicit overrides for the SDK packages' transitive dependencies.
Adding all tarballs in one command does not make their internal versioned
dependencies resolve locally.

For a plain Paddle/PostgreSQL host, download the assets into
`payments-candidate` at the application workspace root. Merge these entries into
that workspace's `pnpm-workspace.yaml` (create the file if it does not exist):

```yaml
overrides:
  '@agent-teams/payments-core': file:./payments-candidate/agent-teams-payments-core-0.3.0.tgz
  '@agent-teams/payments-paddle': file:./payments-candidate/agent-teams-payments-paddle-0.3.0.tgz
  '@agent-teams/payments-postgres': file:./payments-candidate/agent-teams-payments-postgres-0.3.0.tgz
```

Keep existing workspace packages, overrides and other settings. These paths are
relative to that configuration file. Then install from the host application:

```sh
pnpm add ./payments-candidate/agent-teams-payments-core-0.3.0.tgz \
  ./payments-candidate/agent-teams-payments-paddle-0.3.0.tgz \
  ./payments-candidate/agent-teams-payments-postgres-0.3.0.tgz pg@8.23.1
```

For Get Modular, add this fourth entry under the same `overrides` mapping:

```yaml
  '@agent-teams/payments-get-modular': file:./payments-candidate/agent-teams-payments-get-modular-0.3.0.tgz
```

The following Get Modular examples use the published, qualified Core/Assembly
`0.7.0`, Resources `0.2.1`, Conformance `0.5.0` and Observation `0.2.0` train.
The [current upstream record](upstream-qualification.md#october-21-published-get-modular-adoption)
binds official archives and passing installed consumers on both supported Node
floors. A new SDK release still requires its matching archive and exact-commit
release gates above. The previous published train remains in the
[October 20 record](../qualification/observation/published-artifacts-2026-10-20.json).

Then install the matching SDK tarball and exact peers:

```sh
pnpm add ./payments-candidate/agent-teams-payments-get-modular-0.3.0.tgz \
  @get-modular/core@0.7.0 @get-modular/assembly@0.7.0 @get-modular/resources@0.2.1
```

Conformance `0.5.0` is development-only. Add `@get-modular/observation@0.2.0`
when using the optional `/observation` public entrypoint. The
[official artifact record](../qualification/observation/published-artifacts.json)
binds their exact registry identities. The repository's `test:packed` gate uses the same
explicit local-package overrides for strict isolated consumers, while
`test:observation` exercises the optional published integration.

For npm, use the matching four tarballs as direct dependencies and exact `$`
overrides for their internal edges before registry publication. For a host using
the optional Get Modular observation entrypoint, merge the following into the
application's `package.json` after downloading the matching release assets:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "@agent-teams/payments-core": "file:./payments-candidate/agent-teams-payments-core-0.3.0.tgz",
    "@agent-teams/payments-paddle": "file:./payments-candidate/agent-teams-payments-paddle-0.3.0.tgz",
    "@agent-teams/payments-postgres": "file:./payments-candidate/agent-teams-payments-postgres-0.3.0.tgz",
    "@agent-teams/payments-get-modular": "file:./payments-candidate/agent-teams-payments-get-modular-0.3.0.tgz",
    "@get-modular/core": "0.7.0",
    "@get-modular/assembly": "0.7.0",
    "@get-modular/resources": "0.2.1",
    "@get-modular/observation": "0.2.0",
    "pg": "8.23.1"
  },
  "overrides": {
    "@agent-teams/payments-core": "$@agent-teams/payments-core",
    "@agent-teams/payments-paddle": "$@agent-teams/payments-paddle",
    "@agent-teams/payments-postgres": "$@agent-teams/payments-postgres",
    "@agent-teams/payments-get-modular": "$@agent-teams/payments-get-modular"
  }
}
```

Run `npm install --strict-peer-deps --ignore-scripts` and retain its generated
lockfile. A plain host can omit the Get Modular SDK dependency, its override and
the four Get Modular peers. Keep the application's own TypeScript/build setup;
Conformance is only needed for development tests that use it. The required
`test:packed:npm` gate installs with `--omit=dev --ignore-scripts`, compiles all
public exports with the complete strict profile in both resolver modes and runs
the PostgreSQL financial fixture. It verifies the original unpatched Drizzle
artifact and absence of MySQL. The maintainer pnpm patch is not an application
installation step.

The [getting-started guide](getting-started.md) and [adapter guides](../README.md#start-here) explain runtime configuration. Preserve installed versions and the source/CI manifest in deployment evidence. Complete the separate [deployment gates](qualification.md#deployment-and-credential-gates) before real financial/product effects.

## Future trusted npm publication

Registry publication is a separate future setup, not a hidden branch of this workflow. Before enabling it, establish scope/package ownership for all four `@agent-teams` names, public package access, first-publication authority and a coherent version policy. Configure npm trusted publishing for the exact GitHub organization/repository/workflow and intended runner, with OIDC `id-token:write` limited to the publication job and registry-supported provenance. If first publication needs a bootstrap credential, constrain it to that purpose and remove it after trusted publishing is configured.

Qualify the exact npm CLI/runtime, registry authentication, package access, provenance output and publication order: core before dependent packages, and the integration's qualified upstream peers available. Preserve the already tested tarball bytes; do not run a second unreviewed build or expose write credentials to PR jobs. Verify the resulting registry manifests, dist integrity, exports, runtime dependency closure and strict fresh NodeNext/Bundler consumers by reading back the actual published artifacts. Document dist-tag strategy and partial-publication recovery without overwriting a published version.

Only then add a narrowly scoped publication job and update installation claims with verified registry evidence. Until that setup and run occur, GitHub prerelease tarballs are the delivery channel described here.
