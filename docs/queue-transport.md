# Transactional payment wake-up transports

The PostgreSQL store and work runner depend on infrastructure-owned transport
contracts. `createPgBossPaymentTransport` selects the bundled pg-boss adapter at
host composition. The same store, runner and core can run with a different
transactional PostgreSQL wake-up implementation. Core has no queue or SQL API.

The package root imports and installs no pg-boss. Hosts selecting that adapter
explicitly install `pg-boss@12.38.0` and import its factory/types from
`@agent-teams/payments-postgres/pg-boss`; its peer is optional for other transports.

## Ownership and guarantees

`PaymentJobEnqueuer` receives a work identity and the current bounded
`PaymentSqlTransaction`. It may execute only on that transaction, and cannot
retain the executor, acquire another connection, commit independently or call an
external broker. A failure rolls back the payment records and wake-up together.
The enclosing transaction retains its existing absolute deadline, durable WAL
settings and unknown-COMMIT behavior. Queue success does not establish payment
reduction or consumer acceptance.

The enqueuer declares its payment schema and exact scope. Both store and runner
reject a mismatched namespace. `PaymentJobTransport` adds read-only qualification,
worker/repair callback registration and transport stop. Construction is inert;
bootstrap remains an explicit migration-role action on the selected adapter.
Qualification must validate its existing namespace and durable transport setup,
without silently creating or changing that setup.

Repair queries payment-owned obligations. The transport supplies a trusted,
parameterized PostgreSQL expression that tests whether a work identity already
has a runnable wake-up. Its values use local `$1` through `$n` placeholders; the
runner appends its own LIMIT parameter. The expression receives only the
runner's trusted kind/id SQL expressions, never request text. The runner applies
it before LIMIT and locks candidates with `FOR UPDATE SKIP LOCKED`. This preserves
bounded fair progress when old work is already queued. Returning every candidate
and filtering after LIMIT does not implement this contract.

The bundled adapter owns all pg-boss schemas, job states, JSON payload access,
configuration, scheduler and warning translation. Its enqueue checks for an
equivalent runnable wake-up on the existing transaction while the caller owns
the obligation lock. Terminal jobs do not suppress a repair wake-up. There is no
time-window deduplication that can delay repair after a terminal result.
Pg-boss's cold queue-metadata lookup uses its constructor executor, independently
of `send`'s public `db` option. Admission therefore uses an inert send-only vendor
instance whose constructor and send executors both wrap the supplied transaction.
It is never started and owns no pool or timers. Cold enqueue and startup repair
work with a one-connection host pool; cache state cannot require a second checkout
inside the payment transaction.

The runner owns durable attempts/cooldown/quarantine, claim revisions, dispatch
state rereads, provider processing, delivery target lookup, consumer receipt
validation and producer ACK. It waits for independent consumer T3 before ACK.
Neither a transport retry nor successful queue settlement authorizes an unknown
external mutation. Deleting every transport row leaves payment obligations,
immutable evidence and consumer targets intact.

`start` can admit callbacks before its promise settles. On partial failure the
runner closes admission, stops the transport and preserves the original core
runtime for drain. A stop timeout reports remaining handlers and unresolved
physical provider calls honestly. A rejected transport stop leaves
`transportStopped:false`, permits an explicit cleanup retry and does not prevent
drain from awaiting admitted/core work. The host retains its borrowed pool until all
dependent scopes have actually drained. A transport must not close that pool.

## Migration from the 0.2 composition API

This is an intentional 0.3 composition change. Replace the standalone bootstrap
function with the explicitly selected adapter's bootstrap method. Install
`pg-boss@12.38.0` explicitly and move its factory/type imports to the adapter
subpath:

```ts
import { createPgBossPaymentTransport } from '@agent-teams/payments-postgres/pg-boss';

const transport = createPgBossPaymentTransport(namespace);
// Migration-role setup only, after migratePaymentSchema:
await transport.bootstrap();
```

At runtime, select the adapter explicitly and pass it to the same runner:

```ts
const transport = createPgBossPaymentTransport(namespace);
const jobs = createPostgresPaymentJobs({ ...namespace, transport });
const store = await createPostgresPaymentStore({
  pool,
  schema: namespace.paymentSchema,
  scope,
  queue: jobs.queue,
});
```

`jobs.queue` now exposes only the transactional enqueuer and namespace. The
mutable raw `boss` and queue name are no longer a public runner API. Vendor
administration belongs to the host's explicitly owned infrastructure tooling.
Generic `PaymentJobNamespace` describes the payment owner; `jobSchema` and the
optional warning sink belong to `PgBossPaymentTransportOptions`. The warning
callback now receives a plain `{ message: string }` diagnostic rather than a
vendor `Warning` object. The runner's `onError` still reports payment handler and
cleanup failures independently of the transport's diagnostic sink.
The package entrypoint no longer re-exports pg-boss's declaration augmentation.
Generic worker/store declarations contain no pg-boss or Drizzle types.

Existing payment/pg-boss schemas, namespace binding metadata, job payloads,
obligation state, evidence identities and in-flight work require no data
migration. Keep the same namespaces when upgrading an existing pg-boss
deployment. A different transport requires its own reviewed installation,
namespace qualification and operational handoff; choosing another implementation
does not permit erasing existing bindings, resetting revisions or discarding
in-flight obligations. No automatic live transport migration is supplied.

## Qualification scope

The real pg-boss integration suite continues to exercise the bundled pinned
adapter, runtime grants, concurrent repair, deleted/terminal jobs, logical
retries, namespace rejection and physical shutdown. The alternate SQL wake-up
fixture in `tests/e2e/queue-transport.test.ts` exercises the same store/runner/core
through another implementation, including rollback, restart repair, independent
durable credit T3, lost/mismatched receipts, exact ACK, repair fairness, real
unknown COMMIT and admitted consumer drain. Its deterministic transport pump
does not use sleeps as an outcome oracle. Test source is not a passing-run record;
use the exact-head required checks and their logs for qualification evidence.

This is a PostgreSQL transactional transport boundary. The alternate fixture is
not a production queue engine. A remote broker needs a separate relay and receipt
protocol preserving durable obligations; it cannot claim atomicity by writing
both PostgreSQL and the broker inside `enqueue`. Another database must implement
the core `PaymentStore` guarantees independently. Drizzle's other dialects do
not qualify another durable payment adapter.
