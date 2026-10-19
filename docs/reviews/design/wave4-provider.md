# Wave 4 independent review — provider semantics and evidence custody

**Input:** `research/reviews/wave4-plan.md`, complete immutable R3 snapshot, SHA-256 **`1cc43a1e8ed904e3f7dc1d85a496ff7769656173172be3a5bda5a5d4748713f9`**. Review date: 2026-10-19 UTC.

**Verdict: no new material findings.** I found no unaddressed P0, P1, or P2 contradiction in the provider/security/evidence lens. The recommendation is to retain this design and its qualification gates. This is a design review, not runtime qualification or permission to enable commercial fulfillment.

## Scope and independence

I read the complete supplied Russian handoff, complete Q v1.1.2, and complete frozen plan before reaching this conclusion. I used the retained `paddle-sdk.md`, `provider-contracts.md`, both dispute-resolution research reports, and `source-audit.md` as supporting evidence, then inspected relevant official source and exact published SDK JavaScript. I did not read peer reviews or a review journal. I changed no implementation, repository configuration, payment account, or immutable plan; ran no payment, contract, or sandbox tests; and performed no provider-account requests. The only output is this requested review file.

The source comparison concerned SDK 3.10.0, published archive `research/sources/paddle-node-published-3.10.0/package`, and retained main source `research/sources/paddle-node-sdk`, pinned by the plan to `651261beddfc65ba5f861729dca17044cbeffb5f`. I also reopened official Billing documentation for transaction completion, payment-update transactions, portal sessions, events, subscription schema, versioning, and the September 2026 filter changelog. The review does not infer supported behavior from a starter example or generated TypeScript declarations alone.

## Severity result

| Severity | New finding | Minimal corrective change | Remaining qualification |
| --- | --- | --- | --- |
| P0 | None established | None requested | No runtime safety claim follows from review |
| P1 | None established | None requested | Preserve P3–P5 monetary, recovery, and concurrency gates |
| P2 | None established | None requested | Preserve P4 exact SDK/API profile and P7 integration/security checks |

I specifically rejected several tempting findings below because the snapshot already gives their required behavior, narrows the guarantee honestly, or leaves the relevant implementation proof as an explicit future gate. Repeating those limitations as new findings would not improve the plan.

## 1. SDK-only acquisition now has a coherent useful contract

The key earlier tension is resolved in §5: a signed webhook retains original bytes and a stable raw envelope; SDK reconciliation retains a semantic observation with its actual source profile. Neither receipt is mislabelled as the other. Raw-to-raw conflict comparison covers the full canonical stable envelope. Raw-to-mapped comparison covers shared known semantics only. Event identity does not discard a later stronger receipt, and decoder changes cannot create a second payment fact.

This matches the inspected code. Published `PriceNotification` collapses absent/falsy `billing_cycle` and `trial_period` into null. Transaction item/line constructors do the same for `proration`; `Subscription` does so for `scheduled_change`. Constructors select fields rather than preserve arbitrary wire objects. The plan consequently does not promise lossless API replay, a raw API digest, or detection of every differing upstream byte. Relevant retained source paths are `dist/esm/notifications/entities/{price,transaction}/*` and `dist/esm/entities/subscription/subscription.js`; official [price mapping source](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/notifications/entities/price/price-notification.ts) shows the same boundary.

