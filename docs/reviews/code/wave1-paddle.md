# Wave 1 independent review — Paddle SDK boundary

Review date: 2026-10-19 UTC. Frozen revision: **786663cfb63af204e98c73ea92b1ce4f850359a5**. Reviewed checkout: `/workspace/scratch/9e36ca3bbd13/implementation/review-w1-paddle` (detached worktree). No production source was edited.

## Decision

**Do not accept this revision yet: two P1 findings at the provider/core evidence boundary.** Neither finding requires replacing the official SDK, importing its private modules, intercepting production fetch, or widening the declared nullable-field trust profile. No P0 finding. No additional adapter-only P2 finding met the evidence bar.

The existing Paddle contract suite passes on Node **24.21.0** and **26.11.1**, with the exact published **@paddle/paddle-node-sdk 3.10.0** and test-only **undici 7.24.0** `install()`/`MockAgent`. Both new reproductions pass on both runtime floors, asserting the defective behavior described below. The reproductions disable all real network connections, use synthetic credentials and HMAC secrets, and restore every installed global descriptor and the previous dispatcher in `finally`.

Reproduction file: `/workspace/scratch/9e36ca3bbd13/implementation/review-w1-paddle/review-probes/paddle-boundary.test.ts`.

## P1 — Refresh discards the representation named by its persisted source digest

### Locations and ownership

- `packages/payments-core/src/runtime.ts:178–201`: `refreshPurchase`, especially line **187**, and `refreshSubscription`, especially line **200**.
- `packages/payments-core/src/contracts.ts:28–35`: `PaymentProvider` exposes neutral reads without a full `VerifiedInput` acquisition contract.
- `packages/payments-paddle/src/provider.ts:30–40`: `apiReceipt` correctly hashes and retains a versioned SDK-mapped representation.
- `packages/payments-paddle/src/provider.ts:81–108`: `readTransaction` / `readSubscription` strip that representation; `readTransactionInput` / `readSubscriptionInput` already expose the correct complete receipt.
- `packages/payments-core/src/reducer.ts:207–210`: identical receipt ID and claimed representation digest are treated as duplicate, preserving the first retained representation.

This is a core/provider contract integration defect. Paddle constructs the full receipt correctly; the public core refresh path discards it and fabricates another body under its identity.

### Reproduced trace

1. Start a normal monthly purchase through `createPayments` and the real Paddle SDK, with a synthetic POST response. The runtime durably binds the returned transaction ID.
2. `PaddlePaymentProvider.readTransactionInput(ref)` fetches a completed transaction. `apiReceipt` constructs `{ representationKind: 'sdk_mapped_observation', sdkVersion, decoderVersion, projection, diagnostic }` and hashes that exact representation. The retained representation's hash equals `source.representationDigest`.
3. `runtime.refreshPurchase` fetches the identical transaction through `provider.readTransaction`. The returned observation still contains the digest and receipt ID from step 2, but the full representation is no longer available.
4. Runtime line 187 persists `JSON.parse(canonicalJson(value))` as `retainedRepresentation`. That is the neutral observation, including its source, rather than the representation used to derive the receipt. The call reports `{ kind: 'succeeded', value: 1 }`.
5. Re-admitting the genuine `readTransactionInput` receipt produces `duplicate`. The already persisted wrong body remains; the duplicate path does not repair it.
6. `refreshSubscription` repeats the same defect for a normal bound subscription.

Deterministic Node 24 / Node 26 output:

| Object | Claimed representation digest | Hash of actually retained representation |
| --- | --- | --- |
| Transaction | `785d6352153fd0531c52b9db02f59697f2d859c5329da0e0452286eabd107381` | `573429d38cbc6bccbbc6f091a4ebe108b0388612c35361cf8e387959b6a4fe07` |
| Subscription | `3fc6e17c8a9722ca0913c543b124a9ebedcbb4c9ed68a09c27ceeb2b1f960283` | `9d2ef5b8d7ef8163512cc854951faac3b5326c3d30a4f75ced21af08693dabd9` |

The test also reloads the stored reduction input before and after the later authentic receipt; both retain the mismatch.

### Impact

