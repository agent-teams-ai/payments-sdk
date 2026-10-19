import { canonicalJson } from '@agent-teams/payments-core';
import type { PaymentScope } from '@agent-teams/payments-core';
import type { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import type { Warning } from 'pg-boss';
import { assertPostgresDurability, createPaymentSqlExecutor, PaymentDatabaseError, sqlIdentifier, withPaymentTransaction } from './database.js';
import type { DatabaseTimeouts } from './database.js';

export const paymentJobRetention = Object.freeze({ retentionSeconds: 14 * 86_400, deleteAfterSeconds: 7 * 86_400 });
export const paymentWorkQueue = 'payments_work';
export const paymentRepairQueue = 'payments_repair';
const schedulerQueue = '__pgboss__send-it';

export type PaymentJobNamespace = Readonly<{ pool: Pool; paymentSchema: string; jobSchema: string; scope: PaymentScope; timeouts?: DatabaseTimeouts }>;
export type PaymentJobEvents = Readonly<{ onError: (error: Error) => void; onWarning?: (warning: Warning) => void }>;

function validateNamespace(options: PaymentJobNamespace): void {
  sqlIdentifier(options.paymentSchema); sqlIdentifier(options.jobSchema);
  if (options.paymentSchema === options.jobSchema) throw new TypeError('Payment records and jobs require separate schemas');
}

/** The supplied Pool remains owned by the host, including failed startup and shutdown. */
export function makePaymentBoss(options: PaymentJobNamespace & PaymentJobEvents, bootstrap = false): PgBoss {
  validateNamespace(options);
  const boss = new PgBoss({
    db: createPaymentSqlExecutor(options.pool, options.timeouts), schema: options.jobSchema,
    migrate: bootstrap, createSchema: bootstrap, supervise: !bootstrap, schedule: !bootstrap,
    reindex: false, useListenNotify: false, registerInstance: false,
    ...paymentJobRetention,
  });
  // EventEmitter error listeners must exist before any pg-boss subsystem can start.
  boss.on('error', options.onError);
  boss.on('warning', options.onWarning ?? (warning => options.onError(new Error(`Payment job warning: ${warning.message}`))));
  return boss;
}

/** Explicit migration-role operation. Call after migratePaymentSchema, never from runtime start. */
export async function bootstrapPostgresPaymentJobs(options: PaymentJobNamespace & PaymentJobEvents): Promise<void> {
  validateNamespace(options);
  const payment = sqlIdentifier(options.paymentSchema), jobs = sqlIdentifier(options.jobSchema);
  // Claim both namespaces before pg-boss may install anything. The payment configuration lock
  // serializes replicas; the job-schema owner row rejects a different payment deployment.
  await withPaymentTransaction(options.pool, async tx => {
    const owner = await tx.query<{ body: { scope: PaymentScope; jobTransport?: unknown } }>(`SELECT body FROM ${payment}.configuration WHERE id = 'owner' FOR UPDATE`);
    if (!owner.rows[0] || canonicalJson(owner.rows[0].body.scope) !== canonicalJson(options.scope)) throw new Error('Payment job namespace scope mismatch');
    const binding = { jobSchema: options.jobSchema, queueName: paymentWorkQueue };
    if (owner.rows[0].body.jobTransport && canonicalJson(owner.rows[0].body.jobTransport) !== canonicalJson(binding)) throw new Error('Payment schema already has another job namespace');
    await tx.query(`CREATE SCHEMA IF NOT EXISTS ${jobs}`);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${jobs}.payment_owner (id text PRIMARY KEY CHECK (id = 'owner'), body jsonb NOT NULL)`);
    const expected = { paymentSchema: options.paymentSchema, scope: options.scope };
    await tx.query(`INSERT INTO ${jobs}.payment_owner (id, body) VALUES ('owner', $1) ON CONFLICT DO NOTHING`, [JSON.stringify(expected)]);
    const existing = await tx.query<{ body: unknown }>(`SELECT body FROM ${jobs}.payment_owner WHERE id = 'owner' FOR UPDATE`);
    if (canonicalJson(existing.rows[0]?.body ?? null) !== canonicalJson(expected)) throw new Error('Job namespace already belongs to another payment deployment');
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

export async function qualifyPaymentJobNamespace(options: PaymentJobNamespace, boss: PgBoss): Promise<void> {
  validateNamespace(options);
  await assertPostgresDurability(options.pool, options.paymentSchema);
  const payment = sqlIdentifier(options.paymentSchema), jobs = sqlIdentifier(options.jobSchema);
  await withPaymentTransaction(options.pool, async tx => {
    const owner = await tx.query<{ body: { scope: PaymentScope; jobTransport?: unknown } }>(`SELECT body FROM ${payment}.configuration WHERE id = 'owner' FOR SHARE`);
    const namespace = await tx.query<{ body: unknown }>(`SELECT body FROM ${jobs}.payment_owner WHERE id = 'owner'`);
    if (!owner.rows[0] || canonicalJson(owner.rows[0].body.scope) !== canonicalJson(options.scope)
      || canonicalJson(owner.rows[0].body.jobTransport ?? null) !== canonicalJson({ jobSchema: options.jobSchema, queueName: paymentWorkQueue })
      || canonicalJson(namespace.rows[0]?.body ?? null) !== canonicalJson({ paymentSchema: options.paymentSchema, scope: options.scope })) throw new Error('Payment job namespace binding is absent or mismatched');
    const weak = await tx.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relpersistence <> 'p' AND c.relkind IN ('r', 'p') LIMIT 1`, [options.jobSchema]);
    if (weak.rows.length) throw new PaymentDatabaseError('durability_profile');
  }, options.timeouts);
  for (const name of [paymentWorkQueue, paymentRepairQueue, schedulerQueue]) {
    const queue = await boss.getQueue(name);
    if (!queue || queue.partition || queue.retryLimit !== 0 || queue.expireInSeconds !== 300 || queue.policy !== 'standard'
      || queue.retentionSeconds !== paymentJobRetention.retentionSeconds || queue.deleteAfterSeconds !== paymentJobRetention.deleteAfterSeconds) throw new Error(`Payment job queue requires explicit bootstrap: ${name}`);
  }
  const schedule = await boss.getSchedule(paymentRepairQueue, 'durable_obligations');
  if (!schedule || schedule.cron !== '* * * * *' || schedule.timezone !== 'UTC' || schedule.options?.missed !== 'once'
    || canonicalJson(schedule.data ?? null) !== canonicalJson({ kind: 'repair', paymentSchema: options.paymentSchema })) throw new Error('Payment repair schedule requires explicit bootstrap');
}