The important addition is the narrowly specified API1 + SDK3.10.0 + decoder trust profile. For the named required-nullable fields, mapped null can support semantic absence as `schema_assumed_null`; it does not masquerade as observed wire null. The official [transaction schema](https://developer.paddle.com/webhooks/transactions/transaction-completed/) marks price billing/trial and transaction proration fields required nullable; [subscription schema](https://developer.paddle.com/api-reference/subscriptions/get-subscription/) does so for scheduled change. The assumption is excluded for dropped/optional fields, GenericEvent, unknown structures, and conflicting raw evidence. This is an explicit upstream-schema trust decision with reduced malformed-response detection, not an accidental inference from TypeScript.

**Counterexample checked:** all normal missed completions become permanently held because SDK null cannot establish “no trial/no proration.” The named assumption removes that contradiction, and §5 explicitly requires successful API-only initial, renewal, top-up, and authorized zero-value recovery. A fixture suite that holds every purchase fails the gate. No raw transport exception is essential to satisfy the currently selected guarantee. The future gate must retain these positive outcomes as well as malformed and contradictory cases.

## 2. Pagination gaps remain visible rather than becoming false coverage

The retained `Collection.next()` updates `hasMore` and private `nextLink` before mapping all page members. A mapper exception can therefore move an in-memory cursor beyond unreturned data. Section 9 explicitly discards that object and reconstructs a fresh public collection from the durable pre-page cursor. Successful mapped-page admission and application checkpoint commit are atomic; unsupported/incomplete observations still count as acquired observations, without pretending they created payment confirmations.

The [events API](https://developer.paddle.com/api-reference/events/list-events/) documents `after`, ordering by event ID, and `has_more`. Reconstructing a query from the last admitted event ID is therefore supported by public semantics, even though `nextLink` is private. The exact published query serializer iterates supplied properties and snake-cases them; request-type extension can forward `from/to/filter`. It cannot improve response fidelity. The plan recognizes this distinction and requires actual API acceptance as a sandbox gate.

**Counterexamples checked:** a poison member, empty page with `hasMore=true`, nonprogressing ID, late visibility, or an event exactly on an adjacent date boundary. Each has a stated non-success path or overlap/sweep mitigation. The official [filter changelog](https://developer.paddle.com/changelog/2026/event-notification-log-filtering/) confirms exclusive recorded-time bounds and 90-day retention. Section 9 avoids inventing a visibility deadline or complete historical recovery after retention. A poison event can still block its own scan; that is a retained SDK fidelity/availability limitation, not a newly uncovered guarantee violation. P4/P5 must verify reconstruction, cursor stability, failed-page handling, and successful ordinary catch-up.

## 3. Checkout and customer authority are separated correctly

The plan requires saved server intent and offer snapshot before create, provider ID binding before checkout exposure, final composition validation, and account/environment scoping from trusted configuration. Browser success, price IDs, email, and `custom_data` do not confer fulfillment or management authority. Unknown-create recovery does not silently bind from copied metadata or a matching amount. If authoritative correlation is unavailable, manual resolution is an allowed outcome.

The initial `customer_id=null` path is also coherent. A saved transaction already binds the beneficiary to the local intent; the first observed payer does not redefine that beneficiary. Allowing null-to-customer observation therefore does not imply customer-wide account authority. A later non-null relationship change remains reviewable. This avoids manufacturing a customer-creation workflow merely to eliminate a normal draft state.

For management, the official [portal session API](https://developer.paddle.com/api-reference/customer-portals/create-customer-portal-session/) authenticates a customer, returns a general overview link, and describes subscription IDs as deep-link generation inputs. Section 8 correctly declines to treat those IDs as an application access sandbox. Sensitive management URLs and the SDK's missing `view_subscription` mapping do not become an alternate bypass. Local subscription actions can remain available without issuing customer-wide tokens. No additional identity framework is necessary to express that boundary; enabling broader portal authority is an explicit product decision and security qualification gate.

## 4. Success, retries, and classification preserve consumer expectations

Section 3 supplies operation-specific success meanings rather than a universal successful-payment interpretation of `succeeded`. Checkout-ready is not paid; cancellation scheduling includes effective timing; management completion is not a top-up; observations carry provenance and incompleteness. Capability checks and explicit unsupported results protect LSP without asserting full interchangeability before a second real adapter exists. Migration of active recurring contracts remains separately excluded.

The exact HTTP client performs a single fetch with custom headers; no retry loop, public AbortSignal, timeout, or client idempotency management appears there. Section 4's durable dispatch marker, mutation lane, conservative unknown state, and late-attempt observation fit those limitations. A lease cannot stop the external request. A lost response or an empty reconciliation query cannot authorize a second create. Nothing in this review establishes a need for custom transport.

The [payment-update API](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/) is the useful counterexample to method-based retry/classification: active subscriptions produce a new zero-value management transaction, while past-due subscriptions return the latest unpaid transaction. The plan explicitly assigns payment-method/recovery purpose, excludes new top-up semantics, requires renewal settlement/period evidence, and schedules zero-value/method-change and failed-renewal recovery assertions. Its §6 rule also excludes mid-cycle changes merely sharing a subscription ID. Thus neither `GET` nor `completed` nor positive amount alone is the authorization/classification rule.

I would preserve the retained provider report's classification table as implementation guidance, but adding another table is not a corrective finding: the frozen plan already states the relevant observable outcomes and gates. Initiating refunds and plan changes remains outside public v1, while their observations are retained; this is honest capability segregation rather than fake support.

## Conclusion

No new material findings from this independent provider audit. Retain the source-aware evidence contract, qualified schema assumption, positive missing-webhook recovery requirements, customer-authority boundary, operation-specific uncertainty handling, and explicit incomplete-coverage states. They are mutually consistent within the selected v1 scope. The implementation still has substantial work to prove the contract against recorded fixtures, real PostgreSQL boundaries, and an authorized nonproduction Paddle environment. Those required future checks are already named; their absence during a research-only assignment is not a defect in this plan.
