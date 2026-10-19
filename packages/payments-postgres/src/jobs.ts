import { canonicalJson, digest } from '@agent-teams/payments-core';
import type { AggregateIdentity, Delivery, EvidenceMessage, PaymentOperation, Payments, PaymentStore, ScanCheckpoint } from '@agent-teams/payments-core';
import type { Job } from 'pg-boss';
import { sqlIdentifier, withPaymentTransaction } from './database.js';
import { makePaymentBoss, paymentRepairQueue, paymentWorkQueue, qualifyPaymentJobNamespace } from './job-transport.js';
import type { PaymentJobEvents, PaymentJobNamespace } from './job-transport.js';
import { assertBatchLimit, PaymentRecords } from './records.js';

export type PaymentJobWork = Readonly<{ kind: 'inbox' | 'publication' | 'prepared' | 'unknown' | 'delivery' | 'scan'; id: string }>;
export type PaymentDeliveryReceipt = Readonly<{ messageId: string; bodyDigest: string }>;
export type PaymentJobHandlers = Readonly<{
  payments: Payments;
  store: PaymentStore;
  /** Resolve only after the consumer's own durable receipt + effect transaction (T3). */
  consumers?: Readonly<Record<string, (message: EvidenceMessage) => Promise<PaymentDeliveryReceipt>>>;
  /** Read-only acquisition/reconciliation. This callback must never redispatch an external mutation. */
  inspectUnknown?: (operation: Readonly<PaymentOperation>) => Promise<'review' | 'retry'>;
  /** Host-owned bounded scan page, using the public checkpoint/admission protocol. */
  resumeScan?: (checkpoint: Readonly<ScanCheckpoint>) => Promise<void>;
}>;
export type PaymentJobOptions = PaymentJobNamespace & PaymentJobEvents & Readonly<{
  batchSize?: number;
  concurrency?: number;
  pollingIntervalSeconds?: number;
  maxAttempts?: number;
  cooldownSeconds?: number;
  maxCooldownSeconds?: number;
}>;
export type PaymentJobStopResult = Readonly<{ transportStopped: boolean; admittedHandlers: number; unresolvedExternalCalls: number; pendingCoreWork: number }>;

