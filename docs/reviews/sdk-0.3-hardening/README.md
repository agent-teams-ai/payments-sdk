# SDK 0.3 queue portability and custody qualification

## Result and exact subject

On 2026-10-21, clean source **`16a6a5038383e54d3c740adcf87487e113498847`**
passed a frozen installation, fresh forced build and the complete **`pnpm check`**
on Linux Node **24.21.0** and **26.11.1**. Both executions exited zero and verified
that their source commit, tree and tracked inputs remained unchanged. Each used
its own fresh PostgreSQL **18.4** database with `fsync=on` and
`synchronous_commit=on`. Database-backed qualification was serialized between
the two floors; ordinary Node test-file concurrency remained enabled.

The [plan](plan.md) follows released main
`58441742d2f3743e4681f4bb02b2ff013023d652`. The local branch is
`feat/sdk-queue-portability-0.3`. All four package versions are **0.3.0** for the
deliberate pre-1.0 composition break. Later commits retaining this report and
its evidence are documentation-only; these runs are not relabeled as executions
of those later commits.

**Remote delivery is blocked.** The GitHub connector identifies `777genius`,
but creating the requested branch returned HTTP 403, `Resource not accessible
by integration`. Local `gh` authorization is absent. The [access record](remote-access.json)
does not claim a push, new PR, hosted CI, merge, npm publication or release.
The ready [PR description](pull-request.md) and canonical local commits preserve
the work for the authorized write path. The existing owner identity and fresh
merge guard remain required; local green checks do not replace them.

## Changes and guarantees

- The PostgreSQL store receives a namespace-bound `PaymentJobEnqueuer`; the
  existing worker requires an explicit `PaymentJobTransport`. Generic store and
  runner code contain no pg-boss import, client or job-schema query. The bundled
  `createPgBossPaymentTransport` owns its vendor protocol and explicit bootstrap.
- The same-transaction enqueue contract, pre-LIMIT runnable-work exclusion,
  obligation locks, claim revisions, cooldown/quarantine, immutable evidence,
  independent consumer T3 and exact producer ACK remain intact. Another durable
  SQL fixture exercises the same store and runner without pg-boss.
- Cold vendor metadata lookup now uses the supplied bounded transaction, just
  like its INSERT. A real one-connection pool regression covers admission before
  worker start and repair of previously unqueued work. Retained terminal jobs no
  longer suppress their replacement wake-up through time-window deduplication.
- A failed transport stop remains visible, permits an explicit retry and does
  not abandon admitted physical work. Dependent Observation scopes are closed
  in stages before their borrowed runtime/pool can be released.
- Real official-SDK Paddle fixture scenarios cover permanent response loss,
  exact signed bytes, custody failure/redelivery, independent consumer receipts,
  unresolved mutation fencing and audited recovery under both host compositions.
- The scoped Get Modular profile reuses Foundation's actual source inventory
  and TypeScript 7's public AST. It checks direct authored boundaries, exact
  artifact/authority pins, owned layout exceptions and selected command bodies
  and chains. It does not claim full semantic CMS or application-wide FMS.

See [queue contracts and migration](../../queue-transport.md),
[Modular adoption](../../get-modular-adoption.md),
[growth assessment](../../get-modular-growth.md) and the
[changelog](../../../CHANGELOG.md). Core contracts, payment schemas, durable
identities and existing namespace bindings were not migrated.

## Independent reviews

All five independent reviewers used the owner's requested **GPT-6.1-sol,
xhigh** configuration. Four reviewed distinct implementation surfaces; the
fifth checked metrics and portability claims. They supplement the preserved
historical review waves and do not constitute a newly invented four-wave campaign.

| Scope | Review | Disposition |
| --- | --- | --- |
| Queue contract, transaction ownership and lifecycle | [Queue](review-queue-contract.md) | P2 cold metadata extra checkout fixed; independent reread closes it; no remaining material finding |
| GM scoped gate, ownership, diagnostics and growth claims | [Modular](review-modular-adoption.md) | P2 no-op runtime/packed script replacement fixed and independently reread; no remaining material finding |
| Official SDK custody and independent financial oracles | [Paddle](review-paddle-custody.md) | No P0/P1/P2 in reviewed scope; scenario limits retained below |
| Public declarations, package consumers, migration and CI | [Public delivery](review-public-delivery.md) | No blocking finding; P3 alternate-transport gate attribution corrected |
| LOC and provider/storage/queue portability claims | [Claims](review-claims.md) | Counts and source hashes checked; preliminary metric commit label replaced with exact-subject regeneration |

