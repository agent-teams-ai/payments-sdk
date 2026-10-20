# Independent final evidence read-back

## Result and subject

On 2026-10-20, independently reviewed the staged `final-docs-staging/README.md`, evidence manifest, complete two-floor logs/reports, retained interruption/cold-build history, metric JSON, existing package archives and generated compiler graphs for source **`d303f2a36774555bd885df63e536b97428c200a0`**. Also read the forthcoming documentation delta and independently queried the exact hosted Checks/CodeQL runs through the authorized GitHub CLI.

**No material source, count, artifact-integrity or qualification contradiction found. Both complete local execution proof chains are internally consistent and support successful complete `pnpm check` runs at the same exact source. Hosted Checks and CodeQL also independently read back as successful at that source.** One small copied-memo relative-link defect was reported immediately to the delivery owner for correction and manifest refresh; it does not change the numerical or source evidence.

This is an evidence audit, not a second execution of the suites or a cryptographically verified source-to-build attestation. No test, build, install, database operation, maintained-source edit, Git mutation or GitHub write was performed. The only file written by this follow-up is this requested addendum. Source files were read and hashed; archives were read without extraction or execution; actual Git objects and remote run/job metadata were read only.

## Manifest and local proof chains

At the initially inspected staging snapshot, **63 manifest-listed files** plus `evidence-manifest.json` made **64 actual files**. Listed payload totaled **381,468 bytes**. Every listed length and SHA-256 matched; no listed file was missing and no unlisted payload existed. The initial manifest SHA-256 was `d1e4aa572722bf54127f925ccbb1a03e6738559fa96380b88f886836637de965`. A later link correction or addition of this addendum legitimately changes that manifest; the owner must regenerate it rather than preserve this initial hash as if the bytes were unchanged.

Both retained full-run records name the full `d303f2a` commit, exact floor, `pnpm check`, frozen installation, fresh forced build, the complete check, and exit code **0** for each stage and the overall run. The raw logs contain those three actual stage boundaries, the complete unshortened check route, all expected gates and final `published:false` release dry run.

| Floor | Independently recomputed full-log SHA-256 | Complete-check interval, UTC |
| --- | --- | --- |
| Node 24.21.0 | `9ed8294ee767c99ec392b975b4a84ba48899fec7d979519c81a2f05dda0c8e6b` | 12:12:25.112398 to 12:15:34.113709 |
| Node 26.11.1 | `d8f47aef07d82852b7d0145ea27ec39025d74322705f47349d8e4d6b0c546a69` | 12:22:48.340197 to 12:25:33.525251 |

Each hash agrees with its full-run record, qualification summary, staged manifest and public README. The reported intervals and distinct database names are consistent across the prose and records. Freshness of each disposable database, PostgreSQL patch version, the serial database lease and the orchestration's before/after clean-source checks remain recorded execution-owner observations; this read-only auditor did not query PostgreSQL or independently observe database creation. No stronger physical restore or HA result is inferred.

Independently parsed all eight Node test-count blocks from each actual full transcript:

| Executed surface | Node24 tests/pass | Node26 tests/pass |
| --- | ---: | ---: |
| Boundary/tooling | 21 / 21 | 21 / 21 |
| Core | 49 / 49 | 49 / 49 |
| Official Paddle SDK | 18 / 18 | 18 / 18 |
| Static Get Modular | 11 / 11 | 11 / 11 |
| PostgreSQL/integration | 45 / 45 | 45 / 45 |
| E2E | 53 / 53 | 53 / 53 |
| Packed published Observation | 4 / 4 | 4 / 4 |
| Production-only npm financial fixture | 1 / 1 | 1 / 1 |

Every block has **zero failures, cancellations, skips and todos**. The first six exactly equal the separately retained summary dictionaries. The last two are present in the raw complete transcript and their scenario logs; they were not inferred from an unrelated earlier successful run. These reporter counts include possible parent/subtest nodes and repeated delivery surfaces; the README correctly avoids summing them into distinct business scenarios.

