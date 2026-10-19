import { createHash } from 'node:crypto';
import { Paddle, Environment, LogLevel, SDK_VERSION } from '@paddle/paddle-node-sdk';
import type { IEventName, CurrencyCode } from '@paddle/paddle-node-sdk';
import { assertIdentifier, assertScope, canonicalJson, compareTime, digest, exactTime, sameScope } from '@agent-teams/payments-core';
import type { CancellationOutcome, CapabilityProfile, CheckoutReady, EvidenceSource, JsonValue, Observation, OfferSnapshot, PaymentProvider, PaymentScope, PaymentUpdateReady, ProviderResult, SubscriptionObservation, TransactionObservation, VerifiedInput } from '@agent-teams/payments-core';
import { normalizeObservation, subscriptionObservation, transactionObservation } from './observations.js';
import { translatePaddleError } from './errors.js';

export const PADDLE_API_PROFILE = 'paddle-billing-api-1';
export const PADDLE_DECODER_VERSION = 'paddle-supported-profile/2';
export type PaddleProviderOptions = Readonly<{
  scope: PaymentScope; apiKey: string; apiVersion: 1;
  webhook?: Readonly<{ endpointId: string; secret: string; apiVersion: 1 }>;
  /** The host must establish authority over the entire provider customer account. */
  authorizeCustomerManagement?: (input: Readonly<{ scope: PaymentScope; customerRef: string; subscriptionRefs: readonly string[] }>) => Promise<boolean>;
}>;
export type PaddleEventScanQuery = Readonly<{ from: string; to: string; after?: string; eventTypes?: readonly string[]; perPage?: number; epoch: string; queryVersion: string }>;
export type PaddleEventScanResult = Readonly<{ kind: 'page'; inputs: readonly VerifiedInput[]; hasMore: boolean; lastEventId?: string }> | Readonly<{ kind: 'gap'; reason: string; query: PaddleEventScanQuery; sdkVersion: string; code?: string }>;
export type PaddleAdjustmentPage = Readonly<{ inputs: readonly VerifiedInput[]; adjustmentIds: readonly string[]; hasMore: boolean; lastAdjustmentId?: string }>;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected object'); return value as ObjectValue; }
function string(value: unknown): string { if (typeof value !== 'string' || value.length === 0) throw new TypeError('Expected string'); return value; }
function providerId(value: unknown, prefix: string): string { const result = string(value); if (!new RegExp(`^${prefix}_[0-9a-z]{26}$`, 'u').test(result)) throw new TypeError('Invalid Paddle identifier'); return result; }
function json(value: unknown): JsonValue { return JSON.parse(canonicalJson(value)) as JsonValue; }
function rawDigest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function httpsUrl(value: unknown): string { const result = string(value), parsed = new URL(result); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new TypeError('Invalid provider URL'); return result; }
function placeholderSource(query?: JsonValue): EvidenceSource {
  return { kind: 'authenticated_api', receiptId: '', representationDigest: '', decoderVersion: PADDLE_DECODER_VERSION, sdkVersion: SDK_VERSION, apiProfile: PADDLE_API_PROFILE, ...(query === undefined ? {} : { query }) };
}
function apiReceipt(observation: Observation, scope: PaymentScope, mappedDiagnostic: unknown): VerifiedInput {
  // Only the validated neutral projection is policy input. The diagnostic is explicitly
  // SDK-mapped/lossy JSON, never an SDK class instance or original provider wire body.
  const { source: original, ...projection } = observation;
  const representation = json({ representationKind: 'sdk_mapped_observation', sdkVersion: SDK_VERSION, decoderVersion: PADDLE_DECODER_VERSION, projection, diagnostic: mappedDiagnostic });
  const representationDigest = digest(representation);
  const receiptId = digest([scope, 'mapped-api-observation', original.eventId ?? null, original.query ?? null, representationDigest, PADDLE_DECODER_VERSION]);
  const source: EvidenceSource = { ...original, receiptId, representationDigest };
  const normalized = { ...observation, source };
  return { scope, inputId: receiptId, source, observation: normalized, retainedRepresentation: representation,
    ...(normalized.kind === 'adjustment' ? { adverseTransactionRef: normalized.transactionRef } : {}) };
}
function envelope(value: unknown): Readonly<{ eventId: string; eventType: string; occurredAt: string; data: unknown }> {
  const result = object(value), eventId = providerId(result['event_id'], 'evt'), eventType = string(result['event_type']), occurredAt = string(result['occurred_at']);
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(eventType) || eventType.length > 128) throw new TypeError('Invalid event type');
  exactTime(occurredAt); object(result['data']);
  return { eventId, eventType, occurredAt, data: result['data'] };
}
function validateOffer(offer: OfferSnapshot, scope: PaymentScope): void {
  if (offer.applicationId !== scope.applicationId || offer.lines.length !== 1 || !['one_time', 'monthly'].includes(offer.profile) || !/^[A-Z]{3}$/u.test(offer.currency)) throw new TypeError('Unsupported offer');
  const line = offer.lines[0];
  if (line === undefined || line.quantity !== 1) throw new TypeError('Unsupported quantity');
  providerId(line.providerPriceRef, 'pri'); assertIdentifier(line.benefitSlotId); assertIdentifier(offer.offerId); assertIdentifier(offer.version);
}

