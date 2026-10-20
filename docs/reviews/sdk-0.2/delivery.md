# Final independent delivery review

## Subject, scope and result

Reviewed clean source HEAD `be42c359c3051588412488f2f1812ee5d74b290e` in `/workspace/scratch/9e36ca3bbd13/implementation/payments-observation-candidate`, against the public-main baseline `1080854be73fc9e61f7a2b3f634c79c661fd1a55`.

**No new actionable P0, P1 or P2 finding was established in this delivery review.** This result covers release admission, required CI wiring, shared build artifacts, packed consumers, private Drizzle admission, public dependency boundaries, and installation/version/migration coherence. It does not independently certify the payment/storage/worker or hook implementations or replace the exact integrated commit's complete qualification.

This is one additional final independent review. It does not constitute another sixteen-review wave and does not change the historical design or implementation review counts.

The repository was clean at the start and end of this pass. No repository file, dependency, generated artifact, source pin, historical record or Git state was modified. This report is the only review output written.

## Governing inputs read

- Repository `AGENTS.md`, `docs/developer-stack.md`, the accepted implementation plan, architecture, public README, qualification record, release guide, getting-started guide and the relevant adapter guides.
- Organization Engineering Quality Standard at `3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0`, freshly retrieved by the coordinating agent on 2026-10-20 and read from `research/continuation/sources/org-quality-3a203362.md`.
- Pinned Q at `5f1b5aefa96d64448d909ae9c04a823afe145ea8`, freshly retrieved by the coordinating agent and read in full from `research/continuation/sources/q-5f1b5aef.md`.

Direct web opens returned `DisabledError`; the freshly fetched exact source files supplied by the coordinator resolved that access limitation. I did not infer missing policy or treat current central navigation as an adopted successor contract.

## Checks and counterexamples assessed

### Required CI and build identity

Sources: `.github/workflows/checks.yaml:20–154`, root `package.json:13–32`, `tools/toolchain.ts`, package compiler projects and `.gitignore`.

The build job installs from the frozen lockfile, performs the project build and strict checks, checks toolchain/source ownership, and uploads the compiled package directories. Quality and the two independent Node scenario jobs depend on that build and download the shared output. The final `Required checks` job uses `if: always()` and explicitly rejects every prerequisite result other than `success`. Skipped/cancelled scenario jobs cannot turn that aggregate green. The scenario runner also rejects an empty named test group.

The build cache key includes the lockfile, compiler configurations, package TypeScript files and package manifests. The dependency patch identity is represented in the lockfile. A different source, compiler/dependency configuration or package manifest therefore does not silently reuse the old exact-key build. There is no observed CI route that runs a packed gate against a prior commit's checkout-local output. Git-ignored local `.artifacts` content is not current qualification evidence and was not used as such here.

No build hooks were added to package manifests; release assembly does not rebuild. I found no concrete stale-build false green in the reviewed CI path.

### Release admission and provenance

Sources: `.github/workflows/release.yaml`, `tools/release-policy.ts:1–35`, `tools/release-candidate.ts:15–97`, `tools/package-artifacts.ts:15–33`, and `tools/test/release-policy.test.ts`.

Admission requires a full lowercase commit SHA on main ancestry, coherent four-package versions, an existing matching tag or explicit manual dispatch, the authoritative repository's latest exact-SHA main-push Checks run, and the successful final aggregate job. It rejects a nearby commit, PR/fork/feature event, failed newer run, missing aggregate or skipped aggregate. The admitted run ID is used for artifact download. Candidate assembly requires exactly four versioned tarballs, audits them again, and computes checksums plus the source/CI manifest. Publication checks the candidate digests and resolves the remote tag again before creating immutable prerelease assets.

Write authority is confined to the dependent publication job. The workflow is not a PR publication path. Its commands receive untrusted values through argument arrays/environment inputs; tag and SHA syntax checks reject ambiguity. The existing prerelease/security status is visible in release notes and public guidance. This workflow makes no npm publication claim.

### Packed consumers and Drizzle containment

Sources: `tools/packed-consumers.ts:9–77`, `tools/packed-npm.ts:20–127`, `tools/qualify-drizzle.ts:20–160`, `qualification/drizzle/artifact.json`, package manifests and `packages/payments-postgres/README.md:7–41`.

The regular packed gate discovers exported package subpaths, checks NodeNext and Bundler consumers with `skipLibCheck:false`, `exactOptionalPropertyTypes:true` and `noUncheckedIndexedAccess:true`, runs installed imports, and rejects unrelated infrastructure/framework packages from a core-only consumer. It intentionally excludes the optional observation subpath from the static host and checks that Observation remains absent. The observation-specific and npm gates cover that optional entrypoint separately.

