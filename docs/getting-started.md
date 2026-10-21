# Getting started

This guide composes the supported profile from the four package boundaries. The complete, typechecked durable example is [`examples/paddle-postgres.ts`](../examples/paddle-postgres.ts); the two HTTP host examples are exercised in the [full-system suite](../tests/e2e/full-system.test.ts). Credentials and application policies are explicit inputs.

**Use this prerelease for integration and fixture evaluation. Production deployment is currently blocked by the [Node runtime security gate](security-qualification.md#node-bundled-transport-scope).** Functional CI success and clean npm dependency scans do not establish a corrected built-in `fetch`. An official patched runtime needs the separate source, binary and consumer qualification documented there before real deployment.

## 1. Choose a package set

A plain application can use `payments-core` with its own implementations of the core-owned `PaymentProvider`, `PaymentStore` and `Catalog` ports. For Paddle with PostgreSQL, install the matching core, Paddle and PostgreSQL tarballs from one [release candidate](releasing.md), plus `pg`. Add `payments-get-modular` and its exact qualified peers only when the host uses Get Modular. These packages emit ESM JavaScript and declarations; consume their public exports instead of importing workspace source or private SDK paths.

For SDK `0.3.0`, the qualified published Get Modular set is Core/Assembly `0.6.0`, Resources `0.2.0` and development-only Conformance `0.4.0`. Add Observation `0.1.0` when importing `@agent-teams/payments-get-modular/observation`; the base integration does not require it. Preserve one physical instance of the host's branded peers. The [package guide](../packages/payments-get-modular/README.md) owns Assembly composition, Resources cleanup, `watch` and latest-only `load`. The [current upstream record](upstream-qualification.md) gives the exact artifacts and consumer qualification.

Drizzle is an internal runtime dependency of `payments-postgres`. It does not change the core ports or require applications to adopt an ORM. The PostgreSQL [adapter guide](../packages/payments-postgres/README.md) explains the exact prerelease, transaction ownership and separate maintainer declaration correction; packed npm consumers use the original registry package without that correction.

## 2. Establish trusted identities and catalog

`PaymentScope` comes from server configuration. `paymentAccountId` is a stable merchant-account namespace, not a credential fingerprint. Keep `scope`, `producerNamespace`, payment schema and job schema stable through restarts and key rotation. Replicas use the same configuration; independent application/account/environment runtimes use separate stable schema pairs. A new namespace does not repair missing deduplication history.

The host authenticates the application user and derives its opaque local `buyerId`. Never authorize a request using its supplied buyer ID, email, Paddle customer/subscription ID or correlation metadata. A privileged account-wide Paddle API key can act outside the SDK's local scope; application namespaces cannot isolate another holder of that key.

The host's `Catalog.resolveOffer(scope, offerId)` returns a server-controlled immutable offer snapshot. For example:

```ts
import type { Catalog, OfferSnapshot, PaymentScope } from '@agent-teams/payments-core';

export function catalogFor(scope: PaymentScope, monthlyPriceRef: string, topupPriceRef: string): Catalog {
  const offers: Readonly<Record<string, OfferSnapshot>> = {
    monthly: {
      applicationId: scope.applicationId, offerId: 'monthly', version: 'catalog-1',
      policyVersion: 'benefit-policy-1', profile: 'monthly', currency: 'USD', allowZeroTotal: false,
      lines: [{ providerPriceRef: monthlyPriceRef, benefitSlotId: 'included-quota', quantity: 1 }],
    },
    topup: {
      applicationId: scope.applicationId, offerId: 'topup', version: 'catalog-1',
      policyVersion: 'benefit-policy-1', profile: 'one_time', currency: 'USD', allowZeroTotal: false,
      lines: [{ providerPriceRef: topupPriceRef, benefitSlotId: 'purchased-credits', quantity: 1 }],
    },
  };
  return { resolveOffer: async (requestedScope, offerId) => requestedScope.applicationId === scope.applicationId ? offers[offerId] : undefined };
}
```

Use real server-configured price references matching the intended profile. The core stores the chosen offer/policy version with the intent. The client cannot choose quantities, price references, currency or grant size. Keep historical policies available to downstream owners; changing today's catalog must not reinterpret an old payment. `benefitSlotId` identifies the promised local benefit across provider transactions and is not a provider line ID.

## 3. Bootstrap separately, then construct a runtime

Bootstrap with a migration-role pool before accepting traffic. `migratePaymentSchema` and `createPgBossPaymentTransport(namespace).bootstrap()` install and bind the stable schema pair. Construct the runtime transport with a separate least-privilege runtime-role pool and pass it explicitly to `createPostgresPaymentJobs`. The [PostgreSQL guide](../packages/payments-postgres/README.md#runtime-role) gives the qualified grants and SQL budgets; startup does not perform DDL. The [transport guide](queue-transport.md) explains the optional queue and replacement contract.

The durable example exports `bootstrapPaymentHost(namespace)` for migration and `createPaddlePostgresHost(options)` for normal operation. Its exported types enumerate the pool, trusted namespaces, Paddle configuration, catalog, authentication callback, consumer handlers and error listener. Supply migration and runtime pools explicitly. The returned Fetch handler can be mounted in the application's HTTP environment. The host still owns request timeouts, transport body-read limits, authentication/CSRF policy, secrets, logs and shared pool disposal.

For a plain custom composition, the actual core entry point is:

```ts
import { createPayments } from '@agent-teams/payments-core';
import type { PaymentRuntimeOptions } from '@agent-teams/payments-core';

export function paymentRuntime(options: PaymentRuntimeOptions) {
  return createPayments(options);
}
```

`createPayments` starts no worker or timer. The Get Modular alternative uses the same options and payment runtime, through [`createFetchModularHost`](../examples/fetch-modular.ts). Preparing an Assembly template is inert; each run receives a host-owned Resources scope and explicit configuration. Always close the attempt scope after failed or cancelled construction, and inspect incomplete close reports.

## 4. Create checkout for an authenticated buyer

The host calls `payments.startPurchase({ buyerId, offerId: 'monthly', requestKey })` after deriving the buyer and selecting the offer. Handle every `OperationResult` variant:

| Result | Host behavior |
| --- | --- |
| `succeeded` | Show the saved intent's checkout instructions to its authorized buyer |
| `pending` | Retain `operationId` and read its status |
| `outcome_unknown` | Retain `operationId`; reconcile or use audited resolution, without a new automatic mutation |
| `rejected` | Handle the neutral `code`; a new key does not bypass a conflicting mutation lane |
| `unsupported` | Explain the declared unsupported capability |

The host selects a request key stable for one business intent. Reusing `(scope, buyerId, requestKey)` with the same command returns its existing outcome; a conflicting command is rejected. A separate intentional top-up uses a new intent/key and `offerId: 'topup'`.

A succeeded result confirms checkout preparation and durable provider-ID binding. It does not grant access or credits. Browser checkout callbacks and success URLs are UI signals. Read `readPurchase(buyerId, intentId)` for the server-owned payment state; use `readOperation(operationId, buyerId)` for buyer-scoped status. Omitting the buyer argument from `readOperation` exposes an administrative read capability and must not be available to arbitrary callers.

The server can return the saved provider checkout URL to the authenticated buyer for host-controlled navigation. An overlay browser integration with official `@paddle/paddle-js` `1.6.5` is a separate admission gate: its published declarations currently fail this repository's required strict TypeScript/`skipLibCheck:false` profile (see [qualification](qualification.md#browser-wrapper-admission)). No unchecked wrapper or substitute browser payment runtime is shipped. Any future overlay must use a public client-side token, open the server-created transaction, and treat `checkout.completed` only as a request to refresh durable server status. Server API keys and webhook secrets stay off the client.

## 5. Admit exact webhook bytes

Configure the Paddle API and notification destination separately for API version 1. `createPaddleProvider` pins API requests through the official SDK; a webhook destination's version remains a Paddle-side configuration step.

At ingress, read the **unchanged bytes** and original `paddle-signature` header before JSON parsing, reserialization or a framework body transform. Call `provider.verifyWebhook(bytes, signature)` immediately. Only the verifier's successful `VerifiedInput` goes to `payments.ingestVerifiedInput`. Return HTTP 200 after confirmed durable admission (T1); return 5xx if custody cannot be confirmed. Processing and consumer delivery run afterwards. The shared [handler](../examples/node-http.ts) demonstrates this sequence and never returns 200 before admission.

Bound request size and body-read time before materializing the full body. The Node example bounds the stream to 65,536 bytes; a host mounting the Fetch handler must enforce its transport limits as well. The handler's post-read check alone cannot limit a slow stream or an arbitrarily large allocation. Preserve enough of the five-second delivery target for signature verification and the configured SQL budget.

Workers consume saved verification context. Do not reapply the SDK's short signature-age window to a receipt already authenticated and retained in trusted storage. Raw webhook custody retains unknown fields. API reconciliation retains explicitly SDK-mapped evidence; it cannot promise the original provider response body. See the [Paddle custody contract](../packages/payments-paddle/README.md#webhook-custody-and-decoding).

## 6. Deliver evidence to each independent owner

Register every required consumer before processing production purchases, using `payments.registerConsumer('commercial-access')` and `payments.registerConsumer('credits')`, for example. Keep their identities stable through restart and restore.

The durable example registers and starts a pg-boss delivery handler for each configured consumer. Its callback must resolve only after that owner's T3 commits the receipt, evidence projection, effect or durable held obligation, and owner outbox together. It returns the exact message ID and body digest after that commit. The worker validates the pair, commits the producer ACK and then returns to pg-boss.

A host without that transport can poll `payments.readDeliveries(consumerId, limit)`, call its own durable consumer port, then call `payments.acknowledgeDelivery(consumerId, message.messageId, message.bodyDigest)`. Never ACK before the consumer commit. The SDK does not ship a production credit ledger. The [consumer fixtures](../tests/fixtures/consumers) show independently stored revision fences, causal grant identities and durable held decisions; their test policy is not a production tariff or accounting policy.

ACK means durable custody, and can follow a held decision with its own persistent redrive obligation. It does not mean credits were issued. A crash after T3 before producer ACK must replay safely. Each required consumer owns its own target; another consumer's success cannot satisfy it. Hooks, browser events and a payment operation's succeeded response do not replace this protocol.

Before deployment, complete the [qualification gates](qualification.md) and adopt the [operations runbook](operations.md), including an external recovery fence that survives a database restore.