export class PaddlePaymentProvider implements PaymentProvider {
  readonly scope: PaymentScope;
  readonly capabilities: CapabilityProfile;
  readonly #sdk: Paddle;
  readonly #options: PaddleProviderOptions;

  constructor(options: PaddleProviderOptions) {
    assertScope(options.scope);
    if (options.scope.provider !== 'paddle' || options.apiVersion !== 1 || (options.webhook !== undefined && options.webhook.apiVersion !== 1)) throw new TypeError('Unsupported Paddle API profile');
    if (!options.apiKey) throw new TypeError('Paddle API key is required');
    if (options.webhook !== undefined) { assertIdentifier(options.webhook.endpointId); if (!options.webhook.secret) throw new TypeError('Webhook secret is required'); }
    this.scope = Object.freeze({ ...options.scope }); this.#options = options;
    this.capabilities = Object.freeze({ checkout: true, transactionRead: true, subscriptionRead: true, cancellation: ['now', 'period_end'] as const, paymentUpdate: true, customerManagement: options.authorizeCustomerManagement !== undefined });
    this.#sdk = new Paddle(options.apiKey, { environment: options.scope.environment === 'sandbox' ? Environment.sandbox : Environment.production, logLevel: LogLevel.none, customHeaders: { 'Paddle-Version': '1' } });
  }

