import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { canonicalJson, createPayments, digest, money } from '@agent-teams/payments-core';
import type { Field, JsonValue, Observation, OfferSnapshot, OperationResult, PaymentScope, SubscriptionObservation, TransactionObservation, VerifiedInput } from '@agent-teams/payments-core';
import type { PaymentProvider, ProviderResult } from '@agent-teams/payments-core/provider';
import type { PaymentStore } from '@agent-teams/payments-core/store';
import { createNodePostgresPaymentDatabase } from '../adapters/node-postgres.js';
import { createPostgresPaymentStore } from '../adapters/store.js';
import { migratePaymentSchema } from '../adapters/migrations.js';
import assert from 'node:assert/strict';

export const scope: PaymentScope = { applicationId: 'database-proof', provider: 'fixture', paymentAccountId: 'fixture-merchant', environment: 'sandbox' };
export const at = '2026-01-01T00:00:00.000001Z';
export const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' };
export const known = <T>(value: T): Field<T> => ({ presence: 'known', value });
export const unknown = { presence: 'unknown' } as const;
export const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'monthly', version: '1', policyVersion: '1', profile: 'monthly', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'slot', quantity: 1 }] };

export function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let complete!: (value: T) => void;
  const promise = new Promise<T>(resolve => { complete = resolve; });
  return { promise, resolve: complete };
}

export function receipt(observation: Observation, extra: Partial<VerifiedInput> = {}): VerifiedInput {
  const { source: original, ...projection } = observation;
  const retainedRepresentation: JsonValue = { representationKind: 'fixture_mapped', projection: JSON.parse(canonicalJson(projection)) as JsonValue };
  const source = { ...original, representationDigest: digest(retainedRepresentation) };
  return { scope, inputId: source.receiptId, source, observation: { ...observation, source }, retainedRepresentation, ...extra };
}

export function transaction(transactionRef: string, receiptId: string, extra: Partial<TransactionObservation> = {}): TransactionObservation {
  return { kind: 'transaction', transactionRef, version: at, status: 'completed', statusMeaning: { kind: 'completed' }, origin: known('api'), customerRef: known('customer'), subscriptionRef: known('sub-a'), intentCorrelation: unknown, currency: known('USD'), total: known(money('USD', '1000')), lines: known([{ providerLineRef: `line-${transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known({ interval: 'month', frequency: 1 }), trial: known(false), proration: known(false), period: known(period) }]), source: { kind: 'authenticated_api', receiptId, representationDigest: '', apiProfile: 'fixture-v1', decoderVersion: '1' }, ...extra };
}

export function subscription(ref: string, receiptId = `authority-${ref}`): SubscriptionObservation {
  return { kind: 'subscription', subscriptionRef: ref, version: at, status: known('active'), customerRef: known('customer'), scheduledChange: known(null), currentPeriod: known(period), collection: known({ kind: 'automatic' }), items: known([{ providerPriceRef: 'price', quantity: known(1), billingCycle: known({ interval: 'month', frequency: 1 }), trial: known(false) }]), source: { kind: 'authenticated_api', receiptId, representationDigest: '', apiProfile: 'fixture-v1', decoderVersion: '1' } };
}

export function runtime(store: PaymentStore, timeoutMs = 1000) {
  let id = 0, calls = 0;
  const provider: PaymentProvider = {
    scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: ['now', 'period_end'], paymentUpdate: true, customerManagement: false },
    createCheckout: async command => { calls += 1; return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${calls}`, checkout: {} } }; },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture-read' }),
    readSubscription: async ref => ({ kind: 'succeeded', value: subscription(ref) }),
    readSubscriptionInput: async ref => ({ kind: 'succeeded', value: receipt(subscription(ref)) }),
  };
  const payments = createPayments({ scope, producerNamespace: 'database-fixture', provider, store, catalog: { resolveOffer: async () => offer }, newId: () => `id-${++id}`, now: () => at, operationTimeoutMs: timeoutMs });
  return { payments, provider, calls: () => calls };
}

export async function databaseFixture(options: { maxWorkingSetBytes?: number } = {}) {
  const connectionString = process.env['DATABASE_URL'];
  assert.ok((connectionString !== undefined && connectionString !== ''), 'DATABASE_URL is required for PostgreSQL qualification');
  const schema = `pgproof_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  await migratePaymentSchema({ database, schema, scope });
  const store = await createPostgresPaymentStore({ database, schema, scope, ...options });
  return { pool, database, schema, store, connectionString, async close() { await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); } };
}

export async function observe(payments: ReturnType<typeof runtime>['payments'], input: VerifiedInput): Promise<void> {
  assert.equal((await payments.ingestVerifiedInput(input)).kind, 'succeeded');
  assert.equal(await payments.processInbox(input.inputId), 'processed');
}

export function success<T>(value: ProviderResult<T> | OperationResult<T>): T {
  assert.equal(value.kind, 'succeeded');
  return value.value;
}
