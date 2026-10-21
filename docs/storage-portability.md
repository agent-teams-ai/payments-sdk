# Storage, driver and queue choices

The SDK's database-independent contract is `PaymentStore` in `payments-core`.
`payments-postgres` implements that contract for PostgreSQL. Drizzle stays inside
that implementation; applications can use a different ORM for their own data.

## Four separate choices

| Choice | Boundary | What replacing it requires |
| --- | --- | --- |
| Database engine | Core `PaymentStore` | Another storage adapter with equivalent atomic custody, concurrency, durable commit, recovery and evidence-delivery qualification |
| PostgreSQL connection driver | `PaymentPostgresDatabase` and its exclusive checkout | An adapter that preserves the documented physical connection, parsing, deadline and cleanup behavior |
| Query/schema toolkit | Private Drizzle implementation | Adapter-local work and qualification; no ORM transaction or schema object enters core |
| PostgreSQL wake-up queue | `PaymentJobTransport` | A same-transaction enqueue/repair/worker implementation; the generic store and runner stay unchanged |

These boundaries protect different guarantees. A driver change does not port
PostgreSQL advisory locks, JSONB, WAL, logged relations, session settings or
`FOR UPDATE SKIP LOCKED` to another database. A queue change does not establish
atomicity between a database commit and an external broker publication.

## Explicit infrastructure imports

The generic `@agent-teams/payments-postgres` entry exports the store, recovery,
migrations, runner and adapter-owned contracts. Concrete implementations have
their own entries:

```ts
import {
  createPostgresPaymentStore,
  migratePaymentSchema,
} from '@agent-teams/payments-postgres';
import { createNodePostgresPaymentDatabase } from
  '@agent-teams/payments-postgres/node-postgres';
import { createPgBossPaymentTransport } from
  '@agent-teams/payments-postgres/pg-boss';
```

Import `/pg-boss` and install its peer only when selecting that implementation.
Custom queue users do not need it. The `/node-postgres` entry likewise belongs to
hosts selecting `pg`; TypeScript hosts supply its corresponding `@types/pg`.
The package's private Drizzle dependency does not make an ORM object part of the
SDK's public storage or queue contracts.

Packed consumer qualification checks actual installation and runtime/declaration
resolution for these choices. An optional peer declaration alone is insufficient
evidence that a root import works without that dependency.

## Reuse an existing Drizzle pool

For Drizzle's node-postgres integration backed by a pool, reuse the existing pool:

```ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  createPostgresPaymentStore,
  migratePaymentSchema,
} from '@agent-teams/payments-postgres';
import { createNodePostgresPaymentDatabase } from
  '@agent-teams/payments-postgres/node-postgres';

const pool = new Pool({ connectionString });
const applicationDatabase = drizzle({ client: pool });
const paymentDatabase = createNodePostgresPaymentDatabase(
  applicationDatabase.$client,
);

await migratePaymentSchema({ database: paymentDatabase, schema, scope });
const store = await createPostgresPaymentStore({
  database: paymentDatabase,
  schema,
  scope,
});
```

`connectionString`, `schema` and `scope` are trusted host configuration. Bootstrap
uses the appropriate migration role; normal application startup follows the
existing [operations guide](operations.md). The host owns the pool's lifetime.
Payments borrows an exclusive connection for each bounded operation and never
ends that pool. Close worker admission and await physical runtime/consumer drain
before the host closes the pool.

The same pool can back independently owned application repositories. Do not pass
an already-open application ORM transaction into payments or join payment T1/T2
with a credit/access owner's T3. Independent owners retain independent commits.

The example specifically requires a `pg.Pool`. Drizzle backed by a single client,
postgres.js or an HTTP driver has a different connection capability. A common
`transaction()` method or a `$client` property does not establish substitutability.

The supplied node-postgres adapter is qualified with ordinary text-mode pools and
default result parsers: `int8` remains exact decimal text, while JSON/JSONB is
decoded to ordinary JavaScript values. It preserves the borrowed pool's decoding
configuration; it does not override global, pool or client parsers. Pools using
`binary: true`, `parseInt8: true` or custom codecs are outside this qualification
unless separately demonstrated to preserve the connection contract. In
particular, a host parser that converts arbitrary `int8` values to JavaScript
`number` can lose precision before the store sees the result.

## Why the driver contract owns a checkout

The adapter needs a same-session parameterized query capability plus explicit
return and destruction of one checkout. It also requires exact bigint revision
decoding, JSONB values and ordered rows from multi-statement scripts. The existing
database transaction owner retains acquisition deadlines, late-checkout cleanup,
the absolute operation deadline, PostgreSQL durability settings and unknown-COMMIT
classification. A driver supplies connection mechanics rather than another copy
of these policies.

In particular, a timeout must physically terminate the affected checkout. Merely
abandoning a query promise can leave a live transaction behind. A lost COMMIT
reply remains unknown even when the server committed; it cannot authorize a
second external payment mutation. Node-postgres is the supplied qualified driver.
A custom implementation must prove the same guarantees before production use.

Drizzle's documented transaction options are dialect-specific, and its supported
drivers have different capabilities. The private PostgreSQL builder uses its
public proxy factory for `.toSQL()` compilation only. Its execution callback
rejects; actual SQL always runs through the owned bounded checkout. This does not
claim Drizzle proxy transactions or HTTP-driver compatibility.

## Queue replacement

Choose the bundled `/pg-boss` implementation explicitly, or provide a
`PaymentJobTransport` satisfying [the queue contract](queue-transport.md). Both
routes use the same payment records, durable obligations, repair, runner, claim
revisions and consumer acknowledgements. The custom-queue packed consumer proves
this without installing pg-boss.

The present transport contract is PostgreSQL-local: enqueue participates in the
payment transaction, and repair tests pending wake-ups before its bounded batch.
Kafka, RabbitMQ, NATS or another remote broker requires a durable relay/outbox
protocol. Calling a broker from `enqueue()` is an invalid dual write. Live queue
migration also requires explicit handling of existing bindings and in-flight work.

## Primary references

- [Drizzle PostgreSQL drivers and existing clients](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle transaction capabilities](https://orm.drizzle.team/docs/transactions)
- [Drizzle query compilation](https://orm.drizzle.team/docs/goodies)
- [node-postgres same-client transaction requirement](https://node-postgres.com/features/transactions)
- [node-postgres pool return, destruction and lifetime](https://node-postgres.com/apis/pool)

Package entrypoints and supported versions are defined by the manifests and
owning qualification record. This guide does not admit another engine or driver
based only on TypeScript assignability.
