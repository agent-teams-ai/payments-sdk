# Wave 3 independent review: platform, architecture, packaging and release

## Frozen subject and result

- Repository: `agent-teams-ai/payments-sdk`.
- Actual pull request: https://github.com/agent-teams-ai/payments-sdk/pull/2 (stacked feature base).
- Frozen full commit: `aa40b8ecc8a19c0709cb4908ad2131f128e28b5d` (`feat/docs-release`).
- Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-platform`.
- Review date: 2026-10-19.

**No new concrete P0, P1 or P2 finding established within this review's assigned scope.** No production source was changed. This is a scoped review result for the frozen commit, not approval of later changes or proof of a live release/deployment.

The already assigned late binding fanout and adjustment-parent domain findings were excluded from duplicate reporting. The announced new Get Modular reclassification facet does not exist in this snapshot and needs review in the next frozen wave.

## Material examined

Read `AGENTS.md` and the accepted implementation plan, including inward dependencies, independent payment/commercial/credit/usage ownership, static released Get Modular composition, resource lifecycle, strict packed consumers, and P7 release gates. Examined:

- All four package manifests and exports, workspace exact catalog pins, strict root/checks TypeScript projects, Foundation source/dependency policies and mutation-based boundary tests.
- `packages/payments-get-modular/src/{contracts,module,index}.ts`, its package guide, real-runtime tests, strict facet probes, and core admission/tracking/drain implementation.
- `examples/{node-http,fetch-modular,paddle-postgres}.ts` and the public guides for getting started, architecture, operations, recovery/reconciliation, qualification and releasing.
- `.github/workflows/{checks,release}.yaml`, `tools/{package-artifacts,packed-consumers,release-dry-run,release-policy,release-candidate}.ts`, and release-policy tests.

## Architecture and released composition assessment

The four delivery boundaries remain meaningful. Core owns its provider/store/catalog contracts and imports no provider SDK, PostgreSQL, Get Modular, HTTP framework or Foundation. Infrastructure and Get Modular imports point inward to core. The Get Modular adapter depends on core plus the declared released peer train rather than pulling Paddle or PostgreSQL into its runtime. Foundation remains a development dependency.

The integration uses the actual published Core/Assembly `0.5.0`, Resources `0.1.0` and test-only Conformance `0.3.0`. Static declarations and preparation are inert; configuration is an explicit per-run input. One prepared template supports isolated runs with independent scopes. The runtime is a single plain `createPayments` instance with frozen capability facets; no parallel fallback runtime or financial event bus is introduced.

The read facet does not acquire command authority. Root consumers cannot obtain Resources control or core `stop`/`drain`; the Host retains those. Scoped cleanup stops new calls, waits for admitted facet work (including reads still awaiting borrowed storage), and then waits for core/provider physical settlement. The tests exercise a held provider beyond the operation deadline, incomplete close debt, rejoining close, sibling ownership, failed downstream construction and late cancelled acquisition. No invented GM lifecycle hooks are used.

The new durable Paddle/PostgreSQL example compiles inside the strict examples project. Its bootstrap and runtime setup are separate; consumer registration precedes worker startup; startup failure and close use worker/core stop and physical drain without ending the borrowed pool. Its documented Host prerequisites include transport body limits, request deadlines, authentication, consumer policy and pool ownership. The shared Fetch handler's post-read size check is explicitly documented as insufficient for transport allocation/slow-stream protection, so this was not treated as a hidden production guarantee.

## Packaging and release assessment

The isolated packed test actually installed tarballs into fresh consumers, rather than using workspace aliases. Both plain core and all-adapter consumers passed NodeNext and Bundler declaration checks with `skipLibCheck:false`, followed by runtime import checks. The plain consumer verifies absence of Paddle, Get Modular, `pg` and Foundation resolution. The adapter consumer verifies that Host and integration resolve the same physical Resources package.

The workflow's default token is read-only. Only the job dependent on candidate admission receives `contents:write`; checkout does not persist credentials. All referenced Actions are pinned to full 40-character SHAs. Untrusted tag/commit inputs are passed through environment values and spawn argument arrays and validated before git/API use. No npm publishing path or npm credential is introduced.

Admission requires the authoritative repository, full lowercase commit identity, main ancestry, version/tag agreement, latest exact-SHA main-push Checks run success, one successful Required checks aggregate and one unexpired named artifact. It refuses nearby PR/fork/feature/manual Checks runs. The Required checks job uses `always()` and fails unless every prerequisite result is `success`, including skipped/cancelled/failure states.

Candidate assembly consumes only the four expected versioned tarballs from that admitted run. It shares the archive audit with the dry-run gate, writes package SHA-256 digests and exact commit/run provenance, and does not rebuild different bytes. Publication rechecks the bundle identities/digests and remote tag target and has no clobber/edit path. Main/tag protection and immutable release tag policy are stated as repository-owner requirements. Checksums are accurately described as integrity relative to the manifest, not a detached signature or npm provenance attestation.

The docs distinguish source manifest versions from npm publication, fixture SDK behavior from real Paddle account behavior, static composition from future Observation, and logical recovery tests from real physical PITR/HA evidence. The exact official Paddle.js `1.6.5`/TS7 declaration blocker is recorded rather than bypassed. The still-present unused wrapper devDependency in this frozen snapshot is a known separate cleanup; this review makes no wrapper qualification claim.

## Verification actually performed

Executed against the detached frozen worktree with the provided pinned tools. The install was offline and frozen; all 77 installed packages were reused from the content-addressable store.

| Command/probe | Runtime | Observed result |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile` | Node 24.21.0 / pnpm 11.25.0 | Pass; no dependency resolution change |
| `pnpm build` | Node 24.21.0 | Pass |
| `pnpm typecheck` | Node 24.21.0 / TS 7.0.2 | Pass; includes tests/tools/examples strict project |
| `pnpm test:modular` | Node 24.21.0 | 11 passed; 0 failed/skipped |
| `pnpm test:modular` | Node 26.11.1 | 11 passed; 0 failed/skipped |
| `pnpm test:boundaries` | Node 24.21.0 | 14 passed; 0 failed/skipped, including four release-policy/archive tests |
| `pnpm test:packed` | Node 24.21.0 | Plain/adapters × NodeNext/Bundler: all four passed; runtime import/optional closure/physical Resources checks passed |
| `pnpm release:dry-run` | Node 24.21.0 | Four audited archives produced; core 30, Paddle 23, PostgreSQL 40, GM 15 archive entries |
| `pnpm foundation:assert-dev-only` | Node 26.11.1 | Pass, DEV_ONLY |
| `pnpm foundation:assert-registry` | Node 26.11.1 | Pass, locked/installed registry Foundation 1.10.0 |
| Actual `release-candidate.ts assemble` CLI on locally copied dry-run archives | Node 24.21.0 | Pass; four archives plus sums/manifest/notes; independent assertion recomputed every package digest and checked commit and `npmPublished:false` |
| Actual `release-candidate.ts verify` CLI requesting this unmerged frozen feature commit | Node 24.21.0 | Correctly failed closed at main ancestry before GitHub API admission |