Each memo binds its actual reviewed source or file hashes. The queue implementation
was integrated without modification from `ee1b494`; its independent review names
that author branch commit. The GM gate fix was integrated without modification
from `e222689`. Read-only review and coordinator-executed qualification remain
separate evidence.

The final [independent evidence readback](evidence-readback.md) checks both raw
logs, result counts and hashes, actual package bytes, installed-consumer records,
reviewed source identities and relative file links. It found no material evidence
mismatch and did not run additional implementation tests.

## Complete local checks

| Gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| Frozen install and fresh forced build | Passed | Passed |
| Strict source ownership, typecheck and typed lint | Passed; 85 maintained `.ts` sources | Passed; 85 maintained `.ts` sources |
| Selected Foundation profile, dev-only and registry checks | Passed | Passed |
| Scoped GM adoption | 11/11 | 11/11 |
| Boundary/tooling suite, including the same adoption tests | 32/32 | 32/32 |
| Core | 49/49 | 49/49 |
| Official Paddle SDK contracts | 18/18 | 18/18 |
| Get Modular | 13/13 | 13/13 |
| Real PostgreSQL, durability and recovery | 47/47 | 47/47 |
| Connected E2E | 66/66 | 66/66 |
| Packed published Observation | 4/4 | 4/4 |
| Production-only npm financial scenario | 1/1 | 1/1 |
| Exact Drizzle artifact and strict rejecting probes | Passed | Passed |
| Packed pnpm/npm NodeNext and Bundler consumers | Passed | Passed |
| Release dry run | Passed; `published:false` | Passed; `published:false` |

