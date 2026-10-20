# PostgreSQL payments adapter

`@agent-teams/payments-postgres` owns durable payment records and uses the pinned
`pg-boss@12.38.0` as a disposable transport. The host owns one `pg.Pool`. Neither the
store nor the transport opens a hidden pool or calls `pool.end()`.

## Typed SQL and dependency admission

The adapter uses private Drizzle schema bindings and typed PostgreSQL query
builders for record reads, conditional record upserts, membership guards,
obligation transitions, configuration updates and bounded keyset scans. The
connection-free `drizzle.mock()` API only compiles statements with `toSQL()`;
the existing checked-out `pg` transaction executes them. Drizzle does not own
transactions, connections, migrations or the pg-boss transport. Ordered advisory
locks, PostgreSQL-specific JSON operations and repair locking retain explicit SQL.
No Drizzle schema, inferred record, query or transaction type is part of the public
SDK contract. Revision columns retain pg's exact int8 text representation until
the adapter checks the supported integer range. Writes distinguish JSON `null`
from SQL `NULL`, and equal jsonb bodies preserve both revision and update time.

The physical `schemaVersion: 1` and explicit bootstrap DDL are unchanged. Existing
databases need no ORM migration metadata or baseline rewrite. `migrations.ts`
remains the authoritative DDL; the runtime bindings describe its columns and keys.

The exact dependency is the official `drizzle-orm@1.0.0-rc.5-5935859` preview;
it is explicitly a prerelease snapshot. The official stable `0.45.4` and earlier
`1.0.0-rc.4` artifacts fail the required TypeScript `7.0.2` declaration profile.
The selected preview requires a narrow maintainer declaration correction: fifteen
optional policy/role config fields explicitly admit `undefined`, matching their
existing runtime classes. The eight ESM/CJS declaration files are the only changed
package bytes. `tools/qualify-drizzle.ts` verifies the original archive SRI,
the exact correction, every unchanged runtime file and strict positive/negative
type probes. It keeps `skipLibCheck:false`, `exactOptionalPropertyTypes:true` and
the rest of the inherited compiler profile. The [admission record](../../docs/reviews/drizzle-admission.md)
owns the provenance, maintenance scope and validation limits.

Drizzle's cross-dialect declaration closure also requires `mysql2@3.24.6` for
maintainer compilation. That driver is a development dependency only. The public
SDK declaration graph does not expose Drizzle internals, and ordinary npm
consumers use the official unpatched Drizzle runtime without inheriting the
workspace's pnpm patch. Packed consumer qualification verifies that boundary.

## Bootstrap and runtime are separate operations

Run bootstrap explicitly with a migration role before starting application traffic:

```ts
import { migratePaymentSchema, bootstrapPostgresPaymentJobs } from '@agent-teams/payments-postgres';

const namespace = {
  pool,
  paymentSchema: 'payments_application_a',
  jobSchema: 'payment_jobs_application_a',
  scope,
  onError: (error: Error) => logger.error(error),
};
await migratePaymentSchema({ pool, schema: namespace.paymentSchema, scope });
await bootstrapPostgresPaymentJobs(namespace);
```

Bootstrap durably binds the payment schema to the job schema and the exact
application/provider/account/environment scope. The job schema also records its
payment-schema owner. Conflicting bindings are rejected. Keep this stable pair
through restarts and key rotation; a new namespace is a different deployment, not
a safe way to reinstall authoritative payment history.

Bootstrap creates the named `payments_work` and `payments_repair` queues and
pg-boss's internal `__pgboss__send-it` queue. It installs a durable, once-per-minute
repair schedule with missed-run catch-up. Queue retention is finite: pending jobs
retain for 14 days and completed jobs for 7 days. Startup never depends on an old
queue row surviving that retention period.

Construct and start the runtime explicitly:

```ts
import { createPayments } from '@agent-teams/payments-core';
import { createPostgresPaymentJobs, createPostgresPaymentStore } from '@agent-teams/payments-postgres';

const jobs = createPostgresPaymentJobs(namespace);
const store = await createPostgresPaymentStore({
  pool,
  schema: namespace.paymentSchema,
  scope,
  queue: jobs.queue,
});
const payments = createPayments({ scope, producerNamespace, store, provider, catalog });
await jobs.start({
  payments,
  store,
  consumers: {
    credits: async message => {
      // Owned by this consumer: commit its dedup receipt and effect together (T3).
      await creditConsumer.consume(message);
      return { messageId: message.messageId, bodyDigest: message.bodyDigest };
    },
  },
  // Optional: one read-only reconciliation action; never call an external mutation.
  inspectUnknown: async operation => {
    await reconciliation.inspect(operation);
    return 'review';
  },
  // Optional: a single bounded provider page through the public checkpoint protocol.
  resumeScan: async checkpoint => { await reconciler.resumeScan(checkpoint.scanId); },
});
```

Imports and construction start no connections, timers, workers or CLI loops.
`start` validates the namespace, all preinstalled queues and the durable repair
schedule before starting pg-boss. Runtime uses `migrate:false`,
`createSchema:false`, `supervise:true`, `schedule:true` and `reindex:false`.
Error and warning listeners are installed before pg-boss starts. Failed startup
stops installed workers and timers and preserves the host pool.
If failure happens after the core handlers were installed, that jobs instance is
terminal. Its `status()` and `drain()` retain every admitted core call, including a
physical SDK request still unresolved after its logical deadline. Drain it before
constructing a replacement; a second `start()` cannot replace that ownership.