The npm consumer uses all four exact tarballs as root dependencies, with SDK-only overrides for the unpublished internal edges. It installs original Drizzle from the registry, checks the lockfile identity/integrity, every original Drizzle declaration byte, the official runtime manifest, absence of MySQL and Foundation from relevant production resolution contexts, and the compiler's actual all-export file graph. ORM/MySQL declaration paths are forbidden in that graph. This is materially stronger than merely compiling a patched maintainer workspace.

The maintainer Drizzle admission compares the original archive SRI, installed complete file set, exact eight reviewed declaration changes, unchanged package bytes elsewhere, and positive/negative strict type probes. MySQL is confined to the owning adapter's development dependency. No public SDK declaration is required to import ORM types. The original official Drizzle artifact remains the production consumer input.

The npm test fixture deliberately adds test/peer inputs such as Conformance, Undici and type packages. Its `--omit=dev` installation proves the SDK packages' installed consumer path; it does not imply those additional fixture inputs form a recommended minimal application manifest. Current qualification documentation identifies that fixture limitation.

### Public installation and compatibility claims

Sources: `README.md:3–18`, `docs/getting-started.md:7–13`, `docs/releasing.md:3–110`, `CHANGELOG.md`, `packages/payments-get-modular/README.md:5–17, 127–139`, and `docs/architecture.md` extension sections.

All four SDK versions are `0.2.0`, the changelog explicitly says unreleased, and the release examples explain that the matching candidate must first exist. Existing `v0.1.0` artifacts are not relabeled. The migration entry explains the Get Modular peer change, coordinated SDK upgrade and optional Observation installation. The public peer set is coherent with the package manifests and current published-artifact record.

The pnpm install path supplies local-tarball overrides so transitive SDK edges do not accidentally fall back to the registry before publication. Optional Get Modular/Observation installation is explained. The declaration patch is explicitly a maintainer concern, not an application install requirement. The guides preserve provider, transport, storage and host ownership and distinguish checkout preparation, read projections and durable financial delivery.

The architecture labels the foreign provider as a disposable contract fixture. It does not claim another production provider, database, operating system or broker has been qualified. Current public guidance retains the blocked production runtime gate and live-account/deployment qualification limits.

## Focused execution

Executed on exact Node `24.21.0`:

```sh
/tmp/payments-cont-toolchain/node24/bin/node --test tools/test/release-policy.test.ts
```

**Result: 4 passed, 0 failed, 0 skipped.** The four checks cover workflow authority/YAML, exact successful run admission, tag/SHA syntax, and archive/dependency rejection. The initial restricted execution could not spawn local `tar` (`EPERM`); the same narrow command subsequently passed with approved sandbox escalation. The initial failure was an execution restriction, not a repository finding.

No broad suite, PostgreSQL, E2E, registry-install, dependency upgrade, repack or full source build was run in this review. The coordinating agent owns the integrated commit's fresh full qualification and final remote evidence. The review did not reuse historical local `.artifacts` reports as a passing result for this HEAD.

## Nonblocking opportunities

These are improvements rather than P2 defects:

1. **Give npm users a copyable minimal manifest and command.** `docs/releasing.md:104–110` accurately describes root file dependencies and `$` overrides, but the complete working syntax is currently discoverable in `tools/packed-npm.ts:28–40`. A small public JSON example would make the new npm path easier to reproduce and avoid consumers guessing npm override syntax. It should omit fixture-only dependencies and show the qualified Get Modular peers only for that optional package set.
2. **Consider sharing immutable packed archives when CI packing cost becomes measurable.** The quality path packs for `test:packed` and then again for `release:dry-run`; each scenario job packs for observation and npm qualification. None of those paths rebuilds the SDK, and the four small archives do not establish a material CI regression on the current evidence. Reusing one hash-bound tarball set could remove repeated packing while retaining each independent install, strict resolver and financial gate. This is not grounds to drop a gate or serialize the independent jobs.

## Scores within this review's scope

| Area | Score | Basis and limits |
| --- | --- | --- |
| SDK consumer usability | **8.3 / 10** | Clear four-package split, plain-core path, optional composition/hooks, explicit migration and honest deployment scope. Financial host setup necessarily requires substantial application policy/lifecycle work. A copyable minimal npm recipe and shorter first-success path would improve approachability. This is not a score for production readiness. |
| Delivery/tooling code quality | **8.8 / 10** | Cohesive archive/release helpers, strict consumer ownership, strong original-artifact checks, exact run admission, meaningful rejection tests and no new domain dependency leakage. Some manifest/peer knowledge is repeated across scripts and guides, and packaging is repeated, but no demonstrated broken contract justified additional abstraction or a blocking finding. |

The absence of new findings applies to this reviewed delivery slice at the stated source revision. It does not clear independent security, live Paddle, physical recovery, authentication or production deployment gates.