Every reported block has zero failures, cancellations, skips and todos. Node
counts include parent/subtest nodes; the adoption tests run twice through the
fast and boundary gates. These rows are not summed into an invented unique
scenario total. Compiler consumers retain `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `skipLibCheck:false`.

Raw complete logs, stage reports, archive identities, summaries and installed
consumer evidence are in [Node 24](local-evidence/24.21.0) and
[Node 26](local-evidence/26.11.1). All four packed archives are byte-identical
across the floors:

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `agent-teams-payments-core-0.3.0.tgz` | 64,696 | `06a962cae231f01f844d3682f3f914f92633916e806224e224810b3a8663dcfe` |
| `agent-teams-payments-paddle-0.3.0.tgz` | 26,309 | `431c6970df5dfd118d08f1caf89c67168d297fec036641f3832230f0b2db4ab5` |
| `agent-teams-payments-postgres-0.3.0.tgz` | 70,294 | `139242de20cf4cd1c97db7066a0d8ca56cc35eb88228168292c9b9b575b960b9` |
| `agent-teams-payments-get-modular-0.3.0.tgz` | 21,523 | `fdb0fff53a5134c5cf979502f4d92e91b19dcf651ddfccb0aa7da15c156eac12` |

Reproduce with the selected exact Node floor, `pnpm install --frozen-lockfile`,
`pnpm exec tsc -b --force`, then `DATABASE_URL=<fresh-disposable-database> pnpm check`.
This environment additionally needs `NODE_USE_ENV_PROXY=1` to use its existing
network proxy for official registry requests. The original URLs, package
versions and integrity checks are unchanged.

### Preserved failed attempt

The first full Node 24 run on `28ab088` passed through E2E, then failed with
`EAI_AGAIN registry.npmjs.org` while fetching published Observation artifacts.
Its [incomplete evidence](local-evidence/interrupted-registry-node24) remains
recorded as exit 1. It does not qualify packaging or the later gate fix.
The complete successful runs above use the reviewed `16a6a503` subject and fresh
databases. Enabling the environment's configured proxy resolved registry access;
no SDK transport or assertion was replaced to obtain a pass.

## What the additional Paddle E2E establishes

Three families execute under the Node HTTP plain-factory and Fetch static-GM
compositions. This is six family executions and nine Node parent/subtest nodes:

1. A provider commits checkout but its response is permanently lost. Service
   reconstruction, retry and repair do not issue another mutation. Independent
   evidence plus audited CAS binding permits the retained signed completion to
   produce exactly one fixture grant and access decision.
2. The exact signed webhook body retains whitespace and Unicode bytes.
   Reserialization with the old signature is rejected without custody. An inbox
   write trigger fails T1 admission; redelivery succeeds without duplicate
   consumer effects. A lost receipt after durable credit T3 does not acknowledge
   access, and independent notification receipt identity does not create a new fact.
3. The provider commits immediate cancellation but its response is lost.
   Read-only refresh and signed lifecycle evidence restrict access while the
   mutation remains unresolved. A new key cannot bypass that lane, historical
   payment replay cannot reopen access, and audited binding releases the lane.

Cancellation uses the public runtime API under each host composition; the
example HTTP handler has no cancellation route. Restart reconstructs services
against the same durable database, not an OS/database crash. The inbox trigger
fires before enqueue and COMMIT; its case is not a lost-COMMIT proof. Existing
durability tests and the alternate transport's real connection-loss probe cover
unknown COMMIT separately. The competing cancellation remains prepared after
audited lane release; no claim is made that an admitted command can never dispatch
once its original uncertainty is resolved.

No live provider credentials, real payments, physical PITR, HA RPO0 or production
commercial/credit policy is established by these fixtures.

## Integration assessment and portability limits

The scoped engineering judgment remains **7/10 integration convenience** and
**8/10 architectural direction**. The growth assessment explains the actual
entry/group admission bounds, exact capability revision coordination, physical
peer identity, sequential factory startup, diagnostics and staged Host cleanup.
Published Resources 0.2.0 still lacks the inspected upstream abort-reentry repair.
Normal payment shutdown was not shown broken by that counterexample; the fixed
upstream source is not represented as an installed release.

Core's `PaymentStore` is free of PostgreSQL and Drizzle. The supplied adapter
relies on PostgreSQL's concrete transaction, locking, JSONB and recovery behavior.
Changing a Drizzle dialect does not establish another durable store. Similarly,
the new queue seam is a same-transaction PostgreSQL transport contract; a remote
broker requires a durable relay/outbox protocol that is not supplied here.
The PostgreSQL package still installs its bundled pg-boss implementation even
when a host selects a different qualified transport.

A compatible provider adapter can serve new purchases without introducing its
SDK into core. Active subscriptions and payment methods require a separate
migration decision. Current reconciliation also has lexical string-ID/cursor
semantics; arbitrary provider cursor protocols are not qualified by the existing
foreign-provider fixture.

Existing [production qualification restrictions](../../qualification.md) remain
in force, including runtime security admission and the strict browser-wrapper
declaration blocker. Green fixture checks are not a production deployment approval.

## Production code size

The exact-subject [machine-readable metric](production-loc.json) reuses the
explicit historical TypeScript 7 AST method and records every source hash.
Twenty-two unchanged production files reproduce all six previous count fields.

| Package | Production files | Runtime + module logical units | Type/signature units | Combined |
| --- | ---: | ---: | ---: | ---: |
| Core | 7 | 1,366 | 635 | 2,001 |
| PostgreSQL | 10 | 1,692 | 259 | 1,951 |
| Paddle | 5 | 480 | 58 | 538 |
| Get Modular | 6 | 119 | 63 | 182 |
| **Total** | **28** | **3,657** | **1,015** | **4,672** |

The runtime subtotal is 3,542 and module directives add 115. Type-only
imports/exports are among those directives; 3,657 is not a literal emitted-JS
statement count. Physical noncomment source is **3,797 lines**, including
nonblank embedded SQL/template lines. Embedded SQL contributes no extra
TypeScript AST nodes.

Dependencies, generated output, tools, examples, tests, qualification code and
the exported testing-only memory store are excluded. The declaration-only
pg-boss correction is separately reported and excluded from production logic.
This is a payment integration SDK with deliberately limited commercial scope,
not a reimplementation of Paddle, PostgreSQL, an ORM, GM or a production credit
ledger. LOC is neither a complexity metric nor evidence of correctness.
