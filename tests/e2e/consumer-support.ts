import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { AdjustmentObservation, CompletionFact, EvidenceMessage, OfferSnapshot, PaymentScope, SubscriptionBinding } from '@agent-teams/payments-core';
import { AccessFixture, CreditFixture, hash, signFixtureMessage } from '../fixtures/consumers/index.ts';

export const scope: PaymentScope = { applicationId: 'app-a', provider: 'paddle', paymentAccountId: 'merchant-fixture', environment: 'sandbox' };
export const producerNamespace = 'payments-test-owner-v1';
export const period = { startsAt: '2026-10-01T00:00:00.123456Z', endsAt: '2026-11-01T00:00:00.123456Z' };
export const nextPeriod = { startsAt: period.endsAt, endsAt: '2026-12-01T00:00:00.123456Z' };
export const offer: OfferSnapshot = { applicationId: 'app-a', offerId: 'monthly', version: 'offer-v1', policyVersion: 'catalog-policy-v1', profile: 'monthly', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: 'pri_01j00000000000000000000001', benefitSlotId: 'included', quantity: 1 }] };
export const source = { kind: 'authenticated_api' as const, receiptId: 'source-api', representationDigest: hash('source-api'), decoderVersion: 'test/1', apiProfile: 'paddle-billing-api-1' };
export function fact(options: Partial<CompletionFact> = {}): CompletionFact {
  return { factId: 'completion-A', scope, transactionRef: 'transaction-A', buyerId: 'buyer-a', intentId: 'intent-a', subscriptionBasisId: 'binding-a', providerSubscriptionRef: 'subscription-A', classification: 'initial', offer, total: { currency: 'USD', minorUnits: '1000' }, lines: [{ providerLineRef: 'line-A', benefitSlotId: 'included', amount: { currency: 'USD', minorUnits: '1000' }, quantity: 1, period }], source, ...options };
}
export function message(revision: number, completion: CompletionFact = fact(), adjustments: readonly AdjustmentObservation[] = [], flags: readonly ('pending_adverse' | 'unsupported')[] = []): EvidenceMessage {
  const aggregate = { type: 'transaction' as const, id: completion.transactionRef };
  return signFixtureMessage({ envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope: completion.scope, aggregate, revision, messageId: hash([producerNamespace, completion.scope, aggregate, revision]), kind: 'complete' as const, completion, adjustments, flags });
}
export function held(revision: number, previous: EvidenceMessage): EvidenceMessage {
  const { scope: messageScope, aggregate } = previous;
  return signFixtureMessage({ envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope: messageScope, aggregate, revision, messageId: hash([producerNamespace, messageScope, aggregate, revision]), kind: 'held' as const, reason: 'evidence_size_limit', resolutionRef: 'held-resolution' });
}
export function adjustment(options: Partial<AdjustmentObservation> = {}): AdjustmentObservation {
  return { kind: 'adjustment', adjustmentRef: 'refund-A', transactionRef: 'transaction-A', version: '2026-10-02T00:00:00.000001Z', action: 'refund', status: 'approved', type: 'full', amount: { currency: 'USD', minorUnits: '1000' }, allocations: [{ providerLineRef: 'line-A', type: 'full', amount: { currency: 'USD', minorUnits: '1000' } }], source, ...options };
}
export function subscription(revision: number, options: Readonly<{ status?: string; scheduled?: boolean; unknown?: boolean }> = {}): EvidenceMessage {
  const aggregate = { type: 'subscription' as const, id: 'subscription-A' };
  const binding: SubscriptionBinding = { bindingId: 'binding-a', buyerId: 'buyer-a', originatingIntentId: 'intent-a', offer, providerSubscriptionRefs: ['subscription-A'], selectedSubscriptionRef: 'subscription-A', customerRef: 'customer' };
  return signFixtureMessage({ envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope, aggregate, revision, messageId: hash([producerNamespace, scope, aggregate, revision]), kind: 'subscription_complete' as const, binding, observation: { kind: 'subscription' as const, subscriptionRef: 'subscription-A', version: `2026-10-${String(revision).padStart(2, '0')}T00:00:00Z`, status: options.unknown ? { presence: 'unknown' as const } : { presence: 'known' as const, value: options.status ?? 'active' }, customerRef: { presence: 'known' as const, value: 'customer' }, scheduledChange: options.unknown ? { presence: 'unknown' as const } : { presence: 'known' as const, value: options.scheduled ? { action: 'cancel', effectiveAt: period.endsAt } : null }, currentPeriod: { presence: 'known' as const, value: options.status === 'canceled' ? null : period }, priceRefs: { presence: 'known' as const, value: [offer.lines[0]!.providerPriceRef] }, source }, flags: [] });
}
export async function consumers() {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is mandatory: consumer E2E requires a real durable PostgreSQL18 instance');
  // Deliberately weak inherited session profile: every consumer T3 must override it locally.
  const pool = new Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 1000, options: '-c synchronous_commit=off' });
  const prefix = `consumer_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let now = '2026-10-15T00:00:00Z';
  const trust = { producerNamespace, scope };
  const credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
  const access = new AccessFixture({ pool, schema: `${prefix}_access`, trust, now: () => now });
  await credit.migrate(); await access.migrate();
  return { pool, credit, access, trust, setNow: (time: string) => { now = time; }, async close() { await pool.query(`DROP SCHEMA ${credit.owner.sql} CASCADE; DROP SCHEMA ${access.owner.sql} CASCADE`); await pool.end(); } };
}
