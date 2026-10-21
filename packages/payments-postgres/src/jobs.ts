import { canonicalJson, digest } from '@agent-teams/payments-core';
import type { AggregateIdentity, Delivery, EvidenceMessage, PaymentOperation, Payments, PaymentStore, ScanCheckpoint } from '@agent-teams/payments-core';
import { withPaymentTransaction } from './database.js';
import { reportPaymentJobError } from './work-transport.js';
import type { PaymentJobEnqueuer, PaymentJobEvents, PaymentJobNamespace, PaymentJobTransport, PaymentJobWork } from './work-transport.js';
import { assertBatchLimit, PaymentRecords } from './records.js';
import type { StoredRecord } from './records.js';

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
  transport: PaymentJobTransport;
  batchSize?: number;
  concurrency?: number;
  pollingIntervalSeconds?: number;
  maxAttempts?: number;
  cooldownSeconds?: number;
  maxCooldownSeconds?: number;
}>;
export type PaymentJobStopResult = Readonly<{ transportStopped: boolean; admittedHandlers: number; unresolvedExternalCalls: number; pendingCoreWork: number }>;

/** Host-only diagnostic context. Never persisted in payment evidence or queue payloads. */
export class PaymentJobHandlerError extends Error {
  readonly work: PaymentJobWork;
  readonly attempt: number;
  constructor(work: PaymentJobWork, attempt: number, cause: unknown) {
    super('Payment job handler failed', { cause });
    this.name = 'PaymentJobHandlerError';
    this.work = Object.freeze({ kind: work.kind, id: work.id });
    this.attempt = attempt;
  }
}

class WorkIssue extends Error {
  readonly issue: string;
  readonly quarantine: boolean;
  constructor(issue: string, quarantine = false) { super(issue); this.issue = issue; this.quarantine = quarantine; }
}
function isWork(value: unknown): value is PaymentJobWork {
  if (value === null || typeof value !== 'object') {return false;}
  const item = value as Partial<PaymentJobWork>;
  return ['inbox', 'publication', 'reclassification', 'prepared', 'unknown', 'delivery', 'scan'].includes(item.kind ?? '') && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 4_096;
}
function aggregate(id: string): AggregateIdentity {
  const value: unknown = JSON.parse(id);
  if (value === null || typeof value !== 'object' || !('type' in value) || !('id' in value) || (value.type !== 'transaction' && value.type !== 'subscription') || typeof value.id !== 'string' || !value.id) {throw new WorkIssue('invalid_publication_identity', true);}
  return { type: value.type, id: value.id };
}
function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {throw new RangeError(`Invalid payment job ${label}`);}
  return value;
}

