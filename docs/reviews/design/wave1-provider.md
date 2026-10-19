# Wave 1 — independent Paddle/provider-contract review

## Scope and verdict

Reviewed the complete immutable `wave1-plan.md`, SHA-256 `bf6902d8bbba502ce4b93492dc5646d0a1a704e575f0f98fabf012f61ccb6cce`, the supplied Russian brief, all of Q v1.1.2, `research/paddle-sdk.md`, and `research/provider-contracts.md`. Inspected relevant files in the exact published Paddle Node SDK 3.10.0 snapshot and checked current primary Paddle API/guide pages. No peer review was read. No account, checkout, API mutation, implementation, or plan edit was performed.

**Verdict: changes requested before treating this as an implementation-ready provider plan.** One P1 inconsistency affects the specified recovery/evidence path. One P2 omission leaves the first-customer purchase path ambiguous. No P0 found. The correction is local to the provider/admission contracts; it does not require changing the core/component split or introducing a central service.

## P1 — The chosen public SDK event reader cannot supply the original evidence that the admission and conflict protocol requires

**Locations:** §5 “T1: принятие webhook,” especially canonical stable envelope comparison and retention of original evidence; §9 reconciliation, especially “body страницы проходит тот же trusted API admission” and the conclusion that an extended query type on public `events.list` is the minimal sufficient solution; §12 P4/P5 qualification.

**The inconsistent guarantees.** §5 correctly separates original authenticated payload custody from SDK DTO mapping, and compares the stable `{event_id,event_type,occurred_at,data}` for a repeated event ID. §9 then selects `paddle.events.list(...)` plus a locally extended query type as the reconciliation path. That extension addresses outgoing `from`/`to`/`filter` serialization only. It does not provide the incoming original page or original `data`.

The published SDK's actual path is:

1. `EventsResource.list` creates `EventCollection`.
2. `Collection.next` obtains a page, updates its private pagination state, and maps every item with `fromJson` before returning an array.
3. `EventCollection.fromJson` calls `Webhooks.fromJson`.
4. Known events construct specific notification classes. Those classes camel-case selected fields, convert some absent/falsy fields to null, and discard unlisted fields. Unknown events use `GenericEvent`, which also changes key casing.

This is not an identity-preserving JSON container. For a concrete current example, the current `subscription.created` documentation includes `data.consent_requirements`; SDK 3.10.0 `SubscriptionCreatedNotification` does not retain it. The existing documented portal-link lag in the research establishes the same general limitation, but the event collection itself is enough to establish this finding. Neither a TypeScript extension nor casting the returned entity back to a wire DTO restores discarded JSON.

**Failure scenario.** A valid subscription event is first stored from its signed webhook. The same event later appears during an overlapping `/events` scan. A full canonical comparison of raw `data` against SDK-mapped `data` reports a false conflict because key names and/or fields differ. If admission instead stores the SDK entity as though it were the original wire evidence, a reconciliation-only event silently loses fields and cannot be replayed faithfully after an adapter upgrade. A known event shape that a constructor cannot map can also throw before any page array is returned. Keeping the checkpoint unchanged prevents loss but leaves the planned full-page admission blocked; there is no original page available through this chosen public return value to quarantine the offending member and recover the rest.

**Smallest correction.** Add an explicit raw-event-page acquisition seam inside the Paddle adapter. A narrowly scoped authenticated **read-only** `/events` reader using the official API is justified here by a verified missing SDK capability; continue using the official SDK for supported operations and signature verification. Persist the original page's stable event envelopes and relevant pagination metadata before running the optional SDK mapping. Keep credentials, transport, and wire types entirely inside the adapter. Do not access private SDK client/collection fields or monkeypatch global fetch in production to capture responses.

Alternatively, explicitly weaken and redesign the contract: distinguish `raw_event_receipt` from `mapped_api_observation`, define a versioned common projection for semantic comparisons, and do not claim original-payload preservation or full-wire conflict detection for the latter. That is a valid tradeoff only if the plan also specifies how mapping failures and previously unknown fields are recovered. Treating a normalized entity as raw evidence is not a valid shortcut.

**Required qualification addition.** Use a recorded `/events` page and corresponding webhook for the same event, including an extra documented/unrecognized field. Prove that duplicate identity is recognized without a false wire conflict, original evidence survives, and a mapping failure is durably represented without either advancing past an unadmitted page or permanently losing the other page members. These are adapter contract checks, not assertions that a method exists.