Parsed the five top-level JSON results embedded in each full transcript and structurally compared them to that floor's separately saved **Drizzle, published Observation, packed pnpm, packed npm and release dry-run** records. All ten comparisons match. The isolated Observation and npm raw scenario-log SHA-256 values also match their respective `scenarioOutputSha256` fields on each floor. Both raw logs report Node/TypeScript admission and **78 strictly owned maintained `.ts` sources**, complete lint, full configured Foundation coverage with zero diagnostics, registry and development-only assertions.

## The interrupted Node26 history is represented honestly

The preserved interrupted transcript SHA-256 is `0f18f6c475f756a4e9c83cbbac52d598fa068db63939e0f22ec7c2ef7dce5f8f`. Its separate `record.json` names `d303f2a`, says the execution session was lost, records Observation as the last completed gate and packed pnpm as the last started gate, and explicitly states that no completion exit code is available. The actual transcript ends after the Observation result and `$ node tools/packed-consumers.ts`, matching that account.

The nearby old `fb9baa1` full-check JSON is explicitly identified as unrelated and must not be paired with that incomplete transcript. The staged successful Node26 record instead names a fresh database, new complete stage interval and the independently matching final log hash above. It contains all remaining packed/npm/release output. The public README correctly describes a new execution of the entire route; it does not repair or relabel the interrupted attempt into success.

The earlier SDK 0.2 `fb9baa1` qualification and the unsuccessful original cold hosted subject remain historical evidence for their own inputs. This addendum supersedes the pending-Node26 execution status in the earlier delivery-scope memo; it does not pretend that memo originally inspected completed later evidence.

## Package and consumer integrity

Read and SHA-256-hashed the actual four current `.artifacts/packages` tarballs. Each actual size/hash agrees with **both** floor summaries, both published-Observation payment-artifact records, both npm-consumer package records and the README's table:

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `agent-teams-payments-core-0.2.0.tgz` | 64,695 | `ba561224ac290ecdcd66a20d130abea942ff886c4b7a72bf70731878c6c3b889` |
| `agent-teams-payments-get-modular-0.2.0.tgz` | 20,855 | `5c2ed1d2d638c9ac1125bd33fef605ab9efc94e31642be05721fa0f24a3e5d99` |
| `agent-teams-payments-paddle-0.2.0.tgz` | 26,307 | `0d2a32ff2203cda85f8cd3277abff7a9b5656b564f0602d8342475b1418bde25` |
| `agent-teams-payments-postgres-0.2.0.tgz` | 67,244 | `9ed9aabdb723b1b5df61e20cecf3362dd099f871c5236b28d9eaf5f6b11a4f39` |

Read every packed `dist` member and compared it directly to the current built tree: **32 core, 20 Paddle, 40 PostgreSQL and 24 Get Modular files; all 116 match**. No archive member was executed. This substantiates actual byte identity rather than accepting matching tarball names in JSON. Later hosted main-push/release assembly must bind its own archives; the public record accurately reserves published-byte authority for the eventual release manifest.

The two packed npm reports retain the original exact Drizzle registry URL/version/SRI, no maintainer patch configuration, strict production-only install settings, absent MySQL and all six public exports. Both Drizzle-admission records name clean `d303f2a`, the same eight permitted declaration targets/patch hash, original 1,743-file runtime manifest and original 1,742-file declaration manifest, with five invalid probes rejected per resolver. These are consistent with the previously reviewed enforcement and byte-admission policy; no new dependency version or suppression appears.

As additional evidence, independently hashed the actual retained npm lockfiles and both resolver file lists in `.artifacts`. Their hashes match the new reports. The two lockfiles are byte-identical, name the official exact Drizzle artifact/SRI, and have no MySQL package path, development-marked package or source/workspace link. Each of the four resolver graphs contains **376 paths**, the actual generated all-export source input, every one of the six public-export declaration targets and **zero Drizzle/MySQL declaration paths**. Node24/Node26 graph hashes differ because their absolute isolated temporary paths differ; both graphs satisfy the same public boundary.

