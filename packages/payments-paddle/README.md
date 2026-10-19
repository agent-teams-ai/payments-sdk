# Paddle Billing adapter

`@agent-teams/payments-paddle` implements the core payment capabilities with the public API of `@paddle/paddle-node-sdk` 3.10.0. It does not own a database, HTTP endpoint, application authentication, product access, or credit grants.

```ts
import { createPaddleProvider } from '@agent-teams/payments-paddle';

const provider = createPaddleProvider({
  scope: { applicationId: 'app', provider: 'paddle', paymentAccountId: 'stable-merchant', environment: 'sandbox' },
  apiKey: process.env['PADDLE_API_KEY']!,
  apiVersion: 1,
  webhook: { endpointId: 'version-1-destination', secret: process.env['PADDLE_WEBHOOK_SECRET']!, apiVersion: 1 },
});
```

Configure that notification destination for API version 1 separately. The adapter pins `Paddle-Version: 1` through the SDK's public `customHeaders` option; an API credential's account default does not configure a notification destination. Stable merchant/application/environment configuration supplies the scope. Event metadata never supplies authority.

## Operations and outcomes

`createCheckout` creates an automatic transaction with one server-selected price, quantity one, and a namespaced correlation hint. The core must commit its provider-ID binding before releasing checkout instructions. A successful create is checkout preparation; final `completed` evidence and saved ownership/commercial bindings determine fulfillment.

`readTransaction` and `readSubscription` return validated neutral observations with provider timestamps. For durable API acquisition, `readTransactionInput` and `readSubscriptionInput` return the complete source receipt, with its explicitly SDK-mapped/lossy diagnostic JSON and digest, for core admission. `cancelSubscription` always sends explicit `immediately` or `next_billing_period`, and acknowledges only the corresponding observed state. Period-end cancellation returns the actual scheduled timestamp. It never substitutes immediate cancellation for period-end cancellation.

`openPaymentUpdate` uses the SDK's `getPaymentMethodChangeTransaction`. Despite HTTP GET, the provider can create a transaction. It uses mutation uncertainty handling and receives no automatic retry. A payment-method change completion supplies management evidence, rather than a new commercial purchase.

`createManagementLink` is disabled by default. Enabling it requires a host callback that authorizes the entire Paddle customer account. Subscription IDs select navigation links; they do not establish a subscription-only security boundary. The returned overview URL is ephemeral sensitive data and is not retained by this adapter.

The SDK performs one request and does not offer a public per-request timeout/AbortSignal. This adapter adds no hidden retry, raw HTTP client, global fetch interception, private SDK access, or fake cancellation. A network, JSON, or mapping failure after a mutation can follow a provider effect and returns `outcome_unknown`. Documented rejection codes translate to neutral categories; new/unknown mutation errors remain unknown. Available provider codes are diagnostic data; the SDK does not return HTTP status or response request IDs on its public error objects.

## Webhook custody and decoding

Call `verifyWebhook` with the unchanged body and signature header immediately. The official SDK authenticates the exact string. UTF-8 byte bodies use a fatal decoder. The minimum event envelope is validated and original body retained, including unknown fields and types. Notification ID is excluded from the stable event envelope digest. Unsupported known shapes are retained as non-granting observations; known adjustment routing is preserved for pending-adverse barriers.

Only acknowledge delivery after the core's durable admission. Later processing may call `normalizeVerifiedWebhook` on an input loaded from trusted storage. It verifies stored body/identity integrity and uses the retained authentication context; it never applies the SDK's five-second signature-age window to an old receipt.

Raw JSON preserves absent versus explicit-null fields. Mapped API evidence has a different source and never claims to retain original response JSON. Under the declared API1/SDK3.10/decoder1 trust profile, mapped nulls in price billing cycle/trial, item/line proration, and subscription scheduled change mean semantic absence with `schema_assumed_null` provenance. Other collapsed optional fields remain unknown. Non-null monetary evidence is runtime checked. Exact amounts remain integer strings; full timestamp fractions and provider transaction-line identities are retained.

`readEventPage` returns a mapped page or an explicit coverage gap. Keep the full fixed query, epoch, and durable `after` cursor. Commit every returned input and the last event ID atomically in the payment owner. Every call creates a fresh public SDK collection from that cursor. A mapper exception, empty nonterminal page, invalid identity, or nonprogressing order leaves a gap and does not authorize checkpoint advancement. Short pages do not imply exhaustion; use the SDK's public `hasMore`.

`readAdjustmentPage` scans adjustments for a completed transaction with the same public page/cursor semantics. Adjustment identity, action/status/type, allocation identity, original transaction-line reference, and signed exact totals remain distinct. Reversed originals and separate reverse adjustments are not automatically netted into credit effects.

API event retention, exclusive `from`/`to` bounds, live-list visibility, and SDK mapping loss limit reconciliation. Overlap windows and deduplicate; do not claim full history from one exhausted page/window or recover original poison events that the SDK never returned. Unknown observations cannot produce commercial completion.

## Qualification

`test/sdk-contract.test.ts` uses the official undici `install()` and `MockAgent` inside an isolated Node test process, with all network connections disabled, synthetic API-schema fixtures, and no account credentials. Installation keeps the fetch implementation and its test Dispatcher API consistent across Node24's bundled undici7 and Node26's bundled undici8. The harness first proves that both an unmatched Paddle path and an unapproved origin fail with the mock's explicit no-match error, with a bounded abort fallback. It restores the previous dispatcher and every installed global property descriptor on cleanup. Calls still traverse the actual SDK's request serializer, public resources, response/entity constructors, collection mapping, API errors, and signature verifier. Provider account behavior and payment collection require a separate sandbox gate.

Sources: [SDK libraries and retries](https://developer.paddle.com/sdks/libraries/), [versioning](https://developer.paddle.com/api-reference/about/versioning/), [cancellation](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription/), [payment update](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/), [portal scope](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/), [signature verification](https://developer.paddle.com/webhooks/about/signature-verification/), [events](https://developer.paddle.com/api-reference/events/list-events/), [error reference](https://developer.paddle.com/errors/). The inspected published SDK and source audit are recorded in the implementation plan.
