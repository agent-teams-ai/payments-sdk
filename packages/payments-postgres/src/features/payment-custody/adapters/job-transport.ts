import { canonicalJson, digest } from '@agent-teams/payments-core';
import type { PaymentScope } from '@agent-teams/payments-core';
import { PgBoss } from 'pg-boss';
import { assertPostgresDurability, createPaymentSqlExecutor, PaymentDatabaseError, sqlIdentifier, withPaymentTransaction } from './database.js';
import type { PaymentSqlExecutor } from './database.js';
import { reportPaymentJobError } from './work-transport.js';
import type { PaymentJobEvents, PaymentJobNamespace, PaymentJobTransport } from './work-transport.js';
export const paymentJobRetention = Object.freeze({ retentionSeconds: 14 * 86_400, deleteAfterSeconds: 7 * 86_400 });
export const paymentWorkQueue = 'payments_work';
export const paymentRepairQueue = 'payments_repair';
const schedulerQueue = '__pgboss__send-it';

export type PgBossPaymentTransportOptions = PaymentJobNamespace & PaymentJobEvents & Readonly<{
  jobSchema: string;
  onWarning?: (warning: Readonly<{ message: string }>) => void;
}>;
export interface PgBossPaymentTransport extends PaymentJobTransport {
  /** Explicit migration-role operation. Never invoked by qualify/start. */
  bootstrap: () => Promise<void>;
}

function validateNamespace(options: PgBossPaymentTransportOptions): void {
  sqlIdentifier(options.paymentSchema); sqlIdentifier(options.jobSchema);
  if (options.paymentSchema === options.jobSchema) {throw new TypeError('Payment records and jobs require separate schemas');}
}

/** The connection source remains owned by the host, including failed startup and shutdown. */
function makePaymentBoss(options: PgBossPaymentTransportOptions, bootstrap = false, executor: PaymentSqlExecutor = createPaymentSqlExecutor(options.database, options.timeouts)): PgBoss {
  validateNamespace(options);
  const boss = new PgBoss({
    db: executor, schema: options.jobSchema,
    migrate: bootstrap, createSchema: bootstrap, supervise: !bootstrap, schedule: !bootstrap,
    reindex: false, useListenNotify: false, registerInstance: false,
    ...paymentJobRetention,
  });
  // EventEmitter error listeners must exist before any pg-boss subsystem can start.
  boss.on('error', error => { reportPaymentJobError(options, error); });
  boss.on('warning', warning => {
    if (!options.onWarning) {reportPaymentJobError(options, new Error(`Payment job warning: ${warning.message}`)); return;}
    try {
      const sink: Readonly<{ onWarning: (value: Readonly<{ message: string }>) => unknown }> = { onWarning: options.onWarning };
      void Promise.resolve(sink.onWarning({ message: warning.message })).catch(() => {});
    } catch { /* Warning sinks cannot alter the transport lifecycle. */ }
  });
  return boss;
}