Assembly probe used dummy `CHECKS_RUN_ID=123` strictly as a local content/provenance formatting test. It is not evidence of an actual Checks run. No GitHub release/tag/artifact was created or modified. No external message or PR comment was sent.

For event/artifact semantics consulted primary GitHub documentation: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows and https://docs.github.com/en/rest/actions/artifacts . No third-party source was used to establish a finding.

## Limits and next-wave obligations

This review did not rerun the full financial, PostgreSQL or end-to-end suites; those responsibilities and the reported successful runtime CI run were supplied by the parent review coordinator. That supplied CI result is not substituted here for newly executed exact-SHA release CI. The new durable host example was compiled and inspected, not independently brought up with real Paddle credentials or a live account.

No authenticated live release workflow, actual GitHub publication, npm publication, real charge, physical restore, backup/PITR or production HA exercise was attempted. The script-level negative admission probe covers the current feature commit's rejection, while existing policy tests cover the successful/sad-path run selection rules. A final merged commit must earn its own successful main-push Checks run and unexpired package artifact before release.

Later runtime/release workflow edits, the domain fixes in progress, unused wrapper dependency removal and the forthcoming reclassification facet require the next frozen-wave verification. No additional abstraction, style cleanup or speculative supply-chain hardening is requested as a material fix by this review.
