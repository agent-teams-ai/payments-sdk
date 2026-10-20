# SDK 0.2 complete local qualification

## Exact subject and result

On **2026-10-20**, clean source
`fb9baa1d463d5b1ab5760aad72fe3fb1ee361f33` passed the complete `pnpm check`
route on **Linux Node 24.21.0 and Node 26.11.1**, using pnpm 11.25.0,
TypeScript 7.0.2 and PostgreSQL 18.4. Each floor received a frozen install,
fresh forced build and its own fresh disposable database. The two floor runs
were sequential; test files within each group retained the normal Node default
concurrency. All three stages exited zero on each floor, and the source was
clean and unchanged before and after execution.

This is a completed local integration qualification. It is not hosted CI,
publication or a production deployment admission. A later documentation-only
delivery commit records these results without pretending the full suites ran
again at that later SHA. Any code, dependency, build, test or packaging change
requires its own applicable qualification. The final PR still needs exact-head
required CI, and release admission requires successful exact-commit main-push CI.

## Complete gates

| Gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| Frozen install and forced build | Passed | Passed |
| Toolchain, strict types, lint and full configured Foundation checks | Passed | Passed |
| Development-only and registry boundaries | Passed | Passed |
| Boundary/tooling tests | 14/14 | 14/14 |
| Core tests | 48/48 | 48/48 |
| Official Paddle SDK contract tests | 18/18 | 18/18 |
| Static Get Modular tests | 11/11 | 11/11 |
| Real PostgreSQL/integration tests | 45/45 | 45/45 |
| E2E tests | 53/53 | 53/53 |
| Packed published-observation tests | 4/4 | 4/4 |
| Production-only npm financial test | 1/1 | 1/1 |
| Exact Drizzle artifact and strict declaration admission | Passed | Passed |
| Four packed pnpm consumer profiles | Passed | Passed |
| All six packed npm exports, strict NodeNext and Bundler | Passed | Passed |
| Release archive audit/dry run | Passed; `published:false` | Passed; `published:false` |

All reported test blocks have zero failures, cancellations, skips and todos.
Counts follow the Node reporter, which can include parent/subtest nodes. The
packed financial oracle is intentionally exercised through more than one
delivery surface; these rows must not be summed into a claim about distinct
financial scenarios.

The PostgreSQL profile retained `fsync`, `synchronous_commit`, `full_page_writes`
and data checksums enabled. Its disposable database names were
`payments_sdk_02_n24_7dcadf6` and `payments_sdk_02_n26_7dcadf6`; the label suffix
is not the tested revision. The full forty-character source above is the
qualification subject. Neither the 2,500 ms transaction budget nor maximum
page fixtures, fault triggers, expected effects or test concurrency were relaxed.

