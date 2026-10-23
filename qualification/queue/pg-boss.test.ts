import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createPayments, digest } from '@agent-teams/payments-core';
import type { OfferSnapshot, PaymentScope } from '@agent-teams/payments-core';
import type { PaymentOperation } from '@agent-teams/payments-core/store';
import type { PaymentProvider } from '@agent-teams/payments-core/provider';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';
import { createPostgresPaymentJobs, createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import { createPgBossPaymentTransport } from '@agent-teams/payments-postgres/pg-boss';

/** Runs from production-only installed archives, with the host explicitly selecting pg-boss. */
void test('the optional pg-boss entrypoint bootstraps, dispatches prepared work and drains on a borrowed pool', { timeout: 30_000 }, async () => {
  const connectionString = process.env['DATABASE_URL'];
  assert.ok(connectionString !== undefined && connectionString !== '', 'Packed pg-boss qualification requires disposable PostgreSQL18');
  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), paymentSchema = `packed_pay_${suffix}`, jobSchema = `packed_job_${suffix}`;
  const scope: PaymentScope = { applicationId: 'packed-queue', provider: 'fixture', paymentAccountId: 'merchant', environment: 'sandbox' };
  const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'topup', version: '1', policyVersion: '1', profile: 'one_time', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'purchased', quantity: 1 }] };
  const errors: Error[] = [], dispatched = Promise.withResolvers<void>();
  let calls = 0;
  const provider: PaymentProvider = {
    scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: async command => {
      calls += 1; assert.equal(command.intentId, 'packed-purchase'); dispatched.resolve();
      return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'packed-transaction', checkout: {} } };
    },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture' }),
    readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture' }),
  };
  const namespace = { database, paymentSchema, jobSchema, scope, onError: (error: Error) => { errors.push(error); } };
  const transport = createPgBossPaymentTransport(namespace);
  const jobs = createPostgresPaymentJobs({ ...namespace, transport, pollingIntervalSeconds: 0.5 });
  let payments: ReturnType<typeof createPayments> | undefined;
  try {
    await migratePaymentSchema({ database, schema: paymentSchema, scope });
    await transport.bootstrap();
    const store = await createPostgresPaymentStore({ database, schema: paymentSchema, scope, queue: jobs.queue });
    payments = createPayments({ scope, producerNamespace: 'packed-queue/1', provider, store, catalog: { resolveOffer: async () => offer } });
    const operation: PaymentOperation = { operationId: 'packed-operation', kind: 'purchase', buyerId: 'buyer', requestKey: 'purchase', fingerprint: digest(['purchase', 'buyer', 'topup']), intentId: 'packed-purchase', revision: 1, state: 'prepared', attempts: [], audits: [] };
    assert.equal((await store.admitIntent(scope, { operation, intent: { intentId: 'packed-purchase', buyerId: 'buyer', requestKey: 'purchase', fingerprint: operation.fingerprint, offer, operationId: operation.operationId, transactionRefs: [], createdAt: '2026-10-01T00:00:00Z' } })).kind, 'created');
    await jobs.start({ payments, store });
    await dispatched.promise;
    await jobs.stop(); await jobs.drain();
    assert.equal((await payments.readOperation(operation.operationId))?.state, 'succeeded');
    assert.equal(calls, 1); assert.deepEqual(errors, []);
    assert.equal((await pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
  } finally {
    payments?.stop(); await jobs.stop(); await jobs.drain(); await payments?.drain();
    await pool.query(`DROP SCHEMA IF EXISTS "${jobSchema}" CASCADE; DROP SCHEMA IF EXISTS "${paymentSchema}" CASCADE`);
    await pool.end();
  }
});
