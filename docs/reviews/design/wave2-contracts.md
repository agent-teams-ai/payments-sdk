# Wave 2 — provider contracts and SDK-only evidence

Independent critic 1. Research only, 19 October 2026. Reviewed the complete frozen `research/reviews/wave2-plan.md`, the complete handoff `upload/Вставленный текст(2).txt`, and exact Q `research/sources/q/SKILL-v1.1.2.md`. Independently consulted `research/paddle-sdk.md`, `research/provider-contracts.md`, and both permitted dispute research files, then inspected the exact published SDK and current primary Paddle documentation. No peer reviews, implementation, account actions, or payment tests were used.

Input SHA-256: `28aebbb5b0c24231f2002e7aa2fb081d60e29cd98fe7a84e0173d55ab723a85a`. Verified before and after review; unchanged.

## Verdict

No P0. The SDK-only choice is defensible, and the plan has corrected the false full-wire custody/pagination promise. Do not reopen that decision by requiring a private transport, a generic evidence framework, or universal recovery from malformed provider responses.

Two contract clarifications remain: **P1 — give normal API-only reconciliation an explicit useful success contract**, and **P2 — forbid carrying older mutable field evidence into a newer projection as though it were current**. Both require small changes to the plan and focused future qualification. They do not require a new package or abstraction.

## 1. P1 — P4 has an absence qualification gate, but no mandatory liveness result for the supported profile

**Location:** plan §5, especially line 139; §§9/12, lines 228–236 and 299–309.

The plan correctly says that constructor-collapsed null does not establish original wire null. It then leaves absence-dependent trial/proration/scheduled-change branches on hold until P4 qualification. This is safer than inventing evidence, but it does not yet choose what successful qualification must establish. The mandatory supported profile is no-trial, no-proration purchases plus missed-webhook recovery; a qualification that merely records all API-only normal cases as incomplete would satisfy the present negative rules while leaving this core use case unusable.

**Concrete trace:** a valid recurring purchase is already bound to the local intent. Its `transaction.completed` webhook never reaches this application. `/events` or `transactions.get()` returns the normal completed object. `items[].price.trial_period` and item/line `proration` are null. SDK 3.10.0 maps both a legitimate null and an absent/falsy input to the same output null. If proving no trial/no proration is mandatory and that result stays unobservable, every repeat returns the same ambiguity. Reading the current entity through the same SDK does not add evidence. The payment remains held indefinitely despite successful provider completion and a healthy API. A one-time offer has an analogous nullable `billing_cycle` distinction.

**Effect:** the buyer paid but receives no quota/top-up until manual intervention; a brief webhook outage becomes a permanent operational queue rather than normal reconciliation. This is an availability failure, not evidence of duplicate issuance. It is also different from the explicitly accepted poison-page limitation: no malformed response, novel event, or mapper exception is needed.

**Primary evidence:** exact published files:

- `research/sources/paddle-node-published-3.10.0/package/dist/esm/notifications/entities/price/price-notification.js:20–37`, notably lines 26–27;
- `research/sources/paddle-node-published-3.10.0/package/dist/esm/notifications/entities/transaction/transaction-item-notification.js`, its proration constructor;
- `research/sources/paddle-node-published-3.10.0/package/dist/esm/notifications/entities/transaction/transaction-line-item-notification.js:13–25`;
- corresponding entity constructors `research/sources/paddle-node-published-3.10.0/package/dist/esm/entities/price/price.js` and `research/sources/paddle-node-published-3.10.0/package/dist/esm/entities/transaction/transaction-line-item.js` have the same collapse.

