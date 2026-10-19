/**
 * Synthetic API1 fixtures derived from Paddle Billing's documented response schemas.
 * No recording, credentials, customer contact data, or production identifiers are present.
 * They are passed through the real SDK3.10 constructors by the MockAgent suite.
 */
export const paddleIds = {
  transaction: 'txn_01j00000000000000000000001', secondTransaction: 'txn_01j00000000000000000000002',
  subscription: 'sub_01j00000000000000000000001', customer: 'ctm_01j00000000000000000000001',
  price: 'pri_01j00000000000000000000001', product: 'pro_01j00000000000000000000001',
  line: 'txnitm_01j00000000000000000000001', adjustment: 'adj_01j00000000000000000000001',
  reverseAdjustment: 'adj_01j00000000000000000000002', allocation: 'adjitm_01j00000000000000000000001',
  event: 'evt_01j00000000000000000000001', secondEvent: 'evt_01j00000000000000000000002', thirdEvent: 'evt_01j00000000000000000000003',
} as const;
export const fixtureTime = '2026-10-01T00:00:00.123456Z';
export const fixturePeriod = { starts_at: fixtureTime, ends_at: '2026-11-01T00:00:00.123456Z' };
export type FixtureObject = Record<string, unknown>;

export function productFixture(): FixtureObject {
  return { id: paddleIds.product, name: 'Synthetic fixture product', type: 'standard', description: null, tax_category: 'standard', image_url: null, custom_data: null,
    status: 'active', created_at: fixtureTime, updated_at: fixtureTime, import_meta: null };
}

export function priceFixture(monthly = true, trial = false, maximumQuantity = 1): FixtureObject {
  return { id: paddleIds.price, product_id: paddleIds.product, description: 'Synthetic supported price', name: 'Fixture', type: 'standard',
    billing_cycle: monthly ? { interval: 'month', frequency: 1 } : null, trial_period: trial ? { interval: 'day', frequency: 7, requires_payment_method: true } : null,
    tax_mode: 'account_setting', unit_price: { amount: '1000', currency_code: 'USD' }, unit_price_overrides: [], quantity: { minimum: 1, maximum: maximumQuantity }, status: 'active',
    created_at: fixtureTime, updated_at: fixtureTime, custom_data: null, import_meta: null, product: null };
}

export function transactionFixture(options: Readonly<{ id?: string; monthly?: boolean; trial?: boolean; total?: string; status?: string; origin?: string; subscriptionRef?: string | null; customerRef?: string | null; applicationId?: string; intentId?: string; version?: string; maximumQuantity?: number }> = {}): FixtureObject {
  const total = options.total ?? '1000', monthly = options.monthly ?? true;
  return { id: options.id ?? paddleIds.transaction, status: options.status ?? 'completed', customer_id: options.customerRef === undefined ? paddleIds.customer : options.customerRef,
    address_id: null, business_id: null, custom_data: { payments: { applicationId: options.applicationId ?? 'app-a', paymentAccountId: 'merchant-fixture', environment: 'sandbox', intentId: options.intentId ?? 'intent-fixture', attemptId: 'attempt-fixture' } },
    currency_code: 'USD', origin: options.origin ?? 'api', subscription_id: options.subscriptionRef === undefined ? monthly ? paddleIds.subscription : null : options.subscriptionRef,
    invoice_id: null, invoice_number: null, collection_mode: 'automatic', discount_id: null, billing_details: null, billing_period: monthly ? { ...fixturePeriod } : null,
    items: [{ price: priceFixture(monthly, options.trial, options.maximumQuantity), quantity: 1, proration: null }],
    details: { tax_rates_used: [], totals: { subtotal: total, discount: '0', tax: '0', total, credit: '0', credit_to_balance: '0', balance: '0', grand_total: total, fee: null, earnings: null, currency_code: 'USD' },
      adjusted_totals: null, payout_totals: null, adjusted_payout_totals: null,
      line_items: [{ id: paddleIds.line, price_id: paddleIds.price, quantity: 1, proration: null, tax_rate: '0', unit_totals: { subtotal: total, discount: '0', tax: '0', total }, totals: { subtotal: total, discount: '0', tax: '0', total }, product: productFixture() }] },
    payments: [], checkout: { url: 'https://checkout.paddle.test/fixture' }, created_at: fixtureTime, updated_at: options.version ?? fixtureTime, billed_at: fixtureTime, revised_at: null,
  };
}