**Primary evidence:** [official List events API](https://developer.paddle.com/api-reference/events/list-events/) documents the wire envelope and pagination; [official subscription.created](https://developer.paddle.com/webhooks/subscriptions/subscription-created/) documents the current event shape. Source at the researched runtime-equivalent commit: [EventsResource](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/resources/events/index.ts), [Collection](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/internal/base/collection.ts), [EventCollection](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/entities/events/event-collection.ts), [SubscriptionCreatedNotification](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/notifications/entities/subscription/subscription-created-notification.ts), [GenericEvent](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/notifications/events/generic/generic-event.ts). The same paths were inspected in the extracted 3.10.0 JavaScript/declarations.

## P2 — Specify the first-purchase customer binding, including a draft transaction that initially has no customer

**Locations:** §3 `StartPurchase` and customer/subject authorization; §4 steps 4–6; §8 customer reuse and management authority; §12 first-purchase and same-email tests.

The plan is appropriately strict about a saved transaction/buyer binding, changed checkout customers, and shared-account portal authority. It never chooses the concrete initial customer acquisition branch. `StartPurchase` contains only local `buyerId`, offer, and request key; there is no stated contact/customer resolver contract. The creation workflow does not say whether it sends a resolved `customer_id` or deliberately starts a draft without one. Yet later binding predicates require a matching customer/subject and tests expect changed customers to quarantine.

This matters for the ordinary first purchase, not only a future identity feature. The official create-transaction API permits an omitted `customer_id`, producing a draft transaction. The customer guide explicitly supports Checkout creating customers and reusing an existing customer when the entered email already exists. Thus a successful first checkout may naturally change the transaction from `customer_id=null` to an existing shared-account customer.

**Failure scenario.** A new ReviewRouter buyer opens a server-bound draft and pays using an email that already exists from another product. A literal implementation of “customer changed → quarantine” rejects the valid first purchase. An implementation that instead treats the newly observed customer as proof of the buyer's wider identity risks relaxing the customer-wide management gate that §8 correctly requires. Neither outcome is intended, and the plan should not leave the distinction implicit.

**Smallest correction.** Choose and document one default. Checkout-led customer creation is the smaller supported path: bind the original transaction to the authenticated local buyer before exposure, explicitly permit the initial `null → observed customer` transition on that already-bound transaction, retain the observed customer as its payer/billing relationship, and grant no customer-wide authority from it or its email. Define whether a subsequent non-null customer replacement is rejected, reviewed, or permitted by a saved application policy. A payer and a local beneficiary need not be the same identity; the contract must state the selected rule.

If the default instead pre-creates/resolves customers, name the server-owned contact input/resolver and operation ownership, including duplicate-email races and unknown customer-create outcomes. It still must not use an email match to recover subscription/portal authority. This is a small workflow decision, not a reason to add a general identity service.

**Qualification addition.** Exercise first buyer with no customer, first buyer whose checkout email reuses a customer from another app, subsequent checkout using a different billing email, and a changed non-null customer on an already-bound transaction. Assert both the intended purchase outcome and continued denial of customer-wide tokens/portal access without the stronger authority profile.

**Primary evidence:** [Create a transaction](https://developer.paddle.com/api-reference/transactions/create-transaction/) defines optional customer and draft/ready behavior; [Create or update customers](https://developer.paddle.com/build/customers/create-update-customers/) defines automatic Checkout creation and email reuse; [Paddle.Checkout.open](https://developer.paddle.com/paddle-js/methods/paddle-checkout-open/) distinguishes customer prefilling from customer authentication tokens. This finding is an incomplete contract, not a demonstrated exploit in code that does not yet exist.

## Decisions checked and not reported as defects

- The conservative `dispatch_started → outcome_unknown → reconcile` treatment follows the official arbitrary-idempotency-key limitation and inspected one-fetch SDK behavior. It does not claim that a lease, deadline, request ID, or 5xx response proves nonexecution.
- `completed` as the selected confirmation point is explicit and defensible. The plan separately excludes payment-method-change/trial/unsupported completions and permits approved zero-payable commercial cases; it does not equate every completion with a cash charge or every subscription update with a renewal.
- Past-due API period-end cancellation versus portal immediate cancellation, paused immediate-only behavior, and near-billing rejection are carried into the contract. There is no silent timing substitution or automatic-refund claim.
- Customer-wide portal authority is correctly separated from app-local subscription ownership. `subscription_ids` is not advertised as an authorization sandbox, sensitive pregenerated links are not used to bypass the gate, and shared merchant credentials are not misrepresented as hard app isolation.
- Both adjustment event types, initially final adjustments, partial allocations, reversal identity, and chargeback warnings are included. Deferring financial-to-usage-credit policy to its owner is appropriate; inventing an automatic negative grant would be worse.

## Residual risks and closure

The documented sandbox gates remain necessary: actual checkout mutation behavior, management-link authentication, exact classification of recovery/zero-value transactions, current filter acceptance, and cancellation edge states. Offline SDK source inspection cannot qualify these provider-account behaviors. Their presence as explicit future gates is not itself a defect in a research-only deliverable.

No second real provider is needed to close these findings. Close P1 by making acquisition/retention/comparison compatible with the actual SDK boundary, and close P2 by specifying the ordinary initial customer transition. Preserve the existing customer-wide authority, conservative mutation recovery, and financial-fact/component boundaries.