[Transaction completed schema](https://developer.paddle.com/webhooks/transactions/transaction-completed/) documents `billing_cycle`, `trial_period`, and proration as required nullable fields; these are not arbitrary optional extension properties. [Get transaction](https://developer.paddle.com/api-reference/transactions/get-transaction/) provides the corresponding authenticated entity representation. A schema-conforming response therefore provides a reasonable, bounded trust assumption even though the mapped object cannot prove conformance to the original wire shape.

**Smallest correction:** explicitly choose the following SDK-only profile now, leaving P4 to verify its implementation:

> For named required nullable fields in supported known Paddle API-v1 entities/events, the adapter trusts Paddle's authenticated response to conform to the documented field domain, and trusts the pinned official SDK's inspected mapping. A mapped null may establish semantic absence under this schema assumption. Record `schema_assumed_null`, SDK/decoder/API profile and acquisition provenance; never call it observed wire null. This assumption does not apply to optional/dropped fields, arbitrary GenericEvent data, unsupported structures or unknown profile versions.

For non-null objects, validate the retained required children, enums, identifiers, exact amounts, quantities and relationships. A contradictory raw receipt still creates a hold; the assumption must not override observed evidence. This deliberately sacrifices detection of a malformed server response that the SDK already collapsed, while preserving the ordinary integration contract. That is an honest engineering tradeoff supported by the documented schema. Raw payload custody would offer stronger diagnostics, but is unnecessary for this selected promise.

Bind that assumption to **Paddle API version 1**, as well as SDK 3.10.0 and decoder version. Exact SDK pinning alone does not pin the account's API version. [Paddle versioning](https://developer.paddle.com/api-reference/about/versioning/) says request version defaults to the account when omitted, supports `Paddle-Version`, and configures notification-destination versions separately. The inspected public SDK already accepts `customHeaders`: `research/sources/paddle-node-sdk/src/internal/types/config.ts:3–6`; the client spreads them into headers at `src/internal/api/client.ts:37–43`. Use that public seam, record the expected notification-destination version in deployment qualification, and reject an unsupported configured profile. No transport replacement is needed.

**Future acceptance evidence:** P4/P5 must prove that a normal bound initial monthly purchase, renewal, one-time top-up and approved zero-price commercial purchase all complete from SDK-only evidence after withholding the webhook. Assert a confirmation and exactly one downstream commercial basis; “held safely” is a failing result for these fixtures. Separately show actual trial/proration objects and method-change origins remain non-granting; schema-assumed null provenance survives persistence; a later contradictory raw receipt is retained and held; unsupported versions remain incomplete. These are meaningful positive and negative expectations, not tests reproducing constructor syntax.

**Gate distinction:** the plan already has P4 qualification and missing/null tests. I am not reporting their unperformed implementation as a defect. The missing decision is the gate's required positive outcome and explicit trust boundary. If the author declines the assumption, narrow the advertised API-only recovery capability before implementation; an unqualified mandatory promise should not remain alongside blanket holds.

## 2. P2 — unknown must not silently promote older mutable evidence to the current object version

**Location:** §5 line 139 (“unknown, not a command to clear projection”); §5 line 161 (subscription feed); §6 lines 182–186 (watermarks and cancellation).

The partial-source comparison rule is correct for representations of the same event/version. Its interaction with newer mutable snapshots is unspecified. “Unknown does not clear” can be implemented as a sparse merge that retains a previously known field while advancing the aggregate version. That creates an apparent current state no source actually established.

**Concrete trace permitted by the current rules:** raw version V1 shows `active` with a scheduled cancellation at time E. An external authorized action removes that schedule. The V2 webhook is missed; a newer SDK subscription observation contains `scheduledChange=null`. Under the plan's current unqualified collapse rule, that field is unknown. A sparse merge retains V1's cancellation while advancing status/version to V2, then publishes `ObservedSubscriptionEvidenceChanged` with an aggregate V2 provenance. Commercial Access or the management UI now receives an apparently current scheduled cancellation that the newer source did not establish. Repeated reads do not repair it under the strict profile. The same mistake can occur when another field becomes unobservable after a decoder/profile change.

**Effect:** the app may display a cancellation that no longer exists, suppress a renewal workflow, or terminate paid access at the stale date. Keeping the old value for audit is correct; representing it as authoritative current evidence is not. The problem persists for genuinely optional/unobservable fields even after finding 1 qualifies ordinary nullable fields.

**Primary evidence:** exact SDK `research/sources/paddle-node-published-3.10.0/package/dist/esm/notifications/entities/subscription/subscription-created-notification.js:38–56` and `research/sources/paddle-node-published-3.10.0/package/dist/esm/entities/subscription/subscription.js` preserve `updatedAt` but collapse `scheduled_change`. [Get subscription](https://developer.paddle.com/api-reference/subscriptions/get-subscription/) documents nullable scheduled change and the object update timestamp. The source-aware model therefore has enough information to distinguish a newer incomplete snapshot from older complete field evidence; it must preserve that distinction in the outward contract.

**Smallest correction:** add one merge rule: evidence compatibility is scoped to event identity or the same provider object version. When a newer object version cannot establish a mutable field, the current projection marks that field unknown/incomplete; it may retain `lastKnown(value, sourceVersion)` separately for diagnostics. It must not present the last-known value as current or certify absence from an older version. This does not erase an immutable payment fact or overwrite history. No per-field database framework is required: the existing observation schema can carry source version and a current/last-known distinction for decision-relevant fields.

**Future acceptance evidence:** V1 scheduled → V2 unknown must not publish a current schedule at E; V2 later explicit/qualified null resolves the uncertainty; a compatible stronger receipt for V2 enriches once; a delayed V1 receipt cannot restore the canceled schedule as current. Repeat for a genuinely unobservable field under a profile transition. Assert the downstream snapshot and effect, not merely that a flag exists.

## Contracts that withstand this review

The following are resolved boundaries, not additional findings:

- **First customer:** §4 expressly allows a saved transaction binding's initial `null → observed customer`, retaining the local beneficiary. This avoids an unnecessary customer-creation workflow. A later non-null customer replacement requires review; shared email creates no portal authority. The permitted independent payer is a product choice already stated in the plan.
- **Unknown create:** durable dispatch-start, no automatic re-create, late response admission, mutation lanes and audited `resolveUnknownOperation` handle uncertainty honestly. A null-customer lost response may remain manual because correlation is insufficient; the plan does not promise automatic identification from email/price/metadata. Do not demand invented cryptographic metadata or absolute find-by-intent recovery.
- **Classification:** completion is a candidate confirmation boundary, not sufficient purchase identity. §6 excludes method update and mid-cycle/additional subscription operations as automatic renewals. P2/P4 should use a small explicit table: bound initial/one-time purchase; established-subscription recurring period; method update; recovered existing past-due transaction; unsupported origin/basket. A management operation returning an actual overdue renewal does not change that transaction into a new top-up. [Payment-update API](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/) documents the active-zero/past-due-existing distinction. This table is qualification detail under an already stated design, not a third severity finding.
- **Mixed-source evidence:** separate receipts/digests, raw-to-raw canonical comparison, compatible shared semantics and no second commercial fact for stronger evidence are appropriate. Differences in dropped API fields are not contradictions. Different known transaction IDs/amounts for one event remain conflicts.
- **Recovery limits:** fixed overlapping windows, durable application cursor, discarding a mapper-failed Collection, separate scans, 90-day retention and visible gaps are coherent SDK-only limits. The plan no longer claims a poisoned page's raw members were durably admitted. No primary evidence found makes every valid current supported page inherently poisonous.

Q favors these bounded corrections: state the actual invariant and the chosen assumption, preserve observable contracts, and keep SDK/version knowledge in the Paddle adapter. It does not justify escalating every lost wire distinction into a new acquisition subsystem.
