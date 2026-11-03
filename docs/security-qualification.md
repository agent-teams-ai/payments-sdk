# Dependency and Node runtime security qualification

**Current successor, 2026-10-21:** the [corrected-runtime qualification](runtime-security-admission.md) verifies newly published official Node 24.22.1/26.12.1 binaries and owns subsequent runtime floors and probe evidence. The [reviewed hosted baselines](qualification.md#reviewed-hosted-baselines) passed; each later revision requires its own CI, and separate account/deployment gates still apply. The dated investigation and qualification below retain their original subjects and results.

Official source and local qualification read-back: **2026-10-19 UTC**. This
change qualifies the exact development-only Undici pin from **7.24.0** to
**7.30.1**, against the combined runtime and documentation baseline
`01b90c7a6a902601c96856424b39f63fb5b9f9f2`.

## Selected official artifact

The [official npm registry](https://registry.npmjs.org/undici) returned
`seven:7.30.1`; enumeration of published stable `7.x` versions also selected
**7.30.1**. Its publication timestamp is **2026-10-15 14:18:31.283 UTC**.
The [version metadata](https://registry.npmjs.org/undici/7.30.1) identifies
[upstream commit `7507102a675b082a71437f0a00681e537875556c`](https://github.com/nodejs/undici/commit/7507102a675b082a71437f0a00681e537875556c).
The downloaded [official archive](https://registry.npmjs.org/undici/-/undici-7.30.1.tgz)
matched the registry SHA-512 integrity recorded in the lockfile; its SHA-256 is
`c98bd3881137c11341e8be8d2ec509ebf973b6f8b36d0a4c6d2afcda15e0d712`.
Its actual package manifest has **no runtime dependencies** and retains
`engines.node: >=20.18.1`, compatible with both qualified Linux Node floors.

The repository's initial Dependabot read-back contained **16 open alerts**, all
for development-scoped `undici` in `pnpm-lock.yaml` (3 high, 8 medium, 5 low).
Each official advisory's patched `7.x` version was compared locally with
**7.30.1**:

| Patched `7.x` floor | Official advisories from the initial alert set |
| --- | --- |
| 7.28.0 | [GHSA-g8m3-5g58-fq7m](https://github.com/nodejs/undici/security/advisories/GHSA-g8m3-5g58-fq7m), [GHSA-p88m-4jfj-68fv](https://github.com/nodejs/undici/security/advisories/GHSA-p88m-4jfj-68fv), [GHSA-hm92-r4w5-c3mj](https://github.com/nodejs/undici/security/advisories/GHSA-hm92-r4w5-c3mj), [GHSA-35p6-xmwp-9g52](https://github.com/nodejs/undici/security/advisories/GHSA-35p6-xmwp-9g52), [GHSA-vmh5-mc38-953g](https://github.com/nodejs/undici/security/advisories/GHSA-vmh5-mc38-953g), [GHSA-pr7r-676h-xcf6](https://github.com/nodejs/undici/security/advisories/GHSA-pr7r-676h-xcf6) |
| 7.29.0 | [GHSA-m8rv-5g2x-5cg5](https://github.com/nodejs/undici/security/advisories/GHSA-m8rv-5g2x-5cg5), [GHSA-jr45-8vmc-qm54](https://github.com/nodejs/undici/security/advisories/GHSA-jr45-8vmc-qm54), [GHSA-v3r7-h72x-cjcm](https://github.com/nodejs/undici/security/advisories/GHSA-v3r7-h72x-cjcm), [GHSA-8xcm-r25x-g524](https://github.com/nodejs/undici/security/advisories/GHSA-8xcm-r25x-g524), [GHSA-4cwx-7wf7-3272](https://github.com/nodejs/undici/security/advisories/GHSA-4cwx-7wf7-3272) |
| 7.29.1 | [GHSA-pmjh-fq2x-6v4x](https://github.com/nodejs/undici/security/advisories/GHSA-pmjh-fq2x-6v4x), [GHSA-r53p-7pc4-xj5r](https://github.com/nodejs/undici/security/advisories/GHSA-r53p-7pc4-xj5r), [GHSA-2jfj-6hjv-fm6j](https://github.com/nodejs/undici/security/advisories/GHSA-2jfj-6hjv-fm6j), [GHSA-2gqq-gqf2-x968](https://github.com/nodejs/undici/security/advisories/GHSA-2gqq-gqf2-x968), [GHSA-8436-99hf-9mmv](https://github.com/nodejs/undici/security/advisories/GHSA-8436-99hf-9mmv) |

The [7.30.1 release](https://github.com/nodejs/undici/releases/tag/v7.30.1)
also incorporates subsequent security fixes. In particular, the official
[TLS renegotiation denial-of-service advisory GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm)
and [dropped TLS options advisory GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx),
both published **2026-10-15**, specify affected `7.x` versions
`>=7.0.0, <7.30.1` and patched version **7.30.1**. Therefore **7.29.1** alone
does not satisfy those later advisory ranges. This comparison identifies fixed
versions; it does not assert that every described exploit is reachable in this
workspace's test harness.

## Dependency and transport scope

Only the catalog's exact Undici pin and its lockfile catalog/importer,
package/integrity and snapshot entries changed. Normalizing the new lockfile's
Undici version and integrity back to their previous values produced the
byte-identical baseline lockfile. Every other pin, package engine and
Engineering Foundation **1.10.1** identity is unchanged.

Undici is declared in the root workspace and Paddle package
`devDependencies`. Its imports occur only in the Paddle SDK contract tests,
reconciliation integration tests and two end-to-end test files. None of the four
published runtime packages declares or imports it. A local traversal of each
package's runtime dependencies, optional dependency edges and required Get
Modular peers produced the same closure before and after this change, with no
`undici` package in any closure. The separate `undici-types` declaration package
under `@types/node` retains its existing version.

The actual **7.24.0** and **7.30.1** archives have byte-identical `MockAgent`
and global dispatcher declarations, and the same `install()` implementation.
The existing isolated test processes continue to use these official public APIs;
production transport source is unchanged. The SDK contract gate verifies that
an unmatched Paddle path and an unapproved origin both fail with
`UND_MOCK_ERR_MOCK_NOT_MATCHED` while mock network connections are disabled.
The harness restores its saved global descriptors and dispatcher during cleanup.

## Node bundled transport scope

**Production runtime security admission is blocked at the 2026-10-19
read-back.** GitHub prerelease delivery supports integration and fixture
evaluation; that label does not mitigate the runtime defect. The dated npm
audits below cover the npm dependency graph. Production Paddle SDK calls use
the host Node global `fetch`, which the development-only **7.30.1** package
does not update.

The independent [runtime investigation](reviews/node-runtime-security-research.md)
checked the current floors and latest official same-major releases:

| Official Linux runtime | Role at the read-back | Actual bundled Undici | Bounded global-fetch probe |
| --- | --- | --- | --- |
| Node 24.21.0 | Functional CI floor | 7.29.1 | Process terminates after caught rejection |
| Node 24.22.0 | Latest published Node 24 | 7.29.1 | Same failure |
| Node 26.11.1 | Functional CI floor | 8.11.2 | Same failure |
| Node 26.12.0 | Latest published Node 26 | 8.11.2 | Same failure |

The latest archives match the official SHA-256 manifests. Exact Node-tag fetch
sources are byte identical to the corresponding affected Undici tags; the
relevant backport is absent. A bounded loopback-only malformed-response probe
reproduces [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c):
the initial fetch rejection is caught, but an internal unhandled stream error
subsequently terminates each process. The patched npm Undici **7.30.1** fetch
comparison exits successfully on the same four binaries. This establishes
actual runtime behavior beyond matching advisory version ranges.

The trigger requires the affected malformed response to reach built-in fetch.
The inspected adapter selects the official HTTPS Paddle production or sandbox
origin; it exposes no caller-supplied API origin. No live Paddle compromise,
malicious Paddle response, redirect behavior or account exploit was
demonstrated, and this probe is not an inbound webhook attack. The SDK's public
options offer no per-instance fetch/dispatcher/decompression control. Catching
its rejected promise does not contain the independently emitted stream error.
The separate [TLS 1.2 renegotiation advisory](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm)
also has a conditional relevant HTTPS path with the implicated assertions still
present; that attack was not reproduced. The runtime report assesses all eight
October 15 advisories and their distinct applicability prerequisites.

The SDK, PostgreSQL reconciliation and E2E harnesses install the patched
development fetch in isolated test processes. Their passing synthetic response
scenarios qualify SDK/application behavior through that test transport; they
do not qualify an unmodified production built-in fetch. No production global
patch, private SDK seam or substitute raw API client is supplied as a repair.

The [official Node announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
schedules security releases on or shortly after **October 21**. At this
read-back it names no corrected version or advisory mapping. Neither that
announcement nor the latest uncorrected binaries establish a repair. Node's
[production guidance](https://nodejs.org/en/about/previous-releases) favors LTS;
Node 26 is still Current at this snapshot.

Before clearing production runtime admission:

1. Select a published official runtime for each retained support line and
   verify its archive checksum, exact bundled source/backports and relevant
   advisory fixes. Prefer the supported LTS line for production.
2. Re-run the bounded probe against its unmodified global fetch and require
   normal process completion. Assess the other relevant transport advisories;
   this one probe is not a complete security certification.
3. Update exact CI versions and compatibility floors from that evidence, then
   pass meaningful actual-SDK, real-PostgreSQL, E2E and strict packed-consumer
   qualification on those runtimes.
4. Record the reviewed correction and successful exact-commit CI, and update
   the public deployment/release status. Complete the separate
   [account and deployment gates](qualification.md#deployment-and-credential-gates).

## Actual consumer qualification

Both runs used **pnpm 11.25.0**, **TypeScript 7.0.2**, installed official
**Paddle Node SDK 3.10.0**, and real **PostgreSQL 18.4** with `fsync=on` and
`synchronous_commit=on`. Each used the authorized disposable local database and
the test suites' isolated schemas. `pnpm install --frozen-lockfile --ignore-scripts`
and the complete `pnpm check` ran under each exact Linux Node version:

| Actual gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| Frozen install | passed | passed |
| Toolchain, strict typecheck and lint | passed | passed |
| Foundation architecture, development-only and registry assertions | passed | passed |
| Boundary and archive checks | 14 passed | 14 passed |
| Core scenarios | 48 passed | 48 passed |
| Actual SDK contract tests | 18 passed | 18 passed |
| Get Modular scenarios | 11 passed | 11 passed |
| PostgreSQL and reconciliation scenarios | 39 passed, including 12 reconciliation tests | 39 passed, including 12 reconciliation tests |
| End-to-end scenarios | 52 passed | 52 passed |
| Strict packed consumers | all 4 profiles passed | all 4 profiles passed |
| Release dry run | all 4 packages passed; unpublished | all 4 packages passed; unpublished |

There were zero failures, cancellations or skips. Packed consumers exercised
NodeNext and Bundler resolution with `strict:true` and `skipLibCheck:false`,
runtime imports and the single physical Get Modular Resources identity.
The [retained execution summary](reviews/development-security-qualification-results.json)
records the exact counts, audit results and source log hashes. The
[independent dependency review](reviews/security-dependency-review.md) records
its own bounded reruns separately.
The SDK, reconciliation and end-to-end scenarios use synthetic provider
responses through the actual SDK's serializers, public resources, entity
constructors and signature verifier. They do not qualify live Paddle account
behavior, checkout collection or real payments.

## Dated advisory scans

On **2026-10-19**, the actual commands
`pnpm audit --prod --registry=https://registry.npmjs.org --json` and
`pnpm audit --registry=https://registry.npmjs.org --json` both exited **0**.
The production report covered **28 total dependencies**; the full report covered
**138 total dependencies**. Both returned an empty `advisories` object and zero
info, low, moderate, high and critical vulnerabilities. These are dated results
from that advisory service, separate from the direct upstream advisory and
archive checks above. They do not assert absence of undisclosed vulnerabilities.
No network-dependent audit gate was added to CI; GitHub's existing Dependabot
monitoring remains active, and its post-merge alert state requires its own
read-back.

The [independent release-admission review](reviews/prerelease-security-admission-review.md)
accepts functional GitHub prerelease delivery with this visible runtime blocker;
it does not clear production admission. The exact selected main commit still
requires its own successful Checks run and audited artifact read-back.
