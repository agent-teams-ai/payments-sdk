# SDK 0.3 driver, queue and subscription qualification

## Result and exact source

On **2026-10-21**, clean local source
**`b6fd1a673d9f0d6a160a0938c159c2a0db410419`** passed frozen installation, a
fresh forced build and the complete **`pnpm check`** on Linux Node **24.21.0**
and **26.11.1**. Both runs exited zero, with no tracked source change during
qualification. Each run created a fresh PostgreSQL **18.4** database with
`fsync=on` and `synchronous_commit=on`. The two full runs were serialized; normal
test-file concurrency within each suite remained enabled.

The authorized GitHub plugin recreated that source as
[`d89f3b44d5ce245e6f9959fd22de8a58c20c8ab5`](https://github.com/agent-teams-ai/payments-sdk/commit/d89f3b44d5ce245e6f9959fd22de8a58c20c8ab5).
Its complete Git tree is exactly
**`3ef3eae07e2317d6257051f6adf25cec624836db`**, matching the local source.
Different commit IDs reflect the explicitly approved plugin metadata path;
source trees, full commit messages and ordered parent mappings are verified.
The matching source commit is not a claim that a later documentation commit ran
the same local command.

[PR #6](https://github.com/agent-teams-ai/payments-sdk/pull/6) owns the remote
delivery, exact-head hosted checks, review disposition and final merge receipt.
This evidence is retained before that delivery. A successful source upload or
local run does not itself establish a successful hosted run, merged main,
GitHub prerelease or npm publication. The PR's live state and the exact resulting
main-push **Checks / Required checks** run establish those subsequent outcomes.

The earlier [hardening record](../sdk-0.3-hardening/README.md), including its
historical 403 write restriction and mandatory pg-boss installation, remains a
record of its own subject. This extension implements the owner's later
[driver/queue and subscription scope](../sdk-0.3-hardening/portability-subscription-plan.md).

## Delivered boundaries

- Core's existing `PaymentStore` remains independent of a database engine,
  driver, ORM or queue. There is no new generic repository, EventBus or shared
  transaction owner.
- The PostgreSQL adapter now consumes its own `PaymentPostgresDatabase` and
  exclusive `PaymentPostgresConnection` contracts, with rows-only results.
  Transaction phases, deadlines, durability, rollback and unknown-COMMIT
  handling retain their existing single owner.
- `/node-postgres` supplies `createNodePostgresPaymentDatabase(pool)`. It borrows
  a host-owned pool, including a Drizzle node-postgres pool, and never closes it.
  Only ordinary text-mode/default-parser node-postgres is qualified; custom
  codecs, binary mode and other drivers require their own evidence.
- Private Drizzle uses its public `pg-proxy` builder solely for typed `.toSQL()`
  compilation. Direct execution rejects. No ORM transaction or schema object
  enters the core or generic public storage contracts.
- The generic package root installs and imports neither pg nor pg-boss. The
  selected `/node-postgres` and `/pg-boss` entries own optional peers. All four
  SDK delivery packages remain in place.
- A production-only npm consumer runs the alternate durable SQL queue with the
  same store and runner and no installed pg-boss. Another consumer explicitly
  selects pg-boss and exercises its actual bootstrap, dispatch and drain.
  This does not qualify atomic PostgreSQL/remote-broker dual writes.

The [storage guide](../../storage-portability.md),
[queue contract](../../queue-transport.md) and
[package guide](../../../packages/payments-postgres/README.md) own public setup,
migration and substitution requirements. The accepted ADRs and product scope
were not changed.

## Subscription and purchased-credit scenarios

The new [source-backed matrix](../subscription-credits-e2e-matrix.md) identifies
five connected stories, each through Node HTTP factory and Fetch/static Get
Modular hosts. They run the official Paddle SDK, controlled HTTP responses,
signed raw ingress, real payment PostgreSQL state, independent credit/access T3
fixtures, durable delivery and exact ACK.

They cover three adjacent paid monthly periods; billed/paid versus completed;
API/webhook receipt orders; stale lifecycle and restart; intentional top-ups
while active, past due, externally paused or canceled; pending-to-approved full
refund; original chargeback and matching reversal; payment-method recovery of
the original unpaid recurring transaction; cancellation cutoff before the final
webhook; transient read failure; wrong-buyer denial; and disallowed zero,
incomplete or foreign-account financial evidence.

The independent oracle uses **100 symbolic included units** per supported paid
monthly period and **25 purchased units** per separate top-up. Quantities are
fixture policy, not a price conversion or production pricing decision. A
top-up cannot extend subscription validity or reopen canceled access. Paused
observations remain explicitly unsupported/fail-closed. Production credit
consumption, debt, expiry, rollover, arbitrary overlapping periods and
partial-refund arithmetic retain their separate owners and qualification gates.

## Complete local gates

The following are reported TAP case counts, including parent/subtests. They are
not a claim of that many unique scenarios. The 11 adoption cases also run inside
the 32 boundary/tooling cases; financial scenarios deliberately repeat against
different packed consumers.

| Gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| Frozen install and forced build | Pass | Pass |
| Toolchain, all strict projects, typed lint, complete selected Foundation profile | Pass | Pass |
| Scoped Get Modular adoption | 11/11 | 11/11 |
| Boundary/tooling rejection cases | 32/32 | 32/32 |
| Core | 49/49 | 49/49 |
| Official Paddle SDK adapter | 18/18 | 18/18 |
| Get Modular runtime | 13/13 | 13/13 |
| PostgreSQL integration/fault/recovery | 49/49 | 49/49 |
| Connected E2E | 81/81 | 81/81 |
| Packed Observation | 4/4 | 4/4 |
| Packed custom queue without pg-boss | 4/4 | 4/4 |
| Packed financial oracle plus explicit pg-boss | 2/2 | 2/2 |
| Three npm profiles, strict NodeNext and Bundler | Pass | Pass |
| Packed pnpm consumers, Drizzle admission, release dry-run | Pass | Pass |

Every reported test group had zero failed, cancelled, skipped or todo cases.
The complete-check stages took approximately 156 seconds and 143 seconds in
this local environment. These timings are observations, not a CI latency bound.
The required hosted workflow still builds once, shares package artifacts,
executes quality and two scenario jobs in parallel, and cancels obsolete PR
runs. New package-isolation locks, type graphs and logs are retained as CI
artifacts. No required check, strict flag or boundary rejection was disabled.

Retained metadata and archived raw evidence:

- [Node 24 metadata](local-evidence/24.21.0/full-check-node-24.21.0.json)
  and [complete log](https://github.com/agent-teams-ai/payments-sdk/blob/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b/docs/reviews/sdk-0.3-portability/local-evidence/24.21.0/full-check-node-24.21.0.log).
- [Node 26 metadata](local-evidence/26.11.1/full-check-node-26.11.1.json)
  and [complete log](https://github.com/agent-teams-ai/payments-sdk/blob/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b/docs/reviews/sdk-0.3-portability/local-evidence/26.11.1/full-check-node-26.11.1.log).
- Each directory retains the three production npm profile reports, Observation
  and Drizzle reports, package identities and release dry-run result. Ordinary
  consumer locks, both strict compiler file graphs and raw command logs are
  available through the [immutable evidence archive](../archived-evidence.md).
  Their recorded digests and qualification subjects are unchanged.

The archive hashes in those directories belong to the fully checked `b6fd1a6`
subject. The later recovery/parser documentation correction also changes the
packaged PostgreSQL README, so a subsequently packed archive has a different
whole-archive hash. Runtime, declarations, tests, manifests and gates are
unchanged by that correction. Final-head hosted package qualification owns the
new archive identity; historical archive hashes are not relabeled as final.

## Additional reviews and correction

Four additional **GPT-6.1-sol / xhigh** critics reviewed connection mechanics,
package/install isolation, Paddle/consumer semantics and final integration.
The first three inspected separate fixed scopes; the final integration review
also checked the shared migration and qualification boundaries. Their subjects,
actual probes and limits are retained in the [review record](reviews.md).

Three scoped reviews found no material P0/P1/P2. The integration critic found one
**P2**: the active recovery guide still passed `pool` after the API changed to
`database`. Commit `de82003b8d994136c4693fd84b156d54826f41cb` fixes the public
composition and explicitly records the qualified pool parsing precondition.
The critic extracted the corrected guide's complete first TypeScript block and
strict NodeNext-compiled it against public exports, with
`exactOptionalPropertyTypes:true`, `noUncheckedIndexedAccess:true` and
`skipLibCheck:false`: passed. The finding is resolved, with no remaining material
finding in these review scopes.

These reviews extend the historical completed four implementation review waves;
they do not pretend those older reviewers examined this new snapshot. The Cubic
check on the earlier PR head reported its monthly AI-review line limit, not an
approval. Independent agent reviews and actual required CI remain explicit.

## Production source size

[The reproducible AST report](production-loc.json) uses the same TypeScript 7
method as earlier deliveries and reproduces all counts for 18 unchanged source
files. It counts 29 production `.ts` files, excluding test fixtures, examples,
tooling, generated output and the private vendor declaration correction.

| Measure | Count |
| --- | --- |
| Runtime statement/declaration units | 3,570 |
| Import/export module units | 110 |
| Type declaration/signature units | 1,022 |
| Combined logical AST units | **4,702** |
| Physical noncomment, nonblank source lines | **3,833** |

Core contributes 2,001 combined units, Paddle 538, PostgreSQL 1,981 and Get
Modular 182. Small adapters reuse the official SDK, private Drizzle and Get
Modular mechanisms; line count does not certify completeness or correctness.

## Remaining admission boundaries

The [deployment gates](../../qualification.md#deployment-and-credential-gates)
remain applicable: authorized Paddle sandbox/card/account qualification, actual
host authorization, real commercial/credit policy, physical backup/PITR and any
HA promotion path. The retained Node runtime security and official Paddle.js
strict-declaration gates are unchanged. No live Paddle operation, production
ledger, second production driver/engine/broker, npm publication or production
deployment is established by these fixture results.
