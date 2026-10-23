/** The Host owns cleanup ordering, never the lifetime of a borrowed database pool. */
import type { Payments } from '@agent-teams/payments-core';
import type { PostgresPaymentJobs, PaymentJobStopResult } from '@agent-teams/payments-postgres';

type PaymentLifetime = Pick<Payments, 'stop' | 'drain'>;
type JobLifetime = Pick<PostgresPaymentJobs, 'stop' | 'drain' | 'status'>;

export class PaymentHostCloseError extends AggregateError {
  readonly report: PaymentJobStopResult;
  constructor(errors: readonly unknown[], report: PaymentJobStopResult) {
    super(errors, 'Payment host cleanup failed');
    this.name = 'PaymentHostCloseError';
    this.report = report;
  }
}

async function closeHost(payments: PaymentLifetime, jobs: JobLifetime): Promise<PaymentJobStopResult> {
  const errors: unknown[] = [];
  try {payments.stop();} catch (error) {errors.push(error);}
  try {await jobs.stop();} catch (error) {errors.push(error);}
  // Both drains are admitted even when stopping or the other drain fails.
  const drains = await Promise.allSettled([
    Promise.resolve().then(() => jobs.drain()),
    Promise.resolve().then(() => payments.drain()),
  ]);
  for (const result of drains) {if (result.status === 'rejected') {errors.push(result.reason);}}
  const report = jobs.status();
  if (errors.length !== 0) {throw new PaymentHostCloseError(errors, report);}
  return report;
}

/** Concurrent close calls join one physical cleanup; failed cleanup remains retryable. */
export function createPaymentHostCloser(payments: PaymentLifetime, jobs: JobLifetime): () => Promise<PaymentJobStopResult> {
  let closing: Promise<PaymentJobStopResult> | undefined;
  return () => {
    closing ??= closeHost(payments, jobs).catch((error: unknown) => {closing = undefined; throw error;});
    return closing;
  };
}

/** Preserve the original construction failure as well as every failed cleanup. */
export async function failPaymentHostStartup(error: unknown, close: () => Promise<PaymentJobStopResult>): Promise<never> {
  let cleanupFailure: { error: unknown } | undefined;
  try {await close();}
  catch (cleanup) {cleanupFailure = { error: cleanup };}
  if (cleanupFailure !== undefined) {
    throw new AggregateError([error, cleanupFailure.error], 'Payment host startup and cleanup failed', { cause: error });
  }
  throw error;
}