/** Explicit migration-role operation. Call after migratePaymentSchema, never from runtime start. */
async function bootstrapPostgresPaymentJobs(options: PgBossPaymentTransportOptions): Promise<void> {
  validateNamespace(options);
  const payment = sqlIdentifier(options.paymentSchema), jobs = sqlIdentifier(options.jobSchema);
  // Claim both namespaces before pg-boss may install anything. The payment configuration lock
  // serializes replicas; the job-schema owner row rejects a different payment deployment.
  await withPaymentTransaction(options.database, async tx => {
    const owner = await tx.query<{ body: { scope: PaymentScope; jobTransport?: unknown } }>(`SELECT body FROM ${payment}.configuration WHERE id = 'owner' FOR UPDATE`);
    if (!owner.rows[0] || canonicalJson(owner.rows[0].body.scope) !== canonicalJson(options.scope)) {throw new Error('Payment job namespace scope mismatch');}
    const binding = { jobSchema: options.jobSchema, queueName: paymentWorkQueue };
    if (Boolean(owner.rows[0].body.jobTransport) && canonicalJson(owner.rows[0].body.jobTransport) !== canonicalJson(binding)) {throw new Error('Payment schema already has another job namespace');}
    await tx.query(`CREATE SCHEMA IF NOT EXISTS ${jobs}`);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${jobs}.payment_owner (id text PRIMARY KEY CHECK (id = 'owner'), body jsonb NOT NULL)`);
    const expected = { paymentSchema: options.paymentSchema, scope: options.scope };
    await tx.query(`INSERT INTO ${jobs}.payment_owner (id, body) VALUES ('owner', $1) ON CONFLICT DO NOTHING`, [JSON.stringify(expected)]);
    const existing = await tx.query<{ body: unknown }>(`SELECT body FROM ${jobs}.payment_owner WHERE id = 'owner' FOR UPDATE`);
    if (canonicalJson(existing.rows[0]?.body ?? null) !== canonicalJson(expected)) {throw new Error('Job namespace already belongs to another payment deployment');}
    await tx.query(`UPDATE ${payment}.configuration SET revision = revision + 1, body = jsonb_set(body, '{jobTransport}', $1::jsonb) WHERE id = 'owner' AND body -> 'jobTransport' IS DISTINCT FROM $1::jsonb`, [JSON.stringify(binding)]);
  }, options.timeouts);
  const boss = makePaymentBoss(options, true);
  try {
    await boss.start();
    // Timekeeper.start() invokes createQueue for SEND_IT at runtime. Preinstalling this
    // nonpartitioned queue makes that function return before its conditional DDL branch.
    for (const name of [paymentWorkQueue, paymentRepairQueue, schedulerQueue]) {
      await boss.createQueue(name, { ...paymentJobRetention, retryLimit: 0, expireInSeconds: 300, partition: false });
    }
    await boss.schedule(paymentRepairQueue, '* * * * *', { kind: 'repair', paymentSchema: options.paymentSchema }, { key: 'durable_obligations', tz: 'UTC', missed: 'once', ...paymentJobRetention });
  } finally {
    await boss.stop({ close: false, graceful: true });
  }
}

async function qualifyPaymentJobNamespace(options: PgBossPaymentTransportOptions, boss: PgBoss): Promise<void> {
  validateNamespace(options);
  await assertPostgresDurability(options.database, options.paymentSchema);
  const payment = sqlIdentifier(options.paymentSchema), jobs = sqlIdentifier(options.jobSchema);
  await withPaymentTransaction(options.database, async tx => {
    const owner = await tx.query<{ body: { scope: PaymentScope; jobTransport?: unknown } }>(`SELECT body FROM ${payment}.configuration WHERE id = 'owner' FOR SHARE`);
    const namespace = await tx.query<{ body: unknown }>(`SELECT body FROM ${jobs}.payment_owner WHERE id = 'owner'`);
    if (!owner.rows[0] || canonicalJson(owner.rows[0].body.scope) !== canonicalJson(options.scope)
      || canonicalJson(owner.rows[0].body.jobTransport ?? null) !== canonicalJson({ jobSchema: options.jobSchema, queueName: paymentWorkQueue })
      || canonicalJson(namespace.rows[0]?.body ?? null) !== canonicalJson({ paymentSchema: options.paymentSchema, scope: options.scope })) {throw new Error('Payment job namespace binding is absent or mismatched');}
    const weak = await tx.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relpersistence <> 'p' AND c.relkind IN ('r', 'p') LIMIT 1`, [options.jobSchema]);
    if (weak.rows.length) {throw new PaymentDatabaseError('durability_profile');}
  }, options.timeouts);
  for (const name of [paymentWorkQueue, paymentRepairQueue, schedulerQueue]) {
    const queue = await boss.getQueue(name);
    if (!queue || (queue.partition === true) || queue.retryLimit !== 0 || queue.expireInSeconds !== 300 || queue.policy !== 'standard'
      || queue.retentionSeconds !== paymentJobRetention.retentionSeconds || queue.deleteAfterSeconds !== paymentJobRetention.deleteAfterSeconds) {throw new Error(`Payment job queue requires explicit bootstrap: ${name}`);}
  }
  const schedule = await boss.getSchedule(paymentRepairQueue, 'durable_obligations');
  if (!schedule || schedule.cron !== '* * * * *' || schedule.timezone !== 'UTC' || schedule.options?.missed !== 'once'
    || canonicalJson(schedule.data ?? null) !== canonicalJson({ kind: 'repair', paymentSchema: options.paymentSchema })) {throw new Error('Payment repair schedule requires explicit bootstrap');}
}