/** Construction has no I/O, timers or workers. Host calls start and stop explicitly. */
export function createPostgresPaymentJobs(options: PaymentJobOptions) {
  const records = new PaymentRecords(options.paymentSchema), transport = options.transport;
  if (transport.namespace.paymentSchema !== options.paymentSchema || canonicalJson(transport.namespace.scope) !== canonicalJson(options.scope)) {throw new Error('Payment worker transport namespace mismatch');}
  const batch = options.batchSize ?? 25; assertBatchLimit(batch);
  const concurrency = boundedInteger(options.concurrency ?? 2, 1, 32, 'concurrency');
  const maxAttempts = boundedInteger(options.maxAttempts ?? 8, 1, 100, 'attempt bound');
  const cooldown = boundedInteger(options.cooldownSeconds ?? 30, 1, 86_400, 'cooldown');
  const maxCooldown = boundedInteger(options.maxCooldownSeconds ?? 3_600, cooldown, 604_800, 'maximum cooldown');
  const poll = options.pollingIntervalSeconds ?? 1;
  if (!Number.isFinite(poll) || poll < 0.5 || poll > 60) {throw new RangeError('Invalid payment job polling interval');}
  let handlers: PaymentJobHandlers | undefined;
  let accepting = false, started = false, transportStopped = true, stopRequested = false;
  let starting: Promise<void> | undefined, stopping: Promise<void> | undefined;
  let qualification: Promise<void> | undefined;
  const active = new Set<Promise<unknown>>();

  function qualify(): Promise<void> {
    qualification ??= transport.qualify().catch((error: unknown) => { qualification = undefined; throw error; });
    return qualification;
  }

  async function repair(limit = batch): Promise<Readonly<{ enqueued: number }>> {
    assertBatchLimit(limit);
    await qualify();
    return withPaymentTransaction(options.database, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) {return { enqueued: 0 };}
      // Queue rows can all disappear. The payment-owned obligation is the only work authority.
      // Existing runnable jobs are excluded before LIMIT, so an older live job cannot starve later
      // obligations. Locking the obligation serializes competing repair replicas and admissions.
      const pending = transport.pendingWorkSql('o.kind', 'o.id');
      const due = await tx.query<{ kind: string; id: string }>(`SELECT o.kind, o.id FROM ${records.sql}.obligations o
        WHERE o.state = 'pending' AND o.next_attempt_at <= clock_timestamp()
        AND NOT (${pending.text})
        ORDER BY o.next_attempt_at, o.kind, o.id LIMIT $${pending.values.length + 1} FOR UPDATE OF o SKIP LOCKED`, [...pending.values, limit]);
      let enqueued = 0;
      for (const work of due.rows) {
        if (!isWork(work)) {
          await tx.query(`UPDATE ${records.sql}.obligations SET state = 'quarantined', issue = 'unsupported_work_kind' WHERE kind = $1 AND id = $2`, [work.kind, work.id]);
          continue;
        }
        if (await transport.enqueue(work, tx)) {enqueued += 1;}
      }
      return { enqueued };
    }, options.timeouts);
  }

  async function claim(work: PaymentJobWork): Promise<Readonly<{ attempt: number; revision: string }> | undefined> {
    return withPaymentTransaction(options.database, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) {return;}
      const row = await tx.query<{ attempts: number; revision: string }>(`UPDATE ${records.sql}.obligations SET attempts = attempts + 1, revision = revision + 1,
        next_attempt_at = clock_timestamp() + $3 * interval '1 second'
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND next_attempt_at <= clock_timestamp()
        RETURNING attempts, revision::text`, [work.kind, work.id, maxCooldown]);
      const claimed = row.rows[0];
      return claimed ? { attempt: claimed.attempts, revision: claimed.revision } : undefined;
    }, options.timeouts);
  }

  async function settle(work: PaymentJobWork, claimed: Readonly<{ attempt: number; revision: string }>, issue: WorkIssue | undefined, progress: boolean): Promise<void> {
    await withPaymentTransaction(options.database, async tx => {
      await records.configuration(tx, options.scope);
      const seconds = Math.min(maxCooldown, cooldown * 2 ** Math.min(claimed.attempt - 1, 20));
      // T2/ACK may already have completed the obligation. Never reopen it or overwrite a later
      // claimant's outcome. The logical retry counter survives deletion of every queue job.
      await tx.query(`UPDATE ${records.sql}.obligations SET
        revision = revision + 1, state = CASE WHEN $8 THEN 'pending' WHEN $4 OR attempts >= $5 THEN 'quarantined' ELSE 'pending' END,
        attempts = CASE WHEN $8 THEN 0 ELSE attempts END,
        next_attempt_at = clock_timestamp() + $6 * interval '1 second', issue = $7
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND attempts = $3 AND revision = $9`,
      [work.kind, work.id, claimed.attempt, issue?.quarantine ?? false, maxAttempts, progress ? cooldown : seconds, progress ? null : issue?.issue ?? 'work_remains_pending', progress, claimed.revision]);
    }, options.timeouts);
  }

  async function deliver(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    if (work.id.startsWith('backfill:')) {
      const consumer = work.id.slice('backfill:'.length);
      const cursor = () => withPaymentTransaction(options.database, async tx => {
        await records.configuration(tx, options.scope);
        return (await records.read(tx, 'backfills', consumer))?.body;
      }, options.timeouts);
      const before = await cursor();
      await installed.store.listDeliveries(options.scope, consumer, batch);
      return canonicalJson(before ?? null) !== canonicalJson(await cursor() ?? null);
    }
    const target = await withPaymentTransaction(options.database, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) {throw new WorkIssue('recovery_fenced');}
      const delivery = (await (records.read(tx, 'deliveries', work.id) as Promise<StoredRecord<Delivery> | undefined>))?.body;
      if (!delivery) {throw new WorkIssue('missing_delivery_authority', true);}
      if (canonicalJson([delivery.messageId, delivery.consumerId]) !== work.id) {throw new WorkIssue('invalid_delivery_identity', true);}
      const message = (await (records.read(tx, 'evidence', delivery.messageId) as Promise<StoredRecord<EvidenceMessage> | undefined>))?.body;
      if (!message || message.messageId !== delivery.messageId || canonicalJson(message.scope) !== canonicalJson(options.scope)) {throw new WorkIssue('missing_delivery_evidence', true);}
      return { delivery, message };
    }, options.timeouts);
    if (!target.delivery.acknowledged) {
      const consume = installed.consumers?.[target.delivery.consumerId];
      if (!consume) {throw new WorkIssue('consumer_not_installed');}
      const receipt = await consume(structuredClone(target.message));
      if (receipt.messageId !== target.message.messageId || receipt.bodyDigest !== target.message.bodyDigest) {throw new WorkIssue('consumer_receipt_mismatch', true);}
    }
    const result = await installed.payments.acknowledgeDelivery(target.delivery.consumerId, target.message.messageId, target.message.bodyDigest);
    if (result === 'conflict') {throw new WorkIssue('delivery_ack_conflict', true);}
    return false;
  }

  async function run(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    if (work.kind === 'inbox') {
      const result = await installed.payments.processInbox(work.id);
      if (result === 'missing') {throw new WorkIssue('missing_inbox_authority', true);}
      if (result === 'conflict' || result === 'recovery_fenced') {throw new WorkIssue(result);}
    } else if (work.kind === 'reclassification') {
      const cursor = () => withPaymentTransaction(options.database, async tx => {
        await records.configuration(tx, options.scope);
        return (await records.read(tx, 'reclassifications', work.id))?.body;
      }, options.timeouts);
      const before = await cursor();
      const result = await installed.payments.processReclassification(work.id, batch);
      if (result === 'conflict' || result === 'recovery_fenced') {throw new WorkIssue(result);}
      // A bounded page is successful progress, even when further pages remain. It must not
      // consume the logical fault budget after job deletion or across worker restarts.
      return canonicalJson(before ?? null) !== canonicalJson(await cursor() ?? null);
    } else if (work.kind === 'publication') {
      const result = await installed.payments.flushPublication(aggregate(work.id));
      if (result === 'missing') {throw new WorkIssue('missing_publication_authority', true);}
      if (result === 'conflict' || result === 'recovery_fenced') {throw new WorkIssue(result);}
    } else if (work.kind === 'prepared') {
      // Queue payload never authorizes a monetary dispatch. Re-read the durable marker first.
      const operation = await installed.payments.readOperation(work.id);
      if (!operation) {throw new WorkIssue('missing_operation_authority', true);}
      if (operation.state === 'prepared') {await installed.payments.executeOperation(work.id);}
    } else if (work.kind === 'unknown') {
      const operation = await installed.payments.readOperation(work.id);
      if (!operation) {throw new WorkIssue('missing_operation_authority', true);}
      if (operation.state !== 'dispatch_started' && operation.state !== 'outcome_unknown') {return false;}
      if (!installed.inspectUnknown || await installed.inspectUnknown(structuredClone(operation)) === 'review') {throw new WorkIssue('unknown_requires_manual_review', true);}
    } else if (work.kind === 'scan') {
      const checkpoint = await installed.store.readCheckpoint(options.scope, work.id);
      if (!checkpoint) {throw new WorkIssue('missing_scan_authority', true);}
      if (checkpoint.status === 'complete') {return false;}
      if (!installed.resumeScan) {throw new WorkIssue('scan_requires_manual_review', true);}
      await installed.resumeScan(structuredClone(checkpoint));
      return canonicalJson(await installed.store.readCheckpoint(options.scope, work.id) ?? null) !== canonicalJson(checkpoint);
    } else {return deliver(work, installed);}
    return false;
  }

  async function handle(payload: unknown): Promise<void> {
    if (!accepting || !handlers) {return;}
    if (!isWork(payload)) {throw new WorkIssue('invalid_job_payload', true);}
    const work = payload, installed = handlers;
    const attempt = await claim(work);
    if (attempt === undefined) {return;}
    let issue: WorkIssue | undefined;
    let failure: PaymentJobHandlerError | undefined;
    let progress = false;
    try { progress = await run(work, installed); }
    catch (error) {
      issue = error instanceof WorkIssue ? error : new WorkIssue('handler_failed');
      if (!(error instanceof WorkIssue)) {failure = new PaymentJobHandlerError(work, attempt.attempt, error);}
    }
    try { await settle(work, attempt, issue, progress); }
    finally { if (failure) {reportPaymentJobError(options, failure);} }
  }

  function admitted(operation: () => Promise<unknown>): Promise<unknown> {
    if (!accepting) {return Promise.resolve();}
    const task = operation(); active.add(task);
    void task.finally(() => active.delete(task)).catch(() => {});
    return task;
  }

  async function start(installed: PaymentJobHandlers): Promise<void> {
    if (starting) {return starting;}
    if (started) {throw new Error('Payment job workers are already started');}
    if (stopping || stopRequested) {throw new Error('Payment job workers are stopping');}
    if (canonicalJson(installed.payments.scope) !== canonicalJson(options.scope)) {throw new Error('Payment worker scope mismatch');}
    starting = (async () => {
      try {
        await qualify();
        handlers = installed; transportStopped = false;
        await repair();
        if (isStopRequested()) {return;}
        accepting = true;
        await transport.start({
          work: async payload => { await admitted(() => handle(payload)); },
          repair: async () => { await admitted(async () => { await repair(); }); },
        }, { concurrency, pollingIntervalSeconds: poll });
        started = true;
      } catch (error) {
        accepting = false;
        // A worker may already have admitted an SDK call before a later registration fails.
        // Keep its core lifecycle reachable through status/drain, and make this instance
        // terminal rather than allowing a second installation to replace that ownership.
        if (handlers) {stopRequested = true;}
        await transport.stop(30_000);
        transportStopped = true;
        throw error;
      } finally { starting = undefined; }
    })();
    return starting;
  }

  function isStopRequested(): boolean { return stopRequested; }

  function status(): PaymentJobStopResult {
    const lifecycle = handlers?.payments.lifecycle();
    return { transportStopped, admittedHandlers: active.size, unresolvedExternalCalls: lifecycle?.unresolvedExternalCalls ?? 0, pendingCoreWork: lifecycle?.pendingWork ?? 0 };
  }

  async function stop(timeoutMs = 30_000): Promise<PaymentJobStopResult> {
    boundedInteger(timeoutMs, 1, 300_000, 'shutdown timeout');
    stopRequested = true; accepting = false;
    if (!stopping) {
      const attempt = (async () => {
        if (starting) {await starting.catch(() => {});}
        accepting = false;
        await transport.stop(timeoutMs);
        transportStopped = true; started = false;
      })();
      stopping = attempt;
      void attempt.catch((error: unknown) => {
        // Admission stays closed and transportStopped stays false. The owner can retry cleanup;
        // a rejected cached attempt must not make all subsequent stop calls permanently fail.
        if (stopping === attempt) {stopping = undefined;}
        reportPaymentJobError(options, error instanceof Error ? error : new Error('Payment job shutdown failed', { cause: error }));
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([stopping, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
      return status();
    } finally { if (timer) {clearTimeout(timer);} }
  }

  async function drain(): Promise<PaymentJobStopResult> {
    if (stopping) {await stopping.catch(() => {});}
    while (active.size) {await Promise.allSettled(active);}
    await handlers?.payments.drain();
    return status();
  }

  /** Explicit operator redrive. It clears logical cooldown/quarantine with an audit reference. */
  async function redrive(work: PaymentJobWork, auditRef: string): Promise<void> {
    if (!isWork(work) || !auditRef || auditRef.length > 512) {throw new TypeError('Payment job redrive requires a valid work identity and audit reference');}
    await qualify();
    await withPaymentTransaction(options.database, async tx => {
      if ((await records.configuration(tx, options.scope)).body.recoveryFenced) {throw new Error('Payment recovery is fenced');}
      await tx.query(`UPDATE ${records.sql}.obligations SET state = 'pending', attempts = 0, revision = revision + 1, next_attempt_at = clock_timestamp(), issue = $3
        WHERE kind = $1 AND id = $2 AND state <> 'complete'`, [work.kind, work.id, `redrive:${auditRef}`]);
      await tx.query(`INSERT INTO ${records.sql}.records (kind, id, revision, body) VALUES ('jobRedrives', $1, 1, $2)
        ON CONFLICT DO NOTHING`, [digest([work, auditRef]), JSON.stringify({ work, auditRef, at: new Date().toISOString() })]);
    }, options.timeouts);
    await repair();
  }

  const queue = Object.freeze<PaymentJobEnqueuer>({ namespace: transport.namespace, enqueue: (work, transaction) => transport.enqueue(work, transaction) });
  return { queue, start, repair, stop, drain, status, redrive };
}
export type PostgresPaymentJobs = ReturnType<typeof createPostgresPaymentJobs>;
