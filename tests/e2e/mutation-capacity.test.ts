import assert from 'node:assert/strict';
import test from 'node:test';
import { createPayments } from '@agent-teams/payments-core';
import type { CheckoutReady, PaymentRuntimeOptions } from '@agent-teams/payments-core';
import type { PaymentProvider, ProviderResult } from '@agent-teams/payments-core/provider';
import { createPostgresPaymentJobs, createPostgresPaymentStore } from '@agent-teams/payments-postgres';
import { databaseFixture, offer, scope } from '@agent-teams/payments-postgres/testing';
import { sqlWakeupFixture } from './queue-transport-fixture.ts';

void test('real SQL worker preserves retry budget while physical provider capacity is occupied', { timeout: 30_000 }, async () => {
  const f = await databaseFixture();
  const wakeSchema = `${f.schema}_w`;
  const wakeups = sqlWakeupFixture({ pool: f.pool, paymentSchema: f.schema, schema: wakeSchema, scope });
  await wakeups.bootstrap();
  const errors: Error[] = [];
  const jobs = createPostgresPaymentJobs({ database: f.database, paymentSchema: f.schema, scope, transport: wakeups.transport, maxAttempts: 1, pollingIntervalSeconds: 0.5, onError: error => {errors.push(error);} });
  const store = await createPostgresPaymentStore({ database: f.database, schema: f.schema, scope, queue: jobs.queue });
  const firstEntered = Promise.withResolvers<void>(), release = Promise.withResolvers<ProviderResult<CheckoutReady>>();
  let calls = 0, firstIntent = '';
  const provider: PaymentProvider = {
    scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: async command => {
      calls += 1;
      if (calls === 1) {firstIntent = command.intentId; firstEntered.resolve(); return release.promise;}
      return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${command.intentId}`, checkout: {} } };
    },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture' }),
    readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture' }),
  };
  const options: PaymentRuntimeOptions = { scope, store, provider, producerNamespace: 'capacity-test', catalog: { resolveOffer: async () => ({ ...offer, profile: 'one_time' }) }, maxConcurrentMutations: 1, operationTimeoutMs: 1_000 };
  const payments = createPayments(options);
  try {
    const firstCall = payments.startPurchase({ buyerId: 'buyer', offerId: offer.offerId, requestKey: 'first' });
    await firstEntered.promise;
    assert.equal((await firstCall).kind, 'outcome_unknown');
    const waiting = await payments.startPurchase({ buyerId: 'buyer', offerId: offer.offerId, requestKey: 'waiting' });
    assert.equal(waiting.kind, 'deferred');
    await jobs.start({ payments, store });
    for (let turn = 0; turn < 3; turn += 1) {
      await f.pool.query(`UPDATE "${f.schema}".obligations SET next_attempt_at = clock_timestamp() WHERE kind = 'prepared' AND id = $1`, [waiting.operationId]);
      await jobs.repair();
      const pumped = await wakeups.pump('prepared'); assert.equal(pumped?.id, waiting.operationId);
      const work = (await f.pool.query<{ attempts: number; state: string; issue: string }>(`SELECT attempts, state, issue FROM "${f.schema}".obligations WHERE kind = 'prepared' AND id = $1`, [waiting.operationId])).rows[0];
      assert.deepEqual(work, { attempts: 0, state: 'pending', issue: 'mutation_capacity' });
      assert.equal((await payments.inspectOperation(waiting.operationId))?.attempts.length, 0);
    }
    assert.equal(calls, 1);
    release.resolve({ kind: 'succeeded', value: { intentId: firstIntent, transactionRef: 'tx-first', checkout: {} } });
    await payments.drain();
    await f.pool.query(`UPDATE "${f.schema}".obligations SET next_attempt_at = clock_timestamp() WHERE kind = 'prepared' AND id = $1`, [waiting.operationId]);
    await jobs.repair(); await wakeups.pump('prepared');
    assert.equal((await payments.inspectOperation(waiting.operationId))?.state, 'succeeded');
    assert.equal(calls, 2); assert.deepEqual(errors, []);
  } finally {
    release.resolve({ kind: 'outcome_unknown' });
    payments.stop(); await jobs.stop(); await jobs.drain(); await payments.drain();
    await f.pool.query(`DROP SCHEMA "${wakeSchema}" CASCADE`); await f.close();
  }
});