/** Explicit outer composition selects this adapter. Its PgBoss instance and schema protocol
 * remain private; the returned contract contains no pg-boss declarations or mutable client. */
export function createPgBossPaymentTransport(options: PgBossPaymentTransportOptions): PgBossPaymentTransport {
  const boss = makePaymentBoss(options), jobs = sqlIdentifier(options.jobSchema);
  const pendingWorkSql = (kindExpression: string, idExpression: string) => ({
    text: `EXISTS (SELECT 1 FROM ${jobs}.job j WHERE j.name = $1 AND j.state IN ('created', 'retry', 'active')
      AND j.data ->> 'kind' = ${kindExpression} AND j.data ->> 'id' = ${idExpression})`,
    values: [paymentWorkQueue],
  });
  return {
    namespace: Object.freeze({ paymentSchema: options.paymentSchema, scope: Object.freeze(structuredClone(options.scope)) }),
    bootstrap: () => bootstrapPostgresPaymentJobs(options),
    qualify: () => qualifyPaymentJobNamespace(options, boss),
    pendingWorkSql,
    enqueue: async (work, transaction) => {
      // The caller already owns the payment obligation's row lock. Deduplicate runnable
      // identities, not a time window: a terminal job must never suppress its repair wake-up.
      const pending = pendingWorkSql('$2', '$3');
      if ((await transaction.query<{ pending: boolean }>(`SELECT ${pending.text} AS pending`, [...pending.values, work.kind, work.id])).rows[0]?.pending === true) {return false;}
      const executor: PaymentSqlExecutor = { executeSql: (text, values) => transaction.query(text, values) };
      // send's public db option covers INSERT, but a cold vendor queue-cache lookup uses its
      // constructor executor. This inert, send-only instance binds BOTH to the same transaction.
      // Never start it: no timers, pool, second checkout or retained executor escapes admission.
      const admission = makePaymentBoss(options, false, executor);
      const id = await admission.send(paymentWorkQueue, work, {
        db: executor,
        singletonKey: digest(work), retryLimit: 0,
      });
      return id !== null && id !== '';
    },
    start: async (handlers, worker) => {
      await boss.start();
      await boss.work<unknown>(paymentWorkQueue, { batchSize: 1, localConcurrency: worker.concurrency, pollingIntervalSeconds: worker.pollingIntervalSeconds }, async batch => {
        await Promise.all(batch.map(job => handlers.work(job.data)));
      });
      await boss.work<unknown>(paymentRepairQueue, { batchSize: 1, pollingIntervalSeconds: worker.pollingIntervalSeconds }, async batch => {
        await Promise.all(batch.map(async job => {
          if (canonicalJson(job.data) !== canonicalJson({ kind: 'repair', paymentSchema: options.paymentSchema })) {throw new Error('Invalid payment repair namespace');}
          await handlers.repair();
        }));
      });
    },
    stop: async timeoutMs => {
      // A failed worker cleanup must not skip the other queue or subsystem shutdown.
      const workers = await Promise.allSettled([
        boss.offWork(paymentWorkQueue, { wait: false }), boss.offWork(paymentRepairQueue, { wait: false }),
      ]);
      const stopped = await Promise.allSettled([boss.stop({ close: false, graceful: true, timeout: timeoutMs })]);
      const failures = [...workers, ...stopped].filter(result => result.status === 'rejected').map(result => result.reason as unknown);
      if (failures.length > 0) {throw new AggregateError(failures, 'Payment transport shutdown failed');}
    },
  };
}
