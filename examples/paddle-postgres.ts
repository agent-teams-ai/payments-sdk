/** Durable Fetch composition. Host provides authentication, policies, T3 consumers and pools. */
import type { Pool } from 'pg';
import { createPayments } from '@agent-teams/payments-core';
import type { Catalog, PaymentScope } from '@agent-teams/payments-core';
import { createPaddleProvider } from '@agent-teams/payments-paddle';
import type { PaddleProviderOptions } from '@agent-teams/payments-paddle';
import { createPgBossPaymentTransport, createPostgresPaymentJobs, createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import type { PaymentJobHandlers } from '@agent-teams/payments-postgres';
import { handlePaymentRequest } from './node-http.ts';

export type PaymentHostNamespace = Readonly<{
  pool: Pool; paymentSchema: string; jobSchema: string; scope: PaymentScope; onError: (error: Error) => void;
}>;
export type PaddlePostgresHostOptions = PaymentHostNamespace & Readonly<{
  producerNamespace: string;
  paddle: Omit<PaddleProviderOptions, 'scope'>;
  catalog: Catalog;
  authenticate: (request: Request) => Promise<string | undefined>;
  /** Resolve only after the independent owner's receipt + effect/pending obligation commits. */
  consumers: NonNullable<PaymentJobHandlers['consumers']>;
  inspectUnknown?: PaymentJobHandlers['inspectUnknown'];
  resumeScan?: PaymentJobHandlers['resumeScan'];
}>;

/** Use a migration-role pool. Do not invoke bootstrap from request handlers or runtime startup. */
export async function bootstrapPaymentHost(namespace: PaymentHostNamespace): Promise<void> {
  await migratePaymentSchema({ pool: namespace.pool, schema: namespace.paymentSchema, scope: namespace.scope });
  await createPgBossPaymentTransport(namespace).bootstrap();
}

export async function createPaddlePostgresHost(options: PaddlePostgresHostOptions) {
  const provider = createPaddleProvider({ ...options.paddle, scope: options.scope });
  const transport = createPgBossPaymentTransport(options);
  const jobs = createPostgresPaymentJobs({ ...options, transport });
  const store = await createPostgresPaymentStore({ pool: options.pool, schema: options.paymentSchema, scope: options.scope, queue: jobs.queue });
  const payments = createPayments({ scope: options.scope, producerNamespace: options.producerNamespace, provider, store, catalog: options.catalog });
  try {
    for (const consumerId of Object.keys(options.consumers)) {await payments.registerConsumer(consumerId);}
    await jobs.start({ payments, store, consumers: options.consumers,
      ...(options.inspectUnknown === undefined ? {} : { inspectUnknown: options.inspectUnknown }),
      ...(options.resumeScan === undefined ? {} : { resumeScan: options.resumeScan }),
    });
  } catch (error) {
    payments.stop();
    await jobs.stop();
    await jobs.drain();
    await payments.drain();
    throw error;
  }
  return {
    payments,
    jobs,
    handle: (request: Request) => handlePaymentRequest(request, payments, provider.verifyWebhook.bind(provider), options.authenticate),
    // First stop the host's HTTP ingress/producers; retain the borrowed pool during physical drain.
    async close() {
      payments.stop();
      await jobs.stop();
      await jobs.drain();
      await payments.drain();
      return jobs.status();
    },
  };
}