The maintained reproduction route is:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc -b --force
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/payments_qualification pnpm check
```

Use the selected exact Node floor and a fresh disposable PostgreSQL database
for each run. Registry access is required by artifact and installed-consumer
qualification; actual Paddle requests use the test-only HTTP transport.

## Run and archive identity

| Floor | Frozen-install start (UTC) | Complete-check interval (UTC) | Full transcript SHA-256 |
| --- | --- | --- | --- |
| Node 24.21.0 | 10:31:24 | 10:34:14–10:38:00 | `2e52a7d9297df4573fef925b8af83d92f916491f07a09bf6bdf26538519f4fda` |
| Node 26.11.1 | 10:39:20 | 10:39:23–10:42:20 | `5332a47a664479636f4ef5db0f07de6308c409f74c94c47aa524ae1cbb7114f5` |

The four actual SDK tarballs were byte-identical across floors. Their SHA-256
and sizes match each floor's qualification summary, observation report and npm
consumer report; the independent evidence review also checked the npm lock
integrities and compiled file contents.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `agent-teams-payments-core-0.2.0.tgz` | 63,041 | `5dc08c6fa60a6101074941e1254a76c93bb3dd048c60274c7980cc1a9402dc08` |
| `agent-teams-payments-paddle-0.2.0.tgz` | 25,981 | `ded984618c7eb19e8459dee80024a32c77ad30a01ad5fa50abcc733ca62cd439` |
| `agent-teams-payments-postgres-0.2.0.tgz` | 66,041 | `cd3b156b4479b83ef173e25abeb2f4d8bc57d250c4075bc65f099e739a0a26fe` |
| `agent-teams-payments-get-modular-0.2.0.tgz` | 20,828 | `cb3be4aca685a891cdd4151a75a91da486f91f889fd44b34d44223979867d97f` |

Retained records use `.artifacts/full-check-node-<version>.{json,log}` and
`qualification-summary-node-<version>.json`, alongside the per-floor
`drizzle-admission`, `observation-published`, `packed-consumers`, `packed-npm`
and `release-dry-run` reports. The npm lockfiles, compiler file lists and
scenario logs are retained with them. The reviewed delivery archive preserves
these files and the failed-run history separately from the Git source bundle.
They are local execution evidence with immutable hashes, not remote build
attestations. The [independent evidence review](evidence-review.md) states
exactly what was recomputed and which temporary installations no longer exist.

## What the integrated checks establish

The financial path uses actual public SDK/package APIs, official Paddle Node
SDK behavior with synthetic HTTP responses, and real PostgreSQL. It covers
monthly no-trial quantity-one purchases and independent one-time top-ups,
duplicate/replayed and contradictory evidence, unknown mutation outcomes,
durable delivery, independent consumer receipts/effects, recovery and fault
atomicity. The packed financial oracle finishes with 225 credits, three grants,
zero held credits, two actual SDK mutation dispatches and empty pending work.
Closing the optional read projection does not stop financial delivery.

Published Get Modular Core/Assembly 0.6.0, Resources 0.2.0, development-only
Conformance 0.4.0 and optional Observation 0.1.0 are bound to the official
registry artifacts. The packed `/observation` export uses real Assembly
inputs/slots, scoped Resources, readonly facets, coalesced watches and
latest-only loads. The tests include stale-result invalidation, draining
borrowed reads and closure without disposing the payment runtime or pool.
Observation remains optional and cannot authorize effects or acknowledge
financial delivery.

Drizzle remains private to `payments-postgres`. The exact admitted artifact is
`1.0.0-rc.5-5935859`, the newest published 1.0 preview found in the dated registry
scan. Stable 0.45.4 has a later publication timestamp but belongs to the older
0.x line. The owner's prerelease direction selects the 1.0 line explicitly.

The transparent maintainer-only correction changes fifteen optional properties
in both declaration formats, eight files total. All 1,743 runtime files and
package metadata remain original. Strict TypeScript and negative-contract
checks remain required. The fresh npm consumers use the official **unpatched**
Drizzle artifact; they receive no workspace patch or MySQL development peer.
Their complete public declaration graphs contain no Drizzle/MySQL declarations
under either strict resolver. See the [admission record](../drizzle-admission.md)
for exact provenance and the bounded correction.

## Failures retained and corrections qualified

Earlier full-run failures remain failures of their recorded subjects:

| Source | Original failure | Correction and preserved oracle |
| --- | --- | --- |
| `e008622` | Three obsolete expectations required an empty diagnostics sink after deliberately injected worker faults | Check the exact error, cause, work identity and attempt; preserve cooldown, settlement, redrive, generation and CAS assertions |
| `1eb7a94` | Maximum historical reclassification page reached the transaction deadline before its intended late fault | Reuse prelocked receipts and deduplicate route reads without changing the page or deadline |
| `2f706ea` | The distinct official-SDK 200-member contradictory-event page still reached the same deadline | Bound reads after their owning lock phases, then batch distinct record writes within each input |

The third failure reproduced in the isolated integration file. Read batching
alone also retained a red full PostgreSQL result, 42/44 including the failed
parent. These results were not replaced by successful focused reruns. The final
complete checks above pass both original maximum-page oracles and the new
persisted-data regression with default file concurrency.

The final maximum SDK-page trace records 1,013 statements for the intended
rollback and 1,014 for the complete commit, including 201 record statements,
all 600/601 obligation statements and five lock phases. The original 2,013
statement trace was incomplete when it timed out, so it is not a completed
before measurement. The [performance record](../drizzle-event-page-performance.md)
retains stage-by-stage counts, illustrative timing, raw-trace binding and the
corrected counter identified by independent review. This establishes the
observed fixture profile, not a universal latency or throughput guarantee.

## Review and delivery limits

The [review index](README.md) retains four additional independent integration
reviews, their corrected findings, and two separate custody-performance
reviews. They supplement the completed historical design/implementation waves;
this continuation is not described as another four-wave campaign.

At this local qualification checkpoint, GitHub CLI authentication is unavailable
and the integration's attempted writes return HTTP 403. No SDK 0.2 push, PR,
remote CI, merge, tag, GitHub release or npm publication is established by this
record. Current remote delivery coordinates must be recorded only after those
operations succeed. The source and four audited packages are complete locally.

Live Paddle account behavior, host authorization and accounting policy,
physical backup/PITR and HA promotion remain deployment-specific. The separately
documented [Node bundled-fetch production admission](../../security-qualification.md)
and [Paddle.js browser declaration gate](../../qualification.md#browser-wrapper-admission)
remain open; these functional checks do not clear them. Only Paddle and the
PostgreSQL durable adapter have this complete supported profile. A synthetic
foreign provider validates contract portability, not a second production
provider or another database engine.