The store's optional queue sends use the already checked-out payment transaction
through pg-boss's public `send(..., { db })` seam. This makes a T1/T2 record change
and its enqueue atomic. Workers use ordinary `work`, with no SQL transaction held
across provider or consumer I/O. The payment T2 or delivery ACK commits before the
handler returns; pg-boss then completes the job. Replaying after a crash in this
interval is safe. Do not combine these workers with `transactional:true` or manual
job completion.

## Runtime role

The qualified runtime role owns no schema or table and has no schema `CREATE`
privilege. Provision grants after bootstrap using the migration owner. Replace
the example names with the deployment's stable namespaces and role:

```sql
GRANT USAGE ON SCHEMA payments_application_a, payment_jobs_application_a
  TO payment_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
  IN SCHEMA payments_application_a, payment_jobs_application_a TO payment_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA payment_jobs_application_a FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payment_jobs_application_a.job_now(),
  payment_jobs_application_a.create_queue(text, jsonb) TO payment_runtime;
```

These grants cover the tested normal work, settlement, scheduling and supervision
paths. They deliberately grant no migration, reindex or table-ownership authority.
The pinned scheduler calls `create_queue` for its existing internal queue; its
invoker-rights function returns before the conditional partition-DDL branch when
that queue already exists. Startup verifies that all required queues exist and
are nonpartitioned. PostgreSQL integration tests run the real pinned version with
the grants above and prove that runtime cannot create a table. Requalify this
profile when upgrading pg-boss.

The shared SQL executor borrows one connection per pg-boss script, including
scripts containing pg-boss's own `BEGIN`/`COMMIT`. It does not nest these scripts
inside a second transaction. It sets `synchronous_commit=on`, applies bounded
lock/statement/transaction waits, restores prior session settings on success, and
discards a connection whose state cannot be established. The payment transaction
helper provides the corresponding owner-local T1/T2 boundary. Defaults target
PostgreSQL 18: 500 ms acquisition, 500 ms lock wait, 1,500 ms statement,
2,500 ms transaction, and 3,500 ms total connection ownership. Host pool size and
timeouts remain explicit deployment decisions.

## Repair, retries and operator review

The payment schema's `obligations` table is authoritative. Deleting every pg-boss
job does not delete an inbox receipt, prepared operation, publication, unknown
outcome, scan checkpoint, backfill cursor or delivery target. One bounded startup
pass and the durable periodic repair schedule recreate missing or terminal jobs.
Hosts can request another bounded pass with `jobs.repair(limit)`.

Repair selects due obligations with `FOR UPDATE SKIP LOCKED`, excludes jobs still
created/retrying/active before applying the batch limit, and enqueues in that same
payment transaction. Replicas intentionally compete on one namespace. The job
payload is only a wake-up identity; handlers re-read scope-owned records and the
durable operation state before effects. A prepared job can dispatch only while
the durable operation is still `prepared`. An unknown job cannot call that path.

Logical attempts and cooldown live in the payment obligation, independently of
pg-boss retries and job retention. Queue retry is disabled for this work; the
bounded payment repair mechanism owns retry admission. Defaults allow eight
logical attempts, with exponential cooldown from 30 seconds up to one hour.
Persistent handler/configuration faults become durable quarantine instead of a
hot loop. Successful scan or backfill cursor progress resets the fault budget, so
long scans do not become quarantined merely because they require many pages.
Missing read-only reconciliation/scan handlers and unknown outcomes
needing operator review are quarantined visibly. Unknown outcomes retain their
dispatch marker and can only acquire evidence or enter audited manual resolution;
repair never turns them into a new prepared mutation.

After resolving the underlying fault, an operator may call:

```ts
await jobs.redrive({ kind: 'delivery', id: deliveryIdentity }, 'incident-123');
```

Redrive resets an unfinished obligation's logical cooldown/attempts and persists
the audit reference as a separate payment-owned record. It does not rewrite an
operation or authorize an unknown mutation retry. Audited mutation resolution
uses the core's explicit `resolveUnknownOperation` protocol and duplicate-risk
guard. A recovery fence blocks repair, new work admission and redrive until its
owner explicitly resolves the restore/failover investigation.

Delivery jobs address exactly one saved `[messageId, consumerId]` target. The
worker loads its immutable message, awaits the configured consumer's durable T3,
validates the returned message identity and body digest, then calls the core ACK.
One consumer's receipt cannot acknowledge another target. Consumers must retain
their own deduplication/checkpoint history and make replay safe. An optional hook
or callback without a durable consumer transaction is not a financial delivery.
Backfill resumes through the public `listDeliveries` cursor protocol.

## Shutdown and recovery limits

Stop host HTTP/command admission, then stop the core and worker admission:

```ts
payments.stop();
const debt = await jobs.stop(30_000);
// debt reports admitted handlers, pending core work and physically unresolved SDK calls.
// A deadline does not cancel a request already sent to an external provider.
await jobs.drain();
// Only the host, after sibling users have also stopped:
await pool.end();
```

`stop` first closes worker admission and stops queue polling, then requests
`boss.stop({ close:false, graceful:true })`. If its budget expires, it reports the
remaining work honestly while cleanup continues. `drain` waits for already
admitted handlers and the core's physical external tasks. Neither method ends the
host pool. A sibling scope using the same pool remains usable. If an SDK promise
remains unresolved forever, draining it remains the host's operational decision;
an unknown durable outcome must not be treated as safe to resend.

Supported qualification targets are Linux Node 24.21.0 and 26.11.1 with PostgreSQL
18. The durable profile requires logged tables, `fsync=on`, durable WAL and one
primary without automatic lossy failover. Restore or possible WAL loss requires
the documented recovery fence and owner-led reconciliation; queue repair cannot
reconstruct a lost dispatch marker or independently prove an RPO0 failover.

Run the integration scenarios with an explicit disposable PostgreSQL 18 URL:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres pnpm test:postgres
```
