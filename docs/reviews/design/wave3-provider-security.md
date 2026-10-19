# Wave 3 independent review: provider contracts and security

Reviewed immutable input: `research/reviews/wave3-plan.md`, SHA-256 `55a2828dadae96c92e23a3d137ee5b3c52b9b7210c5c1d0211c8cdb9d430bcd7`.

## Verdict

**No new P0, P1, or P2 finding established in this lens.** The revised plan states an implementable security and evidence boundary without attributing guarantees to the SDK that it does not provide. Its deliberate SDK-only API contract has reduced malformed-response detection and historical fidelity. Those limitations are acknowledged, bounded, and coupled to positive recovery gates; they are not independently a reason to replace the selected acquisition boundary.

This is a design review, not operational qualification. I read the complete handoff, complete Q 1.1.2, complete immutable plan, `paddle-sdk.md`, `provider-contracts.md`, both specified custody-dispute research reports, and `source-audit.md`. I inspected relevant exact published SDK 3.10.0 JavaScript and retained official source, and reopened primary Paddle documentation for payment updates, completed transactions, event listing, versioning, and subscription payment methods. I did not read other critic reports or the review journal. No implementation, tests, account access, provider mutations, or payment activity occurred.

The following traces explain why the principal candidate findings do not survive the revised contract. They also distinguish the remaining implementation gates from architecture defects.

## 1. Application buyer, payer, provider account, and portal authority

**Attack trace considered:** an authenticated user initiates an app-local purchase, enters an existing customer email during checkout, receives a subscription under that Paddle customer, then requests a portal session that exposes other products or saved payment methods.

Sections 3, 4, and 8 do not grant that escalation. The recipient is the saved local intent/buyer; the first observed non-null provider customer establishes a billing relationship. It does not establish customer-wide identity. Server-created transaction binding, account/environment, final composition, subscription relationship, and existing non-null customer changes are checked separately. Email and `custom_data` cannot replace the binding. The first-null transition therefore permits normal checkout without silently authorizing an account-linking operation.

The portal contract is stronger than a local subscription check: customer-wide authority requires a separate established identity or explicitly selected portal policy. Without it, app-local subscription actions and Paddle-hosted identity verification remain available. Pregenerated `management_urls` are treated as sensitive rather than an authorization workaround. This is consistent with the [portal session API](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/): `subscription_ids` generates navigation links, not a documented product isolation boundary.

The plan also correctly identifies the deployment boundary: trusted servers possessing account-wide Paddle credentials can bypass a local npm library. Per-app namespaces prevent routing and authorization mistakes; they cannot constrain another privileged integration calling the provider directly. Separate accounts or a credential authority are optional stronger deployment profiles, not a missing core interface.

**Remaining gate:** qualify two app-local buyers/subscriptions sharing a customer; deny portal/customer-token issuance with only local subscription authority; independently permit an authorized local cancellation/payment update. The planned same-email and cross-app tests already cover the relevant failure. Portal enablement remains product identity policy, not an unresolved requirement for ordinary checkout.

## 2. Exact SDK operations, errors, and mutation uncertainty

The retained SDK and published 3.10.0 paths support the plan's claims. `SubscriptionsResource.getPaymentMethodChangeTransaction(id)` returns a mapped transaction. `cancel(id, body)` performs a POST; there is no subscription creation method to use instead of recurring checkout. Portal session creation takes the customer ID and subscription ID array. The plan does not promise the newer `view_subscription` property that current constructors discard.

`Client` performs one fetch and JSON decoding, with no public per-call AbortSignal or timeout. `ApiError` exposes type/code/detail/errors/retryAfter, but not HTTP status or provider request ID. Fetch and JSON exceptions can escape independently. The plan preserves available diagnostics and separates execution certainty from a local error category; it does not require unavailable metadata or cast every error into a provider rejection.

**Failure trace considered:** transaction creation takes effect, its response is lost, the worker lease expires, and another request key arrives. Sections 4 and 9 retain `dispatch_started/unknown`, prohibit automatic monetary redispatch, and serialize the local mutation lane. A deadline or fencing token does not purport to cancel the provider request. An eventual response is another observation, not a stale worker's permission to overwrite the current operation. Audited operator resolution preserves accepted duplicate risk instead of relabeling it safe retry. This satisfies Q's observable-contract requirement without pretending Paddle offers arbitrary client idempotency keys.

**Remaining gate:** exact error-code classification and the listed crash/late-response probes must preserve these guarantees. The absence of completed implementation fixtures is not evidence that the architecture promises a generic retry policy.