The public staging directory retains the compact reports/logs, not the deleted isolated npm installations or all of these additional scratch files. This audit does not claim to reopen those deleted installations. The current source still owns the enforcing complete file-set/original-byte/strict-export assertions. `npmPublicationProven:true` in the Observation result concerns the **five upstream Get Modular artifacts**; both SDK release dry runs explicitly say `published:false`.

## Cold-source and reuse boundaries

Independently compared all **212 baseline** and **212 fixed** manifest rows to actual Git object bytes at `95e996ff0bbe8edb003fcd42ab66c6aa429a7253` and `d303f2a36774555bd885df63e536b97428c200a0`: **424 hash comparisons, zero mismatches**. The only changed rows are `docs/foundation-adoption.md`, `qualification/observation/tsconfig.json` and `tsconfig.checks.json`. The actual commit diff exactly equals the retained patch, SHA-256 `538dc9b01661af58a85afc86838f91cae72fcbafec85eead2295535defc2eccf`.

The two no-emit consumer references are the changed build/discovery concern. The separate cold-build reviewer explicitly inspects and probes that concern at `d303f2a`; unchanged core/provider/storage/consumer algorithms can retain their earlier `95e996f` source-review conclusions. This is an honest byte-based reuse assessment. It is not a claim that every earlier reviewer reran the entire integration or that the initial Foundation witnesses automatically prove all later discovery behavior.

At read-back, the working tree contains only the announced root README/CHANGELOG and documentation changes plus the untracked public completion directory. No runtime package, package manifest/README, lockfile, compiler config, tooling source, test, Foundation policy or CI workflow differs from `d303f2a`. Those documentation additions do not alter the four packed package inputs or the measured runtime bytes. They nevertheless create a later delivery commit: final exact-head required CI and subsequent exact-main-push release admission remain required. The prose correctly names the executed `d303f2a` source instead of rebadging the older local executions with that future SHA.

## Metrics and public wording

The staged `production-loc.json` is byte-identical to this reviewer's independently generated `/tmp/payments-scope-loc-d303.json`, SHA-256 `25e4ced87407cb3b3195cc73d464c5ddd9da6578aca1252e29fa1ffefc9f051c`. All 29 current input hashes, including both disclosed exclusions, still match. The README accurately reports **27 files, 3,514 runtime statement/declaration units + 111 module directives = 3,625 runtime/module units; 994 type/signature units; 4,619 combined custom AST units; 3,726 physical noncomment SLOC**. Package subtotals and exclusions match the JSON. It retains the method's custom nature, type-only module directives, SQL physical-count treatment and testing-store exclusion.

The release/provider/adoption wording remains scoped appropriately: selected complete Foundation adoption with explicit optional deferrals; development-only node-or-bun; real published optional Get Modular APIs; compatible new-provider work with lexical-ID reconciliation limits; separate active-subscription migration; GitHub prerelease rather than npm publication; explicit runtime-security/browser/live-account/deployment admission. The successful checks do not erase those separate limits. The CHANGELOG's candidate label does not assert a published npm version or completed production admission.

## Links and disposition

Projected every local Markdown link in the staged reports to its intended `docs/reviews/sdk-0.2-completion` location. The initial scan found one missing target: `foundation.md` linked its initial audit as `pr-foundation-full-review.md`, a research filename not included in the public directory. Reported this immediately. The owner accepted retargeting the copied link to **`../foundation-profile.md`** and refreshing staging/public manifests while preserving the original research memo. All other staged local link targets resolve under the intended destination.

No code correction or additional test/build/database execution is requested by this audit. Complete the small copied-link correction, refresh the evidence manifest after final contents settle, and retain the already required exact-documentation-head and exact-main-push gates. The data, current-source reuse explanation and reported local/hosted results are suitable for public delivery with the stated limits.