export function subscriptionFixture(options: Readonly<{ status?: string; scheduled?: boolean; version?: string; quantity?: number; omitQuantity?: boolean; maximumQuantity?: number; collectionMode?: string; trial?: boolean; monthly?: boolean }> = {}): FixtureObject {
  return { id: paddleIds.subscription, status: options.status ?? 'active', customer_id: paddleIds.customer, address_id: 'add_01j00000000000000000000001', business_id: null,
    currency_code: 'USD', created_at: fixtureTime, updated_at: options.version ?? fixtureTime, started_at: fixtureTime, first_billed_at: fixtureTime, next_billed_at: fixturePeriod.ends_at,
    paused_at: null, canceled_at: options.status === 'canceled' ? fixtureTime : null, discount: null, collection_mode: options.collectionMode ?? 'automatic', billing_details: options.collectionMode === 'manual' ? { enable_checkout: false, purchase_order_number: '', additional_information: null, payment_terms: { interval: 'day', frequency: 14 } } : null,
    current_billing_period: options.status === 'canceled' ? null : { ...fixturePeriod }, billing_cycle: { interval: 'month', frequency: 1 },
    scheduled_change: options.scheduled ? { action: 'cancel', effective_at: fixturePeriod.ends_at, resume_at: null } : null, management_urls: null,
    items: [{ status: 'active', ...(options.omitQuantity ? {} : { quantity: options.quantity ?? 1 }), recurring: true, created_at: fixtureTime, updated_at: fixtureTime, previously_billed_at: fixtureTime, next_billed_at: fixturePeriod.ends_at, trial_dates: null, price: priceFixture(options.monthly, options.trial, options.maximumQuantity), product: productFixture() }],
    custom_data: null, import_meta: null,
  };
}

export function adjustmentFixture(options: Readonly<{ id?: string; transactionRef?: string; status?: string; action?: string; total?: string; version?: string; partial?: boolean }> = {}): FixtureObject {
  const total = options.total ?? '1000';
  return { id: options.id ?? paddleIds.adjustment, action: options.action ?? 'refund', type: options.partial ? 'partial' : 'full', transaction_id: options.transactionRef ?? paddleIds.transaction,
    subscription_id: paddleIds.subscription, customer_id: paddleIds.customer, reason: 'Synthetic fixture adjustment', credit_applied_to_balance: false, currency_code: 'USD', status: options.status ?? 'approved',
    items: [{ id: paddleIds.allocation, item_id: paddleIds.line, type: options.partial ? 'partial' : 'full', amount: options.partial ? total : null, proration: null, totals: { subtotal: total, tax: '0', total } }],
    totals: { subtotal: total, tax: '0', total, fee: '0', earnings: total, currency_code: 'USD', retained_fee: '0' }, payout_totals: null,
    created_at: fixtureTime, updated_at: options.version ?? fixtureTime,
  };
}
export function eventFixture(type = 'transaction.completed', data: FixtureObject = transactionFixture(), eventId: string = paddleIds.event): FixtureObject {
  return { event_id: eventId, event_type: type, occurred_at: fixtureTime, notification_id: 'ntf_01j00000000000000000000001', data };
}
export function responseFixture(data: unknown, more = false): FixtureObject {
  return { data, meta: { request_id: 'fixture-request', pagination: { per_page: 50, next: more ? 'https://sandbox-api.paddle.com/events?after=ignored-sdk-cursor' : null, has_more: more, estimated_total: 0 } } };
}
