# SDK 0.2 final tooling and delivery qualification

## Result and exact subject

On 2026-10-20, clean source **`d303f2a36774555bd885df63e536b97428c200a0`** passed a frozen installation,
fresh forced build and the **complete `pnpm check`** on Linux Node **24.21.0**
and **26.11.1**. Both final executions exited zero and verified that the source
stayed clean and unchanged. Each run used its own disposable PostgreSQL 18.4
database; the database suites were run sequentially between Node floors, with
normal Node test-file concurrency within each group.

The exact same PR source passed hosted [Checks run 39420493065](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39420493065)
and [CodeQL run 39420489316](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39420489316).
All required build, quality and two scenario jobs, their artifact uploads and
the fail-closed `Required checks` aggregate succeeded. This record belongs to
that source. A subsequent documentation-only recording commit still needs its
own required CI; these executions are not relabeled as another commit's runs.
[PR #5](https://github.com/agent-teams-ai/payments-sdk/pull/5) and the exact
main-push release manifest supply the subsequent remote delivery coordinates.

This supersedes the **current-source** qualification role of the earlier
[SDK 0.2 local report](../sdk-0.2/qualification.md). That report, its package
hashes and failed intermediate subjects remain valid historical evidence.

## Changes qualified by this continuation

- Complete the selected [Engineering Foundation profile](../../foundation-adoption.md):
  shared strict compiler and real type-aware lint presets, direct lifecycle
  commands, strict ownership of all 78 maintained TypeScript files, both
  configured architecture capabilities, registry and development-only checks.
  Explicit optional capability deferrals remain documented.
- Use exact [node-or-bun 0.2.2](../../node-or-bun-adoption.md) for captured
  development commands, with reviewed timeout, stream limits, child-process
  containment and error semantics. This is not Bun or SDK runtime admission.
- Correct runtime boundary types and validation exposed by the shared typed
  preset. Invalid truthy capability flags require actual `true`; present invalid
  consumer completion values retain held custody. The financial assertions,
  mutation uncertainty, transaction budgets and original maximum-page fault
  scenarios remain intact.
- Fix the cold TypeScript build graph with explicit declaration-producer
  dependencies, while retaining consumer `noEmit` and parallel independent CI.
- Preserve private Drizzle, official Paddle SDK custody, and the published
  optional Get Modular Assembly/Resources/Observation integration. Their full
  installed-consumer and financial gates are included below.

## Independent reviews

The reviewers used the owner's requested **GPT-6.1-sol, xhigh** configuration.
The source and evidence scopes are explicit in each memo. These continuation
reviews supplement the earlier four design and four implementation waves;
they are not described as another four-wave campaign.

| Scope | Independent review | Disposition |
| --- | --- | --- |
| Selected Foundation profile and actual typed backend | [Foundation](foundation.md) | Initial two P2 omissions corrected; final scoped review has no P0/P1/P2 |
| Core/Paddle typed validation, custody and mutation invariants | [Core and provider](typed-core-provider.md) | No P0/P1/P2 in the reviewed delta |
| PostgreSQL, independent consumers and GM typed corrections | [Storage and consumers](typed-storage-consumers.md) | No new P0/P1/P2 in the reviewed delta |
| Cold declaration graph, strict ownership and packed config isolation | [Cold build](cold-build-independent.md) | No P0/P1/P2; new actual-backend and consumer witnesses pass |
| Accepted scope, meaningful dependency adoption and source metrics | [Delivery and metrics](delivery-scope.md) | No concrete P0/P1/P2 contradiction; counts independently reproduced |

The final [independent evidence read-back](evidence-readback.md) recomputes
all reported test blocks, transcript/report hashes, the actual package bytes
and installed declaration graphs. Its one relative-link correction is applied
in the published copy; the original memo retains its completion checkpoint.

The core/provider and storage/consumer memos bind to `95e996f`; their inspected
source inputs are unchanged at `d303f2a36774555bd885df63e536b97428c200a0`. The cold-build review independently
binds its exact three-file fix and 212 tracked inputs to the final source.
Read-only review conclusions and coordinator-executed complete suites remain
separate kinds of evidence. The earlier [node-or-bun review](../node-or-bun-independent.md)
and [CI delivery correction](../pr5-delivery-gates.md) retain their own subjects.

The maintained organization quality standard, AGENTS, merge guard and canonical
identity were read through the authorized GitHub CLI at
`a34ecc6bc9bb165771f3962dccd25970dd5c0d98`. The [read-back record](organization-readback.json)
confirms all four are byte-identical to the already inspected applicable rules.
No accepted architecture pin was migrated implicitly.

## Complete local gates

| Gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| Frozen installation and fresh forced build | Passed | Passed |
| Strict toolchain/typecheck, full lint and selected Foundation profile | Passed | Passed |
| Development-only and registry checks | Passed | Passed |
| Boundary and tooling | 21/21 | 21/21 |
| Core | 49/49 | 49/49 |
| Official Paddle SDK contracts | 18/18 | 18/18 |
| Static Get Modular | 11/11 | 11/11 |
| Real PostgreSQL, durability and recovery | 45/45 | 45/45 |
| End-to-end and integration | 53/53 | 53/53 |
| Packed published Observation | 4/4 | 4/4 |
| Production-only npm financial scenario | 1/1 | 1/1 |
| Exact Drizzle artifact and strict positive/rejecting probes | Passed | Passed |
| Packed pnpm profiles and strict NodeNext/Bundler public exports | Passed | Passed |
| Release archive audit/dry run | Passed; published:false | Passed; published:false |

Every reported test block has zero failures, cancellations, skips and todos.
Node counts can include parent/subtest nodes, and some financial scenarios are
exercised through multiple delivery surfaces; these rows are not summed into
an invented count of distinct financial cases. All consumer compiler profiles
retain `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and
`skipLibCheck:false`.

The packed financial oracle uses the actual public SDK and official Paddle Node
SDK with network-disabled synthetic HTTP responses, plus real PostgreSQL and
independent fixture access/credit owners. It finishes with **225 credits, three
grants, zero held credits, two SDK mutation dispatches and empty pending work**.
Observation closure does not stop financial delivery. No live Paddle credentials
or real charges are involved.

Each [local-evidence directory](local-evidence) retains the raw complete
transcript, stage report, summary and installed-consumer/admission reports.
Original review memos also name disposable local probe/source-archive paths.
Those temporary installations and the redundant source archive are not copied
here; the named Git revisions and retained source hash manifests bind the
reviewed inputs. The final complete logs and cold before/after records are
included.

Database names are `payments_sdk_foundation_n24_95e996f` and
`payments_sdk_foundation_n26_d303_final`; their labels are not source identities.

| Node | Complete-check interval, UTC | Full log SHA-256 |
| --- | --- | --- |
| 24.21.0 | 2026-10-20T12:12:25.112398+00:00 to 2026-10-20T12:15:34.113709+00:00 | `9ed8294ee767c99ec392b975b4a84ba48899fec7d979519c81a2f05dda0c8e6b` |
| 26.11.1 | 2026-10-20T12:22:48.340197+00:00 to 2026-10-20T12:25:33.525251+00:00 | `d8f47aef07d82852b7d0145ea27ec39025d74322705f47349d8e4d6b0c546a69` |

The maintained reproduction route is `pnpm install --frozen-lockfile`,
`pnpm exec tsc -b --force`, then `DATABASE_URL=<fresh-disposable-database> pnpm check`
under the selected exact Node floor. Registry access is required for actual
artifact and installed-consumer qualification.

### Failure and interruption history

The original cold hosted build at `95e996f` failed with missing adapter
exports; [run 39419169395](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39419169395)
was not green. The [isolated reproduction](cold-build/report.md) starts from
an exact tracked-source archive and an independent frozen install, with no
`dist` or build-info artifacts. It records 30 TS2307 errors before the fix,
then an ordinary cold `pnpm typecheck` success in 8.819 seconds with only the
three-file repair. The committed patch, hashes and independent routing/probe
review are retained.

An initial local Node26 process lost its execution session after Observation,
while the packed pnpm gate was starting. Its [incomplete record](interrupted-node26/record.json)
and raw transcript are retained; it has no final successful exit claim.
An old `fb9baa1` report discovered beside that transcript is explicitly not
paired with it. The successful Node26 run reported above repeats the complete
route on a new disposable database. Earlier SDK performance and diagnostic
failures remain in their [own historical report](../sdk-0.2/qualification.md#failures-retained-and-corrections-qualified).

## Qualified package bytes

All four final dry-run archives are byte-identical between the two local Node
floors and match their Observation/npm-consumer reports. Hosted release
admission independently audits its own exact successful main-push archives;
the eventual GitHub release manifest is the authority for those published bytes.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `agent-teams-payments-core-0.2.0.tgz` | 64,695 | `ba561224ac290ecdcd66a20d130abea942ff886c4b7a72bf70731878c6c3b889` |
| `agent-teams-payments-get-modular-0.2.0.tgz` | 20,855 | `5c2ed1d2d638c9ac1125bd33fef605ab9efc94e31642be05721fa0f24a3e5d99` |
| `agent-teams-payments-paddle-0.2.0.tgz` | 26,307 | `0d2a32ff2203cda85f8cd3277abff7a9b5656b564f0602d8342475b1418bde25` |
| `agent-teams-payments-postgres-0.2.0.tgz` | 67,244 | `9ed9aabdb723b1b5df61e20cecf3362dd099f871c5236b28d9eaf5f6b11a4f39` |

## Production logical code size

The [independently recomputed JSON](production-loc.json) gives the complete
method, exact TypeScript 7.0.2 parser identity and SHA-256 for every input.
The measure is an explicitly defined AST statement/declaration count, stable
under formatting, not a universal LLOC standard or a complexity score.

| Package | Files | Runtime and module logical units | Type/signature units | Combined AST units | Physical noncomment SLOC |
| --- | ---: | ---: | ---: | ---: | ---: |
| `payments-core` | 7 | 1,366 | 635 | 2,001 | 1,208 |
| `payments-get-modular` | 6 | 119 | 63 | 182 | 271 |
| `payments-paddle` | 5 | 480 | 58 | 538 | 464 |
| `payments-postgres` | 9 | 1,660 | 238 | 1,898 | 1,783 |
| **Total** | **27** | **3,625** | **994** | **4,619** | **3,726** |

Runtime statements/declarations contribute 3,514 units; import/export directives
contribute 111, including type-only directives. Type/signature units include
private and public production contracts. The physical count includes nonblank
SQL embedded in strings; that SQL does not add TypeScript AST statements.

The exported testing memory store (377 AST units / 244 physical lines) and the
declaration-only pg-boss augmentation (27 / 30) are reported separately and
excluded from the production measure. Tests, fixtures, examples, tools,
qualification, generated output and dependencies are excluded. All 29 input
hashes, including those exclusions, were independently checked. Historical
metric totals from an earlier source must not replace these current numbers.

## Replacement and release boundaries

Core owns provider/store contracts; Paddle, PostgreSQL/Drizzle and optional
Get Modular remain outer adapters. A compatible provider for **new purchases**
can be added through its adapter, ingress/reconciliation, catalog mappings and
Host composition, while preserving core, storage and product consumer owners.
Qualification must establish exact money/periods, unknown outcomes, retry and
custody semantics, cancellation, replay and real provider behavior.

Current reconciliation requires increasing lexical string IDs and a cursor
that identifies the final acquired input. A provider with an opaque or
differently ordered cursor can require an explicit reviewed contract evolution;
sorting individual pages does not establish safe cross-page recovery. Existing
subscriptions, payment methods and immutable old-provider history require a
separate migration protocol. The foreign-provider fixture proves a bounded
contract example, not another production provider or a migration toolkit.

The supported commercial profile is a monthly no-trial quantity-one price and
separate one-time top-ups. Broader billing profiles remain the accepted plan's
explicit deferrals. PostgreSQL and durable queue mechanics belong to the optional
adapter; replacing an engine or transport must requalify atomicity, locking,
acknowledgements and recovery rather than merely rename a query dialect.

The configured delivery channel is audited **GitHub prerelease tarballs**,
not npm publication. Production admission remains blocked by the documented
[Node bundled-fetch issue](../../security-qualification.md#node-bundled-transport-scope);
the [Paddle.js strict declaration blocker](../../qualification.md#browser-wrapper-admission)
and real-account/deployment gates are separate. Backend checkout-URL integration
and synthetic E2E qualification are available. Review, green CI, a merge or a
release do not independently clear those external gates.