  async createCheckout(input: Readonly<{ intentId: string; attemptId: string; buyerId: string; offer: OfferSnapshot }>): Promise<ProviderResult<CheckoutReady>> {
    try { validateOffer(input.offer, this.scope); assertIdentifier(input.intentId); assertIdentifier(input.attemptId); } catch { return { kind: 'rejected', code: 'catalog_mismatch' }; }
    try {
      const result = await this.#sdk.transactions.create({ items: input.offer.lines.map(line => ({ priceId: line.providerPriceRef, quantity: 1 })), currencyCode: input.offer.currency as CurrencyCode, collectionMode: 'automatic',
        customData: { payments: { applicationId: this.scope.applicationId, paymentAccountId: this.scope.paymentAccountId, environment: this.scope.environment, intentId: input.intentId, attemptId: input.attemptId } } });
      const transactionRef = providerId(result.id, 'txn');
      return { kind: 'succeeded', value: { intentId: input.intentId, transactionRef, checkout: result.checkout?.url ? { url: httpsUrl(result.checkout.url) } : {} } };
    } catch (error) { return translatePaddleError(error, true); }
  }

  async readTransaction(transactionRef: string): Promise<ProviderResult<TransactionObservation>> {
    const result = await this.readTransactionInput(transactionRef);
    return result.kind === 'succeeded' ? { kind: 'succeeded', value: result.value.observation as TransactionObservation } : result;
  }

  /** Full source receipt for durable reconciliation; ordinary read returns only its neutral observation. */
  async readTransactionInput(transactionRef: string): Promise<ProviderResult<VerifiedInput>> {
    try { providerId(transactionRef, 'txn'); } catch { return { kind: 'rejected', code: 'validation' }; }
    try {
      const result = await this.#sdk.transactions.get(transactionRef);
      if (result.id !== transactionRef) return { kind: 'rejected', code: 'ownership_mismatch' };
      const receipt = apiReceipt(transactionObservation(result, 'mapped', placeholderSource(), this.scope), this.scope, result);
      return { kind: 'succeeded', value: receipt };
    } catch (error) { return translatePaddleError(error, false); }
  }

  async readSubscription(subscriptionRef: string): Promise<ProviderResult<SubscriptionObservation>> {
    const result = await this.readSubscriptionInput(subscriptionRef);
    return result.kind === 'succeeded' ? { kind: 'succeeded', value: result.value.observation as SubscriptionObservation } : result;
  }

  async readSubscriptionInput(subscriptionRef: string): Promise<ProviderResult<VerifiedInput>> {
    try { providerId(subscriptionRef, 'sub'); } catch { return { kind: 'rejected', code: 'validation' }; }
    try {
      const result = await this.#sdk.subscriptions.get(subscriptionRef);
      if (result.id !== subscriptionRef) return { kind: 'rejected', code: 'ownership_mismatch' };
      return { kind: 'succeeded', value: apiReceipt(subscriptionObservation(result, 'mapped', placeholderSource()), this.scope, result) };
    } catch (error) { return translatePaddleError(error, false); }
  }

  async cancelSubscription(input: Readonly<{ subscriptionRef: string; timing: 'now' | 'period_end'; attemptId: string }>): Promise<ProviderResult<CancellationOutcome>> {
    try { providerId(input.subscriptionRef, 'sub'); assertIdentifier(input.attemptId); } catch { return { kind: 'rejected', code: 'validation' }; }
    if (input.timing !== 'now' && input.timing !== 'period_end') return { kind: 'unsupported', capability: 'cancellation_timing' };
    try {
      const result = await this.#sdk.subscriptions.cancel(input.subscriptionRef, { effectiveFrom: input.timing === 'now' ? 'immediately' : 'next_billing_period' });
      if (result.id !== input.subscriptionRef) return { kind: 'outcome_unknown' };
      if (input.timing === 'now' && result.status === 'canceled') return { kind: 'succeeded', value: { kind: 'applied', observedStatus: result.status } };
      if (input.timing === 'period_end' && result.status !== 'canceled' && result.scheduledChange?.action === 'cancel') {
        exactTime(result.scheduledChange.effectiveAt);
        return { kind: 'succeeded', value: { kind: 'scheduled', effectiveAt: result.scheduledChange.effectiveAt } };
      }
      return { kind: 'outcome_unknown' };
    } catch (error) { return translatePaddleError(error, true); }
  }

  async openPaymentUpdate(input: Readonly<{ subscriptionRef: string; intentId: string; attemptId: string }>): Promise<ProviderResult<PaymentUpdateReady>> {
    try { providerId(input.subscriptionRef, 'sub'); assertIdentifier(input.intentId); assertIdentifier(input.attemptId); } catch { return { kind: 'rejected', code: 'validation' }; }
    try {
      // This GET can create a transaction. It deliberately shares mutation uncertainty handling.
      const result = await this.#sdk.subscriptions.getPaymentMethodChangeTransaction(input.subscriptionRef);
      if (result.subscriptionId !== input.subscriptionRef || !['subscription_payment_method_change', 'subscription_recurring'].includes(result.origin)) return { kind: 'outcome_unknown' };
      return { kind: 'succeeded', value: { intentId: input.intentId, transactionRef: providerId(result.id, 'txn'), purpose: result.origin === 'subscription_recurring' ? 'recovery' : 'payment_method', checkout: result.checkout?.url ? { url: httpsUrl(result.checkout.url) } : {} } };
    } catch (error) { return translatePaddleError(error, true); }
  }

  async createManagementLink(input: Readonly<{ customerRef: string; subscriptionRefs: readonly string[] }>): Promise<ProviderResult<Readonly<{ url: string }>>> {
    const authorize = this.#options.authorizeCustomerManagement;
    if (authorize === undefined) return { kind: 'unsupported', capability: 'customer_wide_management' };
    try { providerId(input.customerRef, 'ctm'); if (input.subscriptionRefs.length > 25) throw new TypeError('Too many links'); input.subscriptionRefs.forEach(ref => providerId(ref, 'sub')); } catch { return { kind: 'rejected', code: 'validation' }; }
    if (!(await authorize({ scope: this.scope, ...input }))) return { kind: 'rejected', code: 'permission_denied' };
    try {
      const result = await this.#sdk.customerPortalSessions.create(input.customerRef, [...input.subscriptionRefs]);
      if (result.customerId !== input.customerRef) return { kind: 'rejected', code: 'ownership_mismatch' };
      return { kind: 'succeeded', value: { url: httpsUrl(result.urls.general.overview) } };
    } catch (error) { return translatePaddleError(error, false); }
  }

  async verifyWebhook(rawBody: string | Uint8Array, signature: string): Promise<ProviderResult<VerifiedInput>> {
    const config = this.#options.webhook;
    if (config === undefined) return { kind: 'unsupported', capability: 'webhook_verification' };
    let body: string;
    try { body = typeof rawBody === 'string' ? rawBody : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBody); } catch { return { kind: 'rejected', code: 'validation' }; }
    try { if (!(await this.#sdk.webhooks.isSignatureValid(body, config.secret, signature))) return { kind: 'rejected', code: 'permission_denied' }; } catch { return { kind: 'rejected', code: 'permission_denied' }; }
    try {
      const parsed: unknown = JSON.parse(body), event = envelope(parsed);
      const stableEnvelope = json({ event_id: event.eventId, event_type: event.eventType, occurred_at: event.occurredAt, data: event.data });
      const representationDigest = rawDigest(body), receiptId = digest([this.scope, config.endpointId, representationDigest]);
      const source: EvidenceSource = { kind: 'verified_webhook', receiptId, representationDigest, stableEnvelopeDigest: digest(stableEnvelope), decoderVersion: PADDLE_DECODER_VERSION, sdkVersion: SDK_VERSION, apiProfile: PADDLE_API_PROFILE,
        eventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt,
        verification: { verifiedAt: new Date().toISOString(), endpointId: config.endpointId, rawBodyDigest: representationDigest } };
      return { kind: 'succeeded', value: this.#webhookInput(body, event, source) };
    } catch { return { kind: 'rejected', code: 'validation' }; }
  }

  #webhookInput(body: string, event: ReturnType<typeof envelope>, source: EvidenceSource): VerifiedInput {
    const observation = normalizeObservation(event.data, event.eventType, 'raw', source, this.scope);
    const data = object(event.data), adverseRef = event.eventType.startsWith('adjustment.') ? data['transaction_id'] : undefined;
    return { scope: this.scope, inputId: source.receiptId, source, observation, retainedRepresentation: { rawBody: body },
      ...(typeof adverseRef === 'string' && /^txn_[0-9a-z]{26}$/u.test(adverseRef) ? { adverseTransactionRef: adverseRef } : {}) };
  }

  /** Only call for an input read from trusted durable storage after initial verification. */
  normalizeVerifiedWebhook(input: VerifiedInput): VerifiedInput {
    if (!sameScope(input.scope, this.scope) || input.source.kind !== 'verified_webhook' || input.source.verification === undefined || input.source.apiProfile !== PADDLE_API_PROFILE) throw new TypeError('Untrusted durable input');
    const body = string(object(input.retainedRepresentation)['rawBody']);
    if (rawDigest(body) !== input.source.verification.rawBodyDigest) throw new TypeError('Retained body digest mismatch');
    const event = envelope(JSON.parse(body) as unknown);
    if (event.eventId !== input.source.eventId || event.eventType !== input.source.eventType || event.occurredAt !== input.source.occurredAt || rawDigest(body) !== input.source.representationDigest) throw new TypeError('Retained event mismatch');
    return this.#webhookInput(body, event, { ...input.source, decoderVersion: PADDLE_DECODER_VERSION });
  }

  async readEventPage(query: PaddleEventScanQuery): Promise<PaddleEventScanResult> {
    const gap = (reason: string): PaddleEventScanResult => ({ kind: 'gap', reason, query, sdkVersion: SDK_VERSION });
    try {
      exactTime(query.from); exactTime(query.to); assertIdentifier(query.epoch); assertIdentifier(query.queryVersion);
      if (compareTime(query.from, query.to) >= 0 || (query.perPage !== undefined && (!Number.isInteger(query.perPage) || query.perPage < 1 || query.perPage > 200))) return gap('invalid_query');
      if (query.after !== undefined) providerId(query.after, 'evt');
      const parameters: NonNullable<Parameters<Paddle['events']['list']>[0]> & { from: string; to: string } = { from: query.from, to: query.to, orderBy: 'id[ASC]', ...(query.after === undefined ? {} : { after: query.after }), ...(query.perPage === undefined ? {} : { perPage: query.perPage }), ...(query.eventTypes === undefined ? {} : { eventType: [...query.eventTypes] as IEventName[] }) };
      // Recreate from the caller's durable pre-page cursor on every call. Never reuse a failed collection.
      const collection = this.#sdk.events.list(parameters), events = await collection.next();
      if (events.length === 0 && collection.hasMore) return gap('empty_nonterminal_page');
      let previous = query.after;
      const inputs: VerifiedInput[] = [];
      for (const event of events) {
        const eventId = providerId(event.eventId, 'evt');
        if (previous !== undefined && eventId <= previous) return gap('nonprogressing_event_page');
        previous = eventId; exactTime(event.occurredAt);
        const source: EvidenceSource = { ...placeholderSource(json(query)), eventId, eventType: event.eventType, occurredAt: event.occurredAt };
        const input = apiReceipt(normalizeObservation(event.data, event.eventType, 'mapped', source, this.scope), this.scope, event);
        const adverseRef = event.eventType.startsWith('adjustment.') ? object(event.data)['transactionId'] : undefined;
        inputs.push({ ...input, ...(typeof adverseRef === 'string' && /^txn_[0-9a-z]{26}$/u.test(adverseRef) ? { adverseTransactionRef: adverseRef } : {}) });
      }
      return { kind: 'page', inputs, hasMore: collection.hasMore, ...(previous === undefined ? {} : { lastEventId: previous }) };
    } catch (error) {
      const failure = translatePaddleError(error, false);
      return { kind: 'gap', reason: 'sdk_acquisition_or_mapping_failed', query, sdkVersion: SDK_VERSION,
        ...(failure.kind === 'rejected' ? { code: failure.code } : {}) };
    }
  }

  async readAdjustmentPage(transactionRef: string, after?: string): Promise<ProviderResult<PaddleAdjustmentPage>> {
    try { providerId(transactionRef, 'txn'); if (after !== undefined) providerId(after, 'adj'); } catch { return { kind: 'rejected', code: 'validation' }; }
    try {
      const collection = this.#sdk.adjustments.list({ transactionId: [transactionRef], orderBy: 'id[ASC]', ...(after === undefined ? {} : { after }) }), values = await collection.next();
      if (values.length === 0 && collection.hasMore) return { kind: 'rejected', code: 'unclassified_external_state' };
      let previous = after;
      const adjustmentIds: string[] = [];
      const inputs = values.map(value => {
        const ref = providerId(value.id, 'adj');
        if ((previous !== undefined && ref <= previous) || value.transactionId !== transactionRef) throw new TypeError('Invalid adjustment page');
        previous = ref; adjustmentIds.push(ref);
        return { ...apiReceipt(normalizeObservation(value, 'adjustment.snapshot', 'mapped', placeholderSource(json({ transactionRef, after: after ?? null })), this.scope), this.scope, value), adverseTransactionRef: transactionRef };
      });
      return { kind: 'succeeded', value: { inputs, adjustmentIds, hasMore: collection.hasMore, ...(previous === undefined ? {} : { lastAdjustmentId: previous }) } };
    } catch (error) { return translatePaddleError(error, false); }
  }
}

export function createPaddleProvider(options: PaddleProviderOptions): PaddlePaymentProvider { return new PaddlePaymentProvider(options); }