class WorkIssue extends Error {
  readonly issue: string;
  readonly quarantine: boolean;
  constructor(issue: string, quarantine = false) { super(issue); this.issue = issue; this.quarantine = quarantine; }
}
function isWork(value: unknown): value is PaymentJobWork {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PaymentJobWork>;
  return ['inbox', 'publication', 'prepared', 'unknown', 'delivery', 'scan'].includes(item.kind ?? '') && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 4_096;
}
function aggregate(id: string): AggregateIdentity {
  const value: unknown = JSON.parse(id);
  if (!value || typeof value !== 'object' || !('type' in value) || !('id' in value) || (value.type !== 'transaction' && value.type !== 'subscription') || typeof value.id !== 'string' || !value.id) throw new WorkIssue('invalid_publication_identity', true);
  return { type: value.type, id: value.id };
}
function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid payment job ${label}`);
  return value;
}

/** Construction has no I/O, timers or workers. Host calls start and stop explicitly. */
export function createPostgresPaymentJobs(options: PaymentJobOptions) {
  const records = new PaymentRecords(options.paymentSchema), jobs = sqlIdentifier(options.jobSchema);
  const batch = options.batchSize ?? 25; assertBatchLimit(batch);
  const concurrency = boundedInteger(options.concurrency ?? 2, 1, 32, 'concurrency');
  const maxAttempts = boundedInteger(options.maxAttempts ?? 8, 1, 100, 'attempt bound');
  const cooldown = boundedInteger(options.cooldownSeconds ?? 30, 1, 86_400, 'cooldown');
  const maxCooldown = boundedInteger(options.maxCooldownSeconds ?? 3_600, cooldown, 604_800, 'maximum cooldown');
  const poll = options.pollingIntervalSeconds ?? 1;
  if (!Number.isFinite(poll) || poll < 0.5 || poll > 60) throw new RangeError('Invalid payment job polling interval');
  const boss = makePaymentBoss(options);
  let handlers: PaymentJobHandlers | undefined;
  let accepting = false, started = false, transportStopped = true, stopRequested = false;
  let starting: Promise<void> | undefined, stopping: Promise<void> | undefined;
  let qualification: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();

  function qualify(): Promise<void> {
    qualification ??= qualifyPaymentJobNamespace(options, boss).catch(error => { qualification = undefined; throw error; });
    return qualification;
  }

  async function repair(limit = batch): Promise<Readonly<{ enqueued: number }>> {
    assertBatchLimit(limit);
    await qualify();
    return withPaymentTransaction(options.pool, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) return { enqueued: 0 };
      // Queue rows can all disappear. The payment-owned obligation is the only work authority.
      // Existing runnable jobs are excluded before LIMIT, so an older live job cannot starve later
      // obligations. Locking the obligation serializes competing repair replicas and admissions.
      const due = await tx.query<{ kind: string; id: string }>(`SELECT o.kind, o.id FROM ${records.sql}.obligations o
        WHERE o.state = 'pending' AND o.next_attempt_at <= clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM ${jobs}.job j WHERE j.name = $1 AND j.state IN ('created', 'retry', 'active')
          AND j.data ->> 'kind' = o.kind AND j.data ->> 'id' = o.id)
        ORDER BY o.next_attempt_at, o.kind, o.id LIMIT $2 FOR UPDATE OF o SKIP LOCKED`, [paymentWorkQueue, limit]);
      let enqueued = 0;
      for (const work of due.rows) {
        if (!isWork(work)) {
          await tx.query(`UPDATE ${records.sql}.obligations SET state = 'quarantined', issue = 'unsupported_work_kind' WHERE kind = $1 AND id = $2`, [work.kind, work.id]);
          continue;
        }
        const id = await boss.send(paymentWorkQueue, work, { db: { executeSql: (text, values) => tx.query(text, values) }, singletonKey: digest(work), retryLimit: 0 });
        if (id) enqueued += 1;
      }
      return { enqueued };
    }, options.timeouts);
  }

  async function claim(work: PaymentJobWork): Promise<number | undefined> {
    return withPaymentTransaction(options.pool, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) return undefined;
      const row = await tx.query<{ attempts: number }>(`UPDATE ${records.sql}.obligations SET attempts = attempts + 1,
        next_attempt_at = clock_timestamp() + $3 * interval '1 second'
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND next_attempt_at <= clock_timestamp()
        RETURNING attempts`, [work.kind, work.id, maxCooldown]);
      return row.rows[0]?.attempts;
    }, options.timeouts);
  }

  async function settle(work: PaymentJobWork, attempt: number, issue: WorkIssue | undefined, progress: boolean): Promise<void> {
    await withPaymentTransaction(options.pool, async tx => {
      await records.configuration(tx, options.scope);
      const seconds = Math.min(maxCooldown, cooldown * 2 ** Math.min(attempt - 1, 20));
      // T2/ACK may already have completed the obligation. Never reopen it or overwrite a later
      // claimant's outcome. The logical retry counter survives deletion of every queue job.
      await tx.query(`UPDATE ${records.sql}.obligations SET
        state = CASE WHEN $8 THEN 'pending' WHEN $4 OR attempts >= $5 THEN 'quarantined' ELSE 'pending' END,
        attempts = CASE WHEN $8 THEN 0 ELSE attempts END,
        next_attempt_at = clock_timestamp() + $6 * interval '1 second', issue = $7
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND attempts = $3`,
      [work.kind, work.id, attempt, issue?.quarantine ?? false, maxAttempts, progress ? cooldown : seconds, progress ? null : issue?.issue ?? 'work_remains_pending', progress]);
    }, options.timeouts);
  }

  async function deliver(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    if (work.id.startsWith('backfill:')) {
      const consumer = work.id.slice('backfill:'.length);
      const cursor = () => withPaymentTransaction(options.pool, async tx => {
        await records.configuration(tx, options.scope);
        return (await records.read<unknown>(tx, 'backfills', consumer))?.body;
      }, options.timeouts);
      const before = await cursor();
      await installed.store.listDeliveries(options.scope, consumer, batch);
      return canonicalJson(before ?? null) !== canonicalJson(await cursor() ?? null);
    }
    const target = await withPaymentTransaction(options.pool, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) throw new WorkIssue('recovery_fenced');
      const delivery = (await records.read<Delivery>(tx, 'deliveries', work.id))?.body;
      if (!delivery) throw new WorkIssue('missing_delivery_authority', true);
      if (delivery.acknowledged) return undefined;
      if (canonicalJson([delivery.messageId, delivery.consumerId]) !== work.id) throw new WorkIssue('invalid_delivery_identity', true);
      const message = (await records.read<EvidenceMessage>(tx, 'evidence', delivery.messageId))?.body;
      if (!message || message.messageId !== delivery.messageId || canonicalJson(message.scope) !== canonicalJson(options.scope)) throw new WorkIssue('missing_delivery_evidence', true);
      return { delivery, message };
    }, options.timeouts);
    if (!target) return false;
    const consume = installed.consumers?.[target.delivery.consumerId];
    if (!consume) throw new WorkIssue('consumer_not_installed');
    const receipt = await consume(structuredClone(target.message));
    if (receipt.messageId !== target.message.messageId || receipt.bodyDigest !== target.message.bodyDigest) throw new WorkIssue('consumer_receipt_mismatch', true);
    const result = await installed.payments.acknowledgeDelivery(target.delivery.consumerId, target.message.messageId, target.message.bodyDigest);
    if (result === 'conflict') throw new WorkIssue('delivery_ack_conflict', true);
    return false;
  }

  async function run(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    if (work.kind === 'inbox') {
      const result = await installed.payments.processInbox(work.id);
      if (result === 'missing') throw new WorkIssue('missing_inbox_authority', true);
      if (result === 'conflict' || result === 'recovery_fenced') throw new WorkIssue(result);
    } else if (work.kind === 'publication') {
      const result = await installed.payments.flushPublication(aggregate(work.id));
      if (result === 'missing') throw new WorkIssue('missing_publication_authority', true);
      if (result === 'conflict' || result === 'recovery_fenced') throw new WorkIssue(result);
    } else if (work.kind === 'prepared') {
      // Queue payload never authorizes a monetary dispatch. Re-read the durable marker first.
      const operation = await installed.payments.readOperation(work.id);
      if (!operation) throw new WorkIssue('missing_operation_authority', true);
      if (operation.state === 'prepared') await installed.payments.executeOperation(work.id);
    } else if (work.kind === 'unknown') {
      const operation = await installed.payments.readOperation(work.id);
      if (!operation) throw new WorkIssue('missing_operation_authority', true);
      if (operation.state !== 'dispatch_started' && operation.state !== 'outcome_unknown') return false;
      if (!installed.inspectUnknown || await installed.inspectUnknown(structuredClone(operation)) === 'review') throw new WorkIssue('unknown_requires_manual_review', true);
    } else if (work.kind === 'scan') {
      const checkpoint = await installed.store.readCheckpoint(options.scope, work.id);
      if (!checkpoint) throw new WorkIssue('missing_scan_authority', true);
      if (checkpoint.status === 'complete') return false;
      if (!installed.resumeScan) throw new WorkIssue('scan_requires_manual_review', true);
      await installed.resumeScan(structuredClone(checkpoint));
      return canonicalJson(await installed.store.readCheckpoint(options.scope, work.id) ?? null) !== canonicalJson(checkpoint);
    } else return deliver(work, installed);
    return false;
  }

  async function handle(job: Job<unknown>): Promise<void> {
    if (!accepting || !handlers) return;
    if (!isWork(job.data)) throw new WorkIssue('invalid_job_payload', true);
    const work = job.data, installed = handlers;
    const attempt = await claim(work);
    if (attempt === undefined) return;
    let issue: WorkIssue | undefined;
    let progress = false;
    try { progress = await run(work, installed); }
    catch (error) { issue = error instanceof WorkIssue ? error : new WorkIssue('handler_failed'); }
    await settle(work, attempt, issue, progress);
  }

  function admitted(operation: () => Promise<unknown>): Promise<unknown> {
    if (!accepting) return Promise.resolve();
    const task = operation(); active.add(task);
    void task.finally(() => active.delete(task)).catch(() => undefined);
    return task;
  }

  async function start(installed: PaymentJobHandlers): Promise<void> {
    if (starting) return starting;
    if (started) throw new Error('Payment job workers are already started');
    if (stopping || stopRequested) throw new Error('Payment job workers are stopping');
    if (canonicalJson(installed.payments.scope) !== canonicalJson(options.scope)) throw new Error('Payment worker scope mismatch');
    starting = (async () => {
      try {
        await qualify();
        handlers = installed; transportStopped = false;
        await boss.start();
        await repair();
        if (stopRequested) return;
        accepting = true;
        await boss.work<unknown>(paymentWorkQueue, { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: poll }, async jobs => {
          await Promise.all(jobs.map(job => admitted(() => handle(job))));
        });
        await boss.work<unknown>(paymentRepairQueue, { batchSize: 1, pollingIntervalSeconds: poll }, async jobs => {
          await Promise.all(jobs.map(job => admitted(async () => {
            if (canonicalJson(job.data) !== canonicalJson({ kind: 'repair', paymentSchema: options.paymentSchema })) throw new WorkIssue('invalid_repair_namespace', true);
            await repair();
          })));
        });
        started = true;
      } catch (error) {
        accepting = false;
        // A worker may already have admitted an SDK call before a later registration fails.
        // Keep its core lifecycle reachable through status/drain, and make this instance
        // terminal rather than allowing a second installation to replace that ownership.
        if (handlers) stopRequested = true;
        await boss.offWork(paymentWorkQueue, { wait: false });
        await boss.offWork(paymentRepairQueue, { wait: false });
        await boss.stop({ close: false, graceful: true });
        transportStopped = true;
        throw error;
      } finally { starting = undefined; }
    })();
    return starting;
  }

  function status(): PaymentJobStopResult {
    const lifecycle = handlers?.payments.lifecycle();
    return { transportStopped, admittedHandlers: active.size, unresolvedExternalCalls: lifecycle?.unresolvedExternalCalls ?? 0, pendingCoreWork: lifecycle?.pendingWork ?? 0 };
  }

  async function stop(timeoutMs = 30_000): Promise<PaymentJobStopResult> {
    boundedInteger(timeoutMs, 1, 300_000, 'shutdown timeout');
    stopRequested = true; accepting = false;
    if (!stopping) {
      stopping = (async () => {
        if (starting) await starting.catch(() => undefined);
        accepting = false;
        await boss.offWork(paymentWorkQueue, { wait: false });
        await boss.offWork(paymentRepairQueue, { wait: false });
        await boss.stop({ close: false, graceful: true, timeout: timeoutMs });
        transportStopped = true; started = false;
      })();
      void stopping.catch(options.onError);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([stopping, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      return status();
    } finally { if (timer) clearTimeout(timer); }
  }

  async function drain(): Promise<PaymentJobStopResult> {
    if (stopping) await stopping;
    while (active.size) await Promise.allSettled(active);
    await handlers?.payments.drain();
    return status();
  }

  /** Explicit operator redrive. It clears logical cooldown/quarantine with an audit reference. */
  async function redrive(work: PaymentJobWork, auditRef: string): Promise<void> {
    if (!isWork(work) || !auditRef || auditRef.length > 512) throw new TypeError('Payment job redrive requires a valid work identity and audit reference');
    await qualify();
    await withPaymentTransaction(options.pool, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) throw new Error('Payment recovery is fenced');
      await tx.query(`UPDATE ${records.sql}.obligations SET state = 'pending', attempts = 0, next_attempt_at = clock_timestamp(), issue = $3
        WHERE kind = $1 AND id = $2 AND state <> 'complete'`, [work.kind, work.id, `redrive:${auditRef}`]);
      await tx.query(`INSERT INTO ${records.sql}.records (kind, id, revision, body) VALUES ('jobRedrives', $1, 1, $2)
        ON CONFLICT DO NOTHING`, [digest([work, auditRef]), JSON.stringify({ work, auditRef, at: new Date().toISOString() })]);
    }, options.timeouts);
    await repair();
  }

  return { queue: Object.freeze({ boss, name: paymentWorkQueue }), start, repair, stop, drain, status, redrive };
}
export type PostgresPaymentJobs = ReturnType<typeof createPostgresPaymentJobs>;
