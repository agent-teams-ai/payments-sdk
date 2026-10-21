# Storage, optional queue and subscription qualification extension

Status: implementation in progress, before merging PR #6.

The owner requested this bounded extension on 2026-10-21 after the original
0.3 candidate passed local and hosted checks. The original evidence remains
historical; the extended candidate must be qualified again at its actual head.
The already approved one-PR GitHub plugin metadata/merge exception continues
to apply. Organization rules and branch protection are not changed.

## Preserved contracts

- Keep four delivery packages and the core-owned, ORM/driver-free `PaymentStore`.
- Keep PostgreSQL 18 durability, custody, recovery, transaction ownership and
  consumer T3 guarantees. A common ORM interface does not qualify another engine.
- Keep the accepted single monthly price, quantity one, no-trial profile and
  separate one-time purchases. Credit accounting and commercial access remain
  independently owned; their fixtures are not a production credit ledger.
- Do not alter accepted ADRs, add another production database/queue, invent a
  broker dual-write protocol or add product quota/spend/expiry rules.

## Implementation

1. Replace generic PostgreSQL API references to `pg.Pool` and `pg.QueryResult`
   with a small adapter-owned connection source, exclusive checkout and rows-only
   result contract. Keep transaction/deadline/unknown-COMMIT policy in one place.
2. Supply the qualified node-postgres connection implementation at the explicit
   `/node-postgres` entry. Borrow a host pool, including an existing Drizzle
   node-postgres pool, without ending it or nesting a host ORM transaction.
   Preserve late-acquisition cleanup, physical checkout destruction, query error
   handling and ordered multi-statement results.
3. Keep Drizzle private. Compile its typed PostgreSQL queries through the public
   driver-free proxy builder and an execution callback that rejects. Actual
   execution remains on the bounded checkout. Do not use private constructors or
   claim that the Drizzle proxy provides SDK transaction semantics.
4. Move the existing pg-boss implementation behind `/pg-boss`; make concrete
   driver/queue dependencies optional peers and explicit host choices. Root
   exports must not load them or require their declarations. Keep the existing
   transactional queue port and durable obligations authoritative.
5. Extend connected official-Paddle-SDK fixture scenarios: multiple adjacent
   monthly renewals and cross-source receipts, old lifecycle delivery, top-ups
   across restrictive subscription states, scheduled cutoff, transient read
   failure/recovery and refund isolation. Publish an explicit coverage matrix.

## Meaningful qualification

- Strict packed NodeNext and Bundler consumers, `skipLibCheck:false`, import the
  generic PostgreSQL entry without pg-boss or node-postgres installed. Inspect
  actual resolver/declaration closure and the production installation, not only
  package metadata.
- A production-only consumer explicitly selecting node-postgres and a different
  durable queue fixture runs connected PostgreSQL scenarios without pg-boss.
  The explicit pg-boss consumer still bootstraps, starts, dispatches and drains.
- Preserve real PostgreSQL acquisition/deadline, failed cleanup, lost COMMIT,
  single-checkout, atomic enqueue, repair and recovery regression evidence.
  A wrapper around node-postgres is not a second qualified driver.
- Paddle expectations remain independent of production reducers and provider
  mapping. Use the real public SDK against synthetic HTTP responses, signed
  webhook bytes, durable storage and independently owned consumer fixtures.
- Run four fresh GPT-6.1-sol xhigh reviews of connection safety, optional-package
  isolation, subscription/credit scenarios and final integration claims. Fix
  material findings, then run complete maintained checks on both admitted Node
  floors and the actual updated hosted PR head.

## Delivery and limits

Update integration examples and owning guides with the explicit composition
change before merge. Record actual source/tree identity, executed checks and
review findings. Recreate changed commits through the authorized GitHub plugin,
verify their trees, inspect fresh owner/head/comments/required CI and verify the
actual merged result and main-push checks.

Another database engine still requires its own `PaymentStore` implementation
and durability qualification. Another PostgreSQL driver must satisfy the checkout
contract and receive equivalent failure tests. A remote broker still requires a
separate durable relay. Live Paddle credentials, active-provider migration,
proration/trial/seat commands and production credit policy are not admitted by
this fixture extension.