Every successful built-in refresh can claim custody of evidence it never persisted. The mapped diagnostic needed for audit, decoder diagnosis, or a later replay is lost locally, even though it was available from the adapter. The receipt cannot be verified against its stored representation, and admitting the original complete receipt afterward does not restore custody. This contradicts implementation-plan §5's requirement that each source representation have its own honest receipt/digest and the narrower SDK-only evidence contract; it is separate from the SDK's accepted wire-data loss.

This is not a claim that SDK-mapped diagnostics are original Paddle response bytes. They are explicitly lossy and correctly labelled by `apiReceipt`; the defect is replacing even that declared representation.

### Minimal fix

Add a small provider-neutral evidence-acquisition capability returning `ProviderResult<VerifiedInput>` for transaction and subscription refresh. Paddle's existing public `readTransactionInput` and `readSubscriptionInput` already implement it. The core should validate scope and requested entity identity and durably admit the returned receipt unchanged. A provider that cannot return this acquisition result should return an honest `unsupported` result for durable refresh, or construct a separately named projection-only receipt with a digest of the actual retained representation. It must not reuse another representation's receipt ID/digest.

Do not expose SDK DTOs to the core or synthesize the missing diagnostic from the neutral projection. Ordinary neutral reads can remain available.

### Required regression test

Use public `runtime.refreshPurchase` and `runtime.refreshSubscription` with the actual published Paddle SDK and MockAgent, not direct adapter methods alone. Assert that the input stored by the payment owner is the complete adapter receipt and that `digest(retainedRepresentation) === source.representationDigest` for these authenticated API receipts. Exercise restart/reload and duplicate admission as well. If legacy bad receipts must be repaired, provide an explicit integrity-preserving migration or replay repair rule rather than silently mutating immutable receipt content.

## P1 — Same event ID bypasses known-field conflict checks whenever an API receipt participates

### Locations and ownership

- `packages/payments-core/src/reducer.ts:216–224`: `admitInput` checks an existing event identity only when **both** receipts have `stableEnvelopeDigest`.
- `packages/payments-core/src/reducer.ts:13–15`: `semantic` excludes `source`, so later object-version comparison does not compare event headers.
- `packages/payments-paddle/src/provider.ts:194–199`: `readEventPage` supplies directly observed `eventId`, `eventType`, and `occurredAt`, correctly without an invented raw stable-envelope digest.

This is a core admission contract defect exposed by the Paddle adapter's honest distinction between raw webhook and mapped API receipts. The adapter must not fix it by inventing a wire digest for mapped JSON.

### Reproduced trace

The reproduction creates two separate, locally authorized one-time purchase intents and binds two synthetic Paddle transaction IDs through actual SDK checkout creation. It then admits the following two receipts:

| Certified field | Signed webhook | Real SDK `/events` result |
| --- | --- | --- |
| `eventId` | `evt_01j00000000000000000000001` | same ID |
| `eventType` | `transaction.completed` | `transaction.updated` |
| `occurredAt` | `2026-10-01T00:00:00.123456Z` | `2026-10-02T00:00:00Z` |
| Transaction ID | `txn_01j00000000000000000000001` | `txn_01j00000000000000000000002` |
| Data status | `completed` | `completed` |
| Catalog / ownership | valid for intent A | valid for intent B |

The webhook is authenticated with the official SDK's signature validator. The event page traverses the actual SDK's public event resource and constructors. Both bodies use supported schema shapes; this test does not depend on a new event type, missing field, null collapse, unknown DTO key, or malformed SDK response.

Both `ingestVerifiedInput` calls succeed. Both `processInbox` calls return `processed`. Both purchases acquire a `completion`; both transaction aggregates have `flags: []`. The raw event has `stableEnvelopeDigest`, but the API receipt correctly does not, so the second receipt bypasses lines 217–218 entirely. The per-object reducers do not connect the contradictory event to the first object.

The probe asserts and prints `bothProducedCompletion: true` on both Node floors. This establishes the missing conflict handling; it does not claim an unauthenticated client can forge Paddle signatures or API responses.

### Impact

The source contract promises that an event identity links its receipts and that contradictory certified common fields cause a hold. Here an impossible same-event identity can support two independent unheld financial facts. Even when the transaction ID stays the same, contradictory known event type/time is silently accepted because those fields are removed with `source` before comparison.

Raw/raw stable-envelope checking is insufficient for raw/API and API/API evidence. This is not a demand for full wire equality across sources. Paddle 3.10.0 retains the specific header and entity identity values used in this reproduction, so comparing them does not overstate its evidence.

