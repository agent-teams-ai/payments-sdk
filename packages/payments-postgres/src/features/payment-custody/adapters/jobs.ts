import {
  WorkIssue,
  isWork,
  aggregate,
  claimJobObligation,
  deliverJobObligation,
  reclassifyJobObligation,
  repairJobObligations,
} from "./job-obligation-operations.js";
import type { PaymentJobHandlers } from "./job-obligation-operations.js";
export type { PaymentDeliveryReceipt, PaymentJobHandlers } from "./job-obligation-operations.js";

import { canonicalJson, digest } from "@agent-teams/payments-core";
import type { PaymentSqlTransaction } from "./database.js";
import { withPaymentTransaction } from "./database.js";
import { reportPaymentJobError } from "./work-transport.js";
import type {
  PaymentJobEnqueuer,
  PaymentJobEvents,
  PaymentJobNamespace,
  PaymentJobTransport,
  PaymentJobWork,
} from "./work-transport.js";
import { assertBatchLimit, PaymentRecords } from "./records.js";

export type PaymentJobOptions = PaymentJobNamespace &
  PaymentJobEvents &
  Readonly<{
    transport: PaymentJobTransport;
    batchSize?: number;
    concurrency?: number;
    pollingIntervalSeconds?: number;
    maxAttempts?: number;
    cooldownSeconds?: number;
    maxCooldownSeconds?: number;
  }>;
export type PaymentJobStopResult = Readonly<{
  transportStopped: boolean;
  admittedHandlers: number;
  unresolvedExternalCalls: number;
  pendingCoreWork: number;
}>;

/** Host-only diagnostic context. Never persisted in payment evidence or queue payloads. */
export class PaymentJobHandlerError extends Error {
  readonly work: PaymentJobWork;
  readonly attempt: number;
  constructor(work: PaymentJobWork, attempt: number, cause: unknown) {
    super("Payment job handler failed", { cause });
    this.name = "PaymentJobHandlerError";
    this.work = Object.freeze({ kind: work.kind, id: work.id });
    this.attempt = attempt;
  }
}

function boundedInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid payment job ${label}`);
  }
  return value;
}

/** The runner owns admission and physical handler debt; it borrows transport and core. */
class PaymentJobRunner {
  private readonly options: PaymentJobOptions;
  private readonly records: PaymentRecords;
  private readonly transport: PaymentJobTransport;
  private readonly batch: number;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly cooldown: number;
  private readonly maxCooldown: number;
  private readonly poll: number;
  private handlers: PaymentJobHandlers | undefined;
  accepting = false;
  started = false;
  transportStopped = true;
  stopRequested = false;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private qualification: Promise<void> | undefined;
  private readonly active = new Set<Promise<unknown>>();
  constructor(options: PaymentJobOptions) {
    this.options = options;
    this.records = new PaymentRecords(options.paymentSchema);
    this.transport = options.transport;
    if (
      this.transport.namespace.paymentSchema !== options.paymentSchema ||
      canonicalJson(this.transport.namespace.scope) !== canonicalJson(options.scope)
    ) {
      throw new Error("Payment worker transport namespace mismatch");
    }
    this.batch = options.batchSize ?? 25;
    assertBatchLimit(this.batch);
    this.concurrency = boundedInteger(options.concurrency ?? 2, 1, 32, "concurrency");
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 8, 1, 100, "attempt bound");
    this.cooldown = boundedInteger(options.cooldownSeconds ?? 30, 1, 86_400, "cooldown");
    this.maxCooldown = boundedInteger(
      options.maxCooldownSeconds ?? 3_600,
      this.cooldown,
      604_800,
      "maximum cooldown",
    );
    this.poll = options.pollingIntervalSeconds ?? 1;
    if (!Number.isFinite(this.poll) || this.poll < 0.5 || this.poll > 60) {
      throw new RangeError("Invalid payment job polling interval");
    }
  }
  private qualify(): Promise<void> {
    this.qualification ??= this.transport.qualify().catch((error: unknown) => {
      this.qualification = undefined;
      throw error;
    });
    return this.qualification;
  }
  async repair(limit = this.batch): Promise<Readonly<{ enqueued: number }>> {
    assertBatchLimit(limit);
    await this.qualify();
    return repairJobObligations(
      limit,
      () => this.options,
      () => this.records,
      () => this.transport,
    );
  }
  private async claim(
    work: PaymentJobWork,
  ): Promise<Readonly<{ attempt: number; revision: string }> | undefined> {
    return claimJobObligation(
      work,
      () => this.options,
      () => this.records,
      () => this.maxCooldown,
    );
  }
  private async settle(
    work: PaymentJobWork,
    claimed: Readonly<{ attempt: number; revision: string }>,
    issue: WorkIssue | undefined,
    progress: boolean,
  ): Promise<void> {
    await withPaymentTransaction(
      this.options.database,
      async (tx) => {
        await this.records.configuration(tx, this.options.scope);
        const seconds = Math.min(
          this.maxCooldown,
          this.cooldown * 2 ** Math.min(claimed.attempt - 1, 20),
        );
        // T2/ACK may already have completed the obligation. Never reopen it or overwrite a later
        // claimant's outcome. The logical retry counter survives deletion of every queue job.
        await tx.query(
          `UPDATE ${this.records.sql}.obligations SET
        revision = revision + 1, state = CASE WHEN $8 THEN 'pending' WHEN $4 OR attempts >= $5 THEN 'quarantined' ELSE 'pending' END,
        attempts = CASE WHEN $8 THEN 0 ELSE attempts END,
        next_attempt_at = clock_timestamp() + $6 * interval '1 second', issue = $7
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND attempts = $3 AND revision = $9`,
          [
            work.kind,
            work.id,
            claimed.attempt,
            issue?.quarantine ?? false,
            this.maxAttempts,
            progress ? this.cooldown : seconds,
            progress ? null : (issue?.issue ?? "work_remains_pending"),
            progress,
            claimed.revision,
          ],
        );
      },
      this.options.timeouts,
    );
  }
  private async deliver(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    return deliverJobObligation(
      work,
      installed,
      () => this.options,
      () => this.records,
      () => this.batch,
    );
  }
  private run(work: PaymentJobWork, installed: PaymentJobHandlers): Promise<boolean> {
    switch (work.kind) {
      case "inbox":
        return this.processInbox(work.id, installed);
      case "reclassification":
        return this.reclassify(work.id, installed);
      case "publication":
        return this.publish(work.id, installed);
      case "prepared":
        return this.executePrepared(work.id, installed);
      case "unknown":
        return this.inspectUncertain(work.id, installed);
      case "scan":
        return this.resumeScan(work.id, installed);
      case "delivery":
        return this.deliver(work, installed);
    }
  }
  private async processInbox(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    const result = await installed.payments.processInbox(id);
    if (result === "missing") {
      throw new WorkIssue("missing_inbox_authority", true);
    }
    if (result === "conflict" || result === "recovery_fenced") {
      throw new WorkIssue(result);
    }
    return false;
  }
  private async reclassify(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    return reclassifyJobObligation(
      id,
      installed,
      () => this.options,
      () => this.records,
      () => this.batch,
    );
  }
  private async publish(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    const result = await installed.payments.flushPublication(aggregate(id));
    if (result === "missing") {
      throw new WorkIssue("missing_publication_authority", true);
    }
    if (result === "conflict" || result === "recovery_fenced") {
      throw new WorkIssue(result);
    }
    return false;
  }
  private async executePrepared(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    // A queue payload never authorizes dispatch. Re-read its durable marker.
    const operation = await installed.payments.readOperation(id);
    if (!operation) {
      throw new WorkIssue("missing_operation_authority", true);
    }
    if (operation.state === "prepared") {
      await installed.payments.executeOperation(id);
    }
    return false;
  }
  private async inspectUncertain(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    const operation = await installed.payments.readOperation(id);
    if (!operation) {
      throw new WorkIssue("missing_operation_authority", true);
    }
    if (operation.state !== "dispatch_started" && operation.state !== "outcome_unknown") {
      return false;
    }
    if (
      !installed.inspectUnknown ||
      (await installed.inspectUnknown(structuredClone(operation))) === "review"
    ) {
      throw new WorkIssue("unknown_requires_manual_review", true);
    }
    return false;
  }
  private async resumeScan(id: string, installed: PaymentJobHandlers): Promise<boolean> {
    const checkpoint = await installed.store.readCheckpoint(this.options.scope, id);
    if (!checkpoint) {
      throw new WorkIssue("missing_scan_authority", true);
    }
    if (checkpoint.status === "complete") {
      return false;
    }
    if (!installed.resumeScan) {
      throw new WorkIssue("scan_requires_manual_review", true);
    }
    await installed.resumeScan(structuredClone(checkpoint));
    return (
      canonicalJson((await installed.store.readCheckpoint(this.options.scope, id)) ?? null) !==
      canonicalJson(checkpoint)
    );
  }
  private async handle(payload: unknown): Promise<void> {
    if (!this.accepting || !this.handlers) {
      return;
    }
    if (!isWork(payload)) {
      throw new WorkIssue("invalid_job_payload", true);
    }
    const work = payload,
      installed = this.handlers;
    const attempt = await this.claim(work);
    if (attempt === undefined) {
      return;
    }
    let issue: WorkIssue | undefined;
    let failure: PaymentJobHandlerError | undefined;
    let progress = false;
    try {
      progress = await this.run(work, installed);
    } catch (error) {
      issue = error instanceof WorkIssue ? error : new WorkIssue("handler_failed");
      if (!(error instanceof WorkIssue)) {
        failure = new PaymentJobHandlerError(work, attempt.attempt, error);
      }
    }
    try {
      await this.settle(work, attempt, issue, progress);
    } finally {
      if (failure) {
        reportPaymentJobError(this.options, failure);
      }
    }
  }
  private admitted(operation: () => Promise<unknown>): Promise<unknown> {
    if (!this.accepting) {
      return Promise.resolve();
    }
    const task = operation();
    this.active.add(task);
    void task.finally(() => this.active.delete(task)).catch(() => {});
    return task;
  }
  async start(installed: PaymentJobHandlers): Promise<void> {
    if (this.starting) {
      return this.starting;
    }
    if (this.started) {
      throw new Error("Payment job workers are already started");
    }
    if (this.stopping || this.stopRequested) {
      throw new Error("Payment job workers are stopping");
    }
    if (canonicalJson(installed.payments.scope) !== canonicalJson(this.options.scope)) {
      throw new Error("Payment worker scope mismatch");
    }
    this.starting = (async () => {
      try {
        await this.qualify();
        this.handlers = installed;
        this.transportStopped = false;
        await this.repair();
        if (this.isStopRequested()) {
          return;
        }
        this.accepting = true;
        await this.transport.start(
          {
            work: async (payload) => {
              await this.admitted(() => this.handle(payload));
            },
            repair: async () => {
              await this.admitted(async () => {
                await this.repair();
              });
            },
          },
          { concurrency: this.concurrency, pollingIntervalSeconds: this.poll },
        );
        this.started = true;
      } catch (error) {
        this.accepting = false;
        // A worker may already have admitted an SDK call before a later registration fails.
        // Keep its core lifecycle reachable through status/drain, and make this instance
        // terminal rather than allowing a second installation to replace that ownership.
        if (this.handlers) {
          this.stopRequested = true;
        }
        await this.transport.stop(30_000);
        this.transportStopped = true;
        throw error;
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }
  private isStopRequested(): boolean {
    return this.stopRequested;
  }
  status(): PaymentJobStopResult {
    const lifecycle = this.handlers?.payments.lifecycle();
    return {
      transportStopped: this.transportStopped,
      admittedHandlers: this.active.size,
      unresolvedExternalCalls: lifecycle?.unresolvedExternalCalls ?? 0,
      pendingCoreWork: lifecycle?.pendingWork ?? 0,
    };
  }
  async stop(timeoutMs = 30_000): Promise<PaymentJobStopResult> {
    boundedInteger(timeoutMs, 1, 300_000, "shutdown timeout");
    this.stopRequested = true;
    this.accepting = false;
    if (!this.stopping) {
      const attempt = (async () => {
        if (this.starting) {
          await this.starting.catch(() => {});
        }
        this.accepting = false;
        await this.transport.stop(timeoutMs);
        this.transportStopped = true;
        this.started = false;
      })();
      this.stopping = attempt;
      void attempt.catch((error: unknown) => {
        // Admission stays closed and transportStopped stays false. The owner can retry cleanup;
        // a rejected cached attempt must not make all subsequent stop calls permanently fail.
        if (this.stopping === attempt) {
          this.stopping = undefined;
        }
        reportPaymentJobError(
          this.options,
          error instanceof Error
            ? error
            : new Error("Payment job shutdown failed", { cause: error }),
        );
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.stopping,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      return this.status();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  async drain(): Promise<PaymentJobStopResult> {
    if (this.stopping) {
      await this.stopping.catch(() => {});
    }
    while (this.active.size) {
      await Promise.allSettled(this.active);
    }
    await this.handlers?.payments.drain();
    return this.status();
  }
  /** Explicit operator redrive. It clears logical cooldown/quarantine with an audit reference. */
  async redrive(work: PaymentJobWork, auditRef: string): Promise<void> {
    if (!isWork(work) || !auditRef || auditRef.length > 512) {
      throw new TypeError("Payment job redrive requires a valid work identity and audit reference");
    }
    await this.qualify();
    await withPaymentTransaction(
      this.options.database,
      async (tx) => {
        if ((await this.records.configuration(tx, this.options.scope)).body.recoveryFenced) {
          throw new Error("Payment recovery is fenced");
        }
        await tx.query(
          `UPDATE ${this.records.sql}.obligations SET state = 'pending', attempts = 0, revision = revision + 1, next_attempt_at = clock_timestamp(), issue = $3
        WHERE kind = $1 AND id = $2 AND state <> 'complete'`,
          [work.kind, work.id, `redrive:${auditRef}`],
        );
        await tx.query(
          `INSERT INTO ${this.records.sql}.records (kind, id, revision, body) VALUES ('jobRedrives', $1, 1, $2)
        ON CONFLICT DO NOTHING`,
          [
            digest([work, auditRef]),
            JSON.stringify({ work, auditRef, at: new Date().toISOString() }),
          ],
        );
      },
      this.options.timeouts,
    );
    await this.repair();
  }
}
/** Construction has no I/O, timers or workers. Host calls start and stop explicitly. */
export function createPostgresPaymentJobs(options: PaymentJobOptions) {
  const runner = new PaymentJobRunner(options);
  const transport = options.transport;
  const queue: Readonly<PaymentJobEnqueuer> = Object.freeze({
    namespace: transport.namespace,
    enqueue: (work: PaymentJobWork, transaction: PaymentSqlTransaction) =>
      transport.enqueue(work, transaction),
  });
  return {
    queue,
    start: (handlers: PaymentJobHandlers) => runner.start(handlers),
    repair: (limit?: number) => runner.repair(limit),
    stop: (timeoutMs?: number) => runner.stop(timeoutMs),
    drain: () => runner.drain(),
    status: () => runner.status(),
    redrive: (work: PaymentJobWork, auditRef: string) => runner.redrive(work, auditRef),
  };
}

export type PostgresPaymentJobs = ReturnType<typeof createPostgresPaymentJobs>;
