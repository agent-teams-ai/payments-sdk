import type { PaymentScope } from "@agent-teams/payments-core";
import type {
  DatabaseTimeouts,
  PaymentPostgresDatabase,
  PaymentSqlTransaction,
} from "./database.js";
/** A wake-up identity. Payment records, never a transport payload, authorize the work. */
export type PaymentJobWork = Readonly<{
  kind: "inbox" | "publication" | "reclassification" | "prepared" | "unknown" | "delivery" | "scan";
  id: string;
}>;
export type PaymentJobNamespace = Readonly<{
  database: PaymentPostgresDatabase;
  paymentSchema: string;
  scope: PaymentScope;
  timeouts?: DatabaseTimeouts;
}>;
export type PaymentJobEvents = Readonly<{ onError: (error: Error) => void }>;

/** Infrastructure-only same-transaction admission. Use only the supplied bounded executor;
 * do not retain it, acquire another connection, COMMIT, or perform external I/O. Resolves true
 * for a new runnable wake-up, false when an equivalent runnable wake-up already exists.
 * Failure rejects the enclosing payment transaction; success is neither T2 nor consumer T3. */
export interface PaymentJobEnqueuer {
  readonly namespace: Readonly<{ paymentSchema: string; scope: PaymentScope }>;
  enqueue: (work: PaymentJobWork, transaction: PaymentSqlTransaction) => Promise<boolean>;
}

/** Trusted PostgreSQL expression, with local $1…$n parameters. This is infrastructure code,
 * never request input. It must test runnable wake-ups only, without reading payment records.
 * The runner applies it before LIMIT so queued older work cannot starve a later obligation. */
export type PaymentPendingWorkSql = Readonly<{ text: string; values: readonly unknown[] }>;
export type PaymentJobTransportHandlers = Readonly<{
  work: (payload: unknown) => Promise<void>;
  repair: () => Promise<void>;
}>;
export type PaymentJobWorkerOptions = Readonly<{
  concurrency: number;
  pollingIntervalSeconds: number;
}>;

/** PostgreSQL transactional wake-up transport. No SQL or transport object enters core.
 * Construction is inert. start may admit callbacks before it settles. A successful stop closes
 * transport admission even after partial startup; rejection leaves transport cleanup unresolved.
 * Stop preserves the host pool and does not establish physical handler/provider drain.
 * The runner separately tracks admitted handlers and the core's unresolved external calls.
 * Remote broker dual-writes do not implement this contract. */
export interface PaymentJobTransport extends PaymentJobEnqueuer {
  pendingWorkSql: (kindExpression: string, idExpression: string) => PaymentPendingWorkSql;
  qualify: () => Promise<void>;
  start: (handlers: PaymentJobTransportHandlers, options: PaymentJobWorkerOptions) => Promise<void>;
  stop: (timeoutMs: number) => Promise<void>;
}

/** Diagnostics cannot change durable work settlement or create an unhandled rejection. */
export function reportPaymentJobError(events: PaymentJobEvents, error: Error): void {
  try {
    const sink: Readonly<{ onError: (error: Error) => unknown }> = events;
    const report = sink.onError(error);
    void Promise.resolve(report).catch(() => {});
  } catch {
    /* The host owns its diagnostic sink; never recursively report a sink failure. */
  }
}