### Minimal fix

For receipts sharing the scoped provider event ID, add a provider-neutral common-evidence compatibility check independent of receipt kind. At minimum compare both-known event type, exactly normalized occurrence time, and certified entity kind/reference. Compare jointly known normalized decision fields where the common projection supports them, while preserving unknown/missing compatibility. Keep the stricter raw/raw stable-envelope digest check as a separate rule.

On a contradiction, retain both immutable receipts, quarantine the incoming conflicting input, flag/fence **all** previously and newly routed affected aggregates, and publish the hold through normal durable obligations. The already published first fact remains historical evidence; it must become held by a new revision rather than be deleted. Apply the same rule atomically in PostgreSQL T1 admission and the memory contract store. Prefer one core-owned pure compatibility helper reused by both adapters so the event rule does not drift between stores.

Do not compare arbitrary SDK-mapped diagnostics as if they were original wire data. Do not compare timestamp strings literally: equivalent offsets or fractional spellings should remain compatible.

### Required regression test

Run raw→API, API→raw, and API→API for the same event ID. Independently change type, occurrence instant, and entity reference, asserting durable conflict/hold for every affected aggregate and no second eligible effect. Include equivalent RFC3339 spelling as a compatible case; include raw/mapped presence differences and SDK-dropped fields as compatible partial evidence. Exercise both the memory store and PostgreSQL's atomic admission path, including receipt concurrency and a previously acknowledged first completion.

## Review coverage and evidence

Read Q v1.1.2 in full and applied its contract/substitution guidance, rather than reporting file layout or style. Inspected all Paddle source and test files and the relevant implementation-plan, provider-contracts, Paddle source audit, and SDK evidence decision. Inspected the retained source snapshot and exact published 3.10.0 implementation, especially transport/errors, resources, event collection mapping, transaction/price/adjustment constructors, and signature validation.

Primary provider sources consulted to verify current schema/operation assumptions:

- [transaction.completed schema](https://developer.paddle.com/webhooks/transactions/transaction-completed/)
- [Get transaction](https://developer.paddle.com/api-reference/transactions/get-transaction/)
- [List events and pagination/filter parameters](https://developer.paddle.com/api-reference/events/list-events/)
- [List adjustments](https://developer.paddle.com/api-reference/adjustments/list-adjustments/)
- [Cancel subscription](https://developer.paddle.com/api-reference/subscriptions/cancel-subscription/)
- [Payment-update transaction: GET can create an object](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/)
- [Get subscription, including canceled current-period null](https://developer.paddle.com/api-reference/subscriptions/get-subscription/)
- [Pinned official SDK Collection source](https://github.com/PaddleHQ/paddle-node-sdk/blob/651261beddfc65ba5f861729dca17044cbeffb5f/src/internal/base/collection.ts)

No separate defect was established for exact raw signature custody, unsupported event retention/adverse barriers, selected `schema_assumed_null` mappings under the declared trust profile, line/price identity or signed adjustment allocation preservation, explicit cancellation timing, payment-update mutation uncertainty/purpose, customer-wide portal authority, or reconstruction of failed event pages from the durable cursor. Existing documented limits of the public SDK remain limits; they are not new review findings.

## Verification and remaining gates

Commands used from the detached worktree:

```sh
/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node node_modules/typescript/bin/tsc -b packages/payments-core packages/payments-paddle
/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node --test packages/payments-paddle/test/sdk-contract.test.ts
/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node --test review-probes/paddle-boundary.test.ts
/workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node --test review-probes/paddle-boundary.test.ts packages/payments-paddle/test/sdk-contract.test.ts
/workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node --test review-probes/paddle-boundary.test.ts
```

Build passed. Existing suite: 15 tests passed per runtime. Added reproductions: 2 passed per runtime. A passing reproduction asserts the current defect; after correction these should be converted to the expected guarantees above.

**New acceptance gates:** the two specified regression families must pass after fixes, including the corresponding PostgreSQL admission path for the event-identity rule. **Existing gates remain:** actual provider/sandbox behavior, date-filter acceptance, live pagination visibility, cancellation state/cutoff cases, payment-update recovery, and customer portal authority behavior have not been account-tested here. This review performed no credentialed network access, live writes, or sandbox mutations and does not upgrade offline SDK probes into provider integration qualification.