Primary evidence: [SDK client](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/internal/api/client.ts), [ApiError](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/internal/errors/generic.ts), and [official idempotency guidance](https://developer.paddle.com/sdks/libraries/#idempotent-and-retried-requests).

## 3. SDK-only evidence and positive API recovery

**Failure trace considered:** a completed top-up or initial subscription loses its webhook; API reconciliation supplies a price whose SDK-mapped `billingCycle` or `trialPeriod` is null. A universally strict missing/null distinction would hold ordinary supported payments forever.

Section 5 deliberately avoids that availability failure. Its versioned API1/SDK3.10.0/decoder contract trusts documented required-nullable schema for the specified billing/trial/proration/scheduled-change structures. It records `schema_assumed_null`, validates non-null structures, and does not claim reconstruction of the original wire value. Unsupported versions, optional/dropped fields, GenericEvent data, and contradictory raw receipts are excluded from that assumption.

This is a narrower upstream trust contract, not an accidental validation omission. The exact price, transaction-item/line, and subscription constructors confirm the described collapsing behavior. Required non-null monetary fields retain exact strings or checked runtime values. A damaged authenticated response already collapsed by the official mapper can escape some detection; that limitation is accepted expressly. No new evidence establishes that a currently documented ordinary supported payment must remain unresolved under this chosen contract.

The plan correctly pins API version independently of npm version and notification destination. Public SDK `customHeaders` can set `Paddle-Version: 1`; it does not control destination versioning. Paddle documents those separate mechanisms in [versioning](https://developer.paddle.com/api-reference/about/versioning/).

**Decisive remaining gate:** P4/P5 must positively recover normal API-only initial monthly purchase, renewal, top-up, and explicitly allowed zero commercial purchase. An implementation that holds all four is rejected by the plan itself. Adverse fixtures must separately demonstrate that the assumption cannot override contradictory raw evidence. This is sufficient acceptance direction; replacing the SDK is not the smallest correction to a defect that has not been established.

## 4. Event identity, future types, and representation loss

**Trace considered:** reconciliation first admits an SDK-mapped event; a richer webhook later supplies the same event ID, or a decoder upgrade changes the observation hash.

The plan separates provider event identity, source receipt/digest, observation version, and financial fact identity. Event dedup therefore does not discard a later stronger receipt or create another completion. Raw stable envelopes exclude delivery identity; raw-to-mapped comparison uses jointly observable supported semantics. Incompleteness cannot masquerade as wire equality, and conflicting known fields cause hold/reconciliation.

That boundary matches the SDK: known notification constructors select fields; GenericEvent recursively transforms keys; `EventEntity` typing does not exclude future runtime events. Raw verified webhook bytes remain retained before DTO mapping. API-only unknown events are explicitly lossy, unsupported observations and produce no purchase fact. The plan does not promise later reconstruction of dropped fields.

For a newer object version with an unobservable mutable field, section 5 marks current state incomplete and retains the older value only as `lastKnown`. This closes the specific stale scheduled-change transfer risk. Partial evidence is combined only for the same event or object version. Adapter-specific accessors and the core's neutral schema protect a real trust boundary; they are not redundant copies of a Paddle model.

**Remaining gate:** raw/mapped compatible partial evidence, unknown key collisions, decoder upgrade, contradictory known fields, and newer-incomplete state must exercise the planned behavior. No source inspected demonstrates a contradiction in that behavior.

## 5. Ordering, cursors, and retention

Section 6 preserves exact timestamp fractions, uses per-object watermarks and CAS/locks, rejects equal-version contradictory content, and separates immutable payment extraction from current subscription state. A late completion can enter history without replacing a newer cancellation. `receivedAt` and API acquisition time are not invented provider versions.

The implementation must choose the comparator consistently for supported object projections; `updated_at` and envelope `occurred_at` have different meanings. The plan does not prescribe treating a later envelope timestamp as authority over an older object version. I therefore classify documenting the exact comparator in the contract implementation as a qualification detail, not an established stale-overwrite defect.

For scans, public `after`, `orderBy:id[ASC]`, and `hasMore` support the application-owned checkpoint. A page is durably admitted before cursor advance. A failed SDK collection is discarded because its private cursor may already have advanced. Unsupported mapped observations are admitted; an unmappable page leaves a visible gap. The plan correctly avoids claiming original custody of page members that the SDK never returned. [List events](https://developer.paddle.com/api-reference/events/list-events/) documents ID ordering and the 90-day limit.

Fixed windows overlap because documented bounds concern recorded time and are exclusive; wider sweeps and transaction-related adjustment checks supplement narrow scans. Neither a high watermark nor entity refresh claims complete historic recovery. SDK request filter lag and actual provider acceptance remain explicit gates, with a documented cursor/full-retention fallback. No hidden raw transport is introduced.

## 6. Completed management transactions and commercial classification

**Trace considered:** an active subscription's payment-update GET creates a zero transaction containing normal subscription items. Its completed event could resemble a free recurring purchase. Conversely, paying a past-due transaction through that checkout is a real recovery of an existing period.

The plan states that management purpose is not a top-up, method changes are not renewals merely because a subscription ID exists, trials and unsupported commercial profiles do not silently qualify, and explicitly approved zero-value purchases must still recover. Its tests require all these distinctions. A classifier table would improve implementation navigation, but the required behavior is already specified; calling its absence a monetary defect would overstate the evidence.

Primary [payment-update API](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/) and [guide](https://developer.paddle.com/build/subscriptions/update-payment-details/) confirm active versus past-due behavior. Subscription payment methods are tied to that subscription, while presenting saved methods for new purchases requires separate customer authentication; the plan preserves that authority distinction.

## Final disposition

Proceed to synthesis without a new correction from this reviewer. Keep the identified SDK fidelity, unmappable-page, retention, and noncancelable-call limits visible. Require the already specified positive recovery and monetary/security gates before release. Product portal identity and commercial refund/credit rules remain explicit policy decisions; they should not be smuggled into adapter defaults or mislabeled as SDK defects.

The reviewed plan's SHA-256 remained `55a2828dadae96c92e23a3d137ee5b3c52b9b7210c5c1d0211c8cdb9d430bcd7` after review.
