# Release candidates and future registry publication

The repository's [Release candidate workflow](../.github/workflows/release.yaml) produces four audited versioned package tarballs, `SHA256SUMS`, a source/CI manifest and a GitHub **prerelease**. It never invokes `npm publish`. Package version `0.1.0` in source does not imply an existing npm release, live Paddle qualification or production readiness.

## Exact-commit release admission

Release starts from an explicit `v<version>` tag push, or a manual workflow dispatch from `main` with an explicit version tag and full lowercase 40-character commit SHA. All four package versions must match that tag. A manual run can create its requested missing tag only after the target passes the same admission checks.

The read-only candidate job:

1. Loads the maintained release tools from trusted `main` and verifies that the requested exact commit is an ancestor of `origin/main`. Existing local/remote release tags must resolve to that commit.
2. Queries the authoritative repository's `checks.yaml` workflow, requiring the latest exact-SHA **main push** run to be completed/successful and its **Required checks** aggregate job to be completed/successful. Pull-request, fork, feature-branch, skipped and failed runs cannot authorize a release.
3. Downloads the unexpired `release-dry-run` artifact from that admitted run ID. It reuses the packages already built, packed and consumed in CI; it does not reinstall dependencies or rebuild different bytes during release.
4. Requires exactly the four expected versioned tarballs. The shared archive auditor checks package name/version, ESM entry/declarations, exports/license, safe paths, no source/tests/node_modules, resolved workspace/catalog protocols and no Engineering Foundation runtime dependency.
5. Computes SHA-256 for each tarball and writes `release-manifest.json` with repository, commit, tag, exact Checks URL, package versions/digests and `npmPublished:false`. It uploads the candidate bundle as `payments-<tag>-<commit>` for 90 days.

Only the dependent release job receives `contents:write`. It downloads this workflow's admitted bundle, verifies its manifest/tarball digests, resolves the remote tag again, and creates the GitHub prerelease with the six assets. If the tag is annotated, it resolves the commit through the public GitHub Git API. Existing releases/assets are never overwritten or edited; conflicting identities fail visibly.

No pull-request event triggers this workflow. Default permissions are read-only, checkout credentials are not persisted, all Actions use full commit SHAs, and untrusted inputs enter commands as environment values/argument arrays rather than shell interpolation. The workflow uses the hosted runner's `gh`, Git, tar and Node built-ins; it introduces no publication dependency or npm secret.

Protect `main` with Required checks, and restrict creation/update/deletion of `v*` release tags to trusted maintainers/automation. Treat release tags as immutable. GitHub's repository/organization policy must admit the SHA-pinned Actions and the release job's narrowly scoped token. These controls establish who may select a trusted release; they do not add an environment/manual approval step to normal authorized artifact delivery.

## Create a candidate

First merge the reviewed source and wait for its main-push Checks run to succeed. Its dry-run artifacts currently expire after seven days; an expired artifact requires rerunning the original main-push Checks run to produce the exact commit's packages, or choosing a newly qualified main commit. A manual Checks dispatch is a different event and cannot substitute for this main-push gate. A PR's green check alone is insufficient.

For an existing versioned main commit, an authorized maintainer can push an explicit tag:

```sh
git tag v0.1.0 <full-main-commit-sha>
git push origin v0.1.0
```

Or manually dispatch from trusted `main`, providing the exact tag and commit:

```sh
gh workflow run release.yaml --ref main -f tag=v0.1.0 -f commit=<full-main-commit-sha>
```

Replace the placeholders before running commands. The workflow admits the commit and fails if manifests, tag target, CI status or archives disagree. A tag push racing its main Checks run can fail admission; rerun Release candidate after the exact main run finishes. A manual dispatch for an already published tag fails without changing the release.

If upload or GitHub release creation fails after the version tag exists, retain that tag and candidate provenance, correct the transport/configuration fault, and rerun the failed job. Do not move the tag to another commit or overwrite existing assets. If a release was partially created, inspect its assets and checksums under owner authorization before a specific repair; the automatic workflow deliberately has no clobber path.

## Verify and consume artifacts

Download the candidate assets, verify them in the same directory and inspect `release-manifest.json`:

```sh
gh release download v0.1.0 --repo agent-teams-ai/payments-sdk --dir ./payments-candidate
cd ./payments-candidate
sha256sum --check SHA256SUMS
cd ..
```

The manifest binds the tarball hashes to the exact reviewed commit and CI run. SHA-256 detects byte changes relative to that manifest; it is not a detached signing or npm provenance attestation. Obtain assets from the authoritative GitHub release and confirm the expected tag/commit and successful CI.

Install the matching package set from local tarballs. For a plain Paddle/PostgreSQL host:

```sh
pnpm add ./payments-candidate/agent-teams-payments-core-0.1.0.tgz \
  ./payments-candidate/agent-teams-payments-paddle-0.1.0.tgz \
  ./payments-candidate/agent-teams-payments-postgres-0.1.0.tgz pg@8.23.1
```

For Get Modular, also install its matching SDK tarball and the qualified exact peers Core/Assembly `0.5.0` and Resources `0.1.0`. Conformance is development-only. Supply matching local tarballs for SDK dependencies together so the package manager can resolve the same version across the entire set; do not mix an unpublished local package with an assumed public registry dependency. The repository's `test:packed` gate demonstrates strict isolated consumers of the complete packed set. Upstream observation implementation has merged, but its coordinated new train was still unpublished at the [current official read-back](upstream-qualification.md#get-modular-merged-implementation-unpublished-release-train); it does not widen this candidate's qualified peer set.

The [getting-started guide](getting-started.md) and [adapter guides](../README.md#start-here) explain runtime configuration. Preserve installed versions and the source/CI manifest in deployment evidence. Complete the separate [deployment gates](qualification.md#deployment-and-credential-gates) before real financial/product effects.

## Future trusted npm publication

Registry publication is a separate future setup, not a hidden branch of this workflow. Before enabling it, establish scope/package ownership for all four `@agent-teams` names, public package access, first-publication authority and a coherent version policy. Configure npm trusted publishing for the exact GitHub organization/repository/workflow and intended runner, with OIDC `id-token:write` limited to the publication job and registry-supported provenance. If first publication needs a bootstrap credential, constrain it to that purpose and remove it after trusted publishing is configured.

Qualify the exact npm CLI/runtime, registry authentication, package access, provenance output and publication order: core before dependent packages, and the integration's qualified upstream peers available. Preserve the already tested tarball bytes; do not run a second unreviewed build or expose write credentials to PR jobs. Verify the resulting registry manifests, dist integrity, exports, runtime dependency closure and strict fresh NodeNext/Bundler consumers by reading back the actual published artifacts. Document dist-tag strategy and partial-publication recovery without overwriting a published version.

Only then add a narrowly scoped publication job and update installation claims with verified registry evidence. Until that setup and run occur, GitHub prerelease tarballs are the delivery channel described here.
