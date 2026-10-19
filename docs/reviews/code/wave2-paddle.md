# Wave 2 independent review — Paddle SDK boundary and durable reconciliation

Review date: 2026-10-19 UTC. Frozen revision: **64242b3c0112f21a22d3098c0aedee2c414c4cce**. Detached checkout: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-paddle`. No production source was edited. Later incoming consumer and historical-version changes are outside this frozen review.

## Verdict

**One P2 finding: unsupported future transaction/subscription event names discard an available entity route.** No new P0 or P1 finding was established. The new durable acquisition path, SDK cursor recovery, and source-representation custody passed the focused gates on both declared runtime floors.

This finding is explicitly conditional on a future event name: every transaction and subscription event name listed in the current official API reference and published SDK 3.10.0 is covered by the decoder's current sets. The defect is in the promised unsupported-event path, not an assertion that Paddle currently emits `transaction.future_event`.

The exact published `@paddle/paddle-node-sdk` **3.10.0**, test-only `undici` **7.24.0**, Node **24.21.0** and **26.11.1**, and local PostgreSQL were used. Existing focused cases pass: core reconciliation 5, SDK contract 15 including its enclosing test, and PostgreSQL reconciliation 8. The independent reproduction passes on each runtime; it asserts the defect and also checks the fatal invalid-UTF-8 guard. Combined Node 26 output: **29 tests passed, zero failed**. Node 24 ran the same sets in separate commands, with the database URL explicitly supplied for integration/reproduction runs.

## P2 — Unknown financial event names lose their known entity route

### Locations

- `packages/payments-paddle/src/observations.ts:153–165`, especially line **158**: the ordinary unsupported-event return bypasses the route extraction used by the decoder-error branch.
- `packages/payments-paddle/src/provider.ts:194–201`: actual SDK `GenericEvent` results pass through that branch. Only adjustment events receive the separate adverse-transaction fallback.
- `packages/payments-core/src/reducer.ts:207–209,215–222,328–353`: routing and unsupported holds depend on the neutral transaction/subscription references. A route-free unsupported observation is processed without touching an aggregate.

### Reproduction and evidence

Independent probe: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-paddle/review-probes/paddle-wave2.test.ts`.

1. Create a locally authorized one-time purchase through the public runtime and actual SDK; refresh a completed transaction through the actual SDK into PostgreSQL. Assert a completion exists and the aggregate has no flags.
2. Create a synthetic future entity event, `transaction.future_event`, with an authenticated `data.id` equal to that transaction and a later `updated_at`. Verify the raw receipt with the official SDK signature verifier. The neutral unsupported observation has no transaction reference, even though the retained raw body supplies one.
3. Return that same event through a MockAgent `/events` response. The published SDK's public `EventCollection` selects `GenericEvent`, which camel-cases `data` and preserves `data.id`. The production adapter again returns a route-free unsupported observation.
4. Run `beginScan` and `resumeScan` through `createPaddleReconciliationSource` and `createPaymentReconciler`. The receipt is durably retained and the checkpoint advances to `complete`.
5. Process the acquired inbox item through the public payment runtime. It returns `processed`. The existing transaction still has its completion and `flags: []`.

Deterministic result on both runtime floors:

```json
{"rawRoutes":[],"mappedRoutes":[],"inboxOutcome":"processed","flags":[],"scanStatus":"complete"}
```

The `subscription.future_event` path has the same early return, so its available `data.id` is also discarded. This review does not claim a corresponding future-adjustment financial bypass: the provider separately preserves its `transactionId` as `adverseTransactionRef`.

### Impact and scope

The unsupported receipt remains available by its receipt/event identity, but it cannot be associated with the already known transaction/subscription through the normal routing contract. The reducer therefore cannot publish the existing unsupported-state hold for that entity, and a later decoder/review cannot discover it through the entity's ordinary bounded working set. Prior confirmed evidence stays unheld after an authenticated unfamiliar entity change.

The minimal defect is loss of certified routing, independent of what the future event means. No future financial schema needs to be trusted or positively interpreted to preserve an exact, valid entity ID. The finding does not claim that an unauthenticated caller can produce a valid Paddle signature or authenticated API result, and does not claim complete history from the exhausted scan.

### Minimal fix

Factor the existing unsupported route extraction into one small adapter-local fallback used for both an unknown event name and a known event's decode failure. For a recognized entity prefix, preserve only independently validated Paddle references: `transaction.*` can preserve `data.id` as `transactionRef`, `subscription.*` can preserve `data.id` as `subscriptionRef`, and adjustment routing can preserve its exact parent transaction reference. Preserve the original representation and leave all unfamiliar financial meaning unsupported. Do not run the supported nullable-field trust assumptions against a `GenericEvent`.

The cursor may still advance once the unsupported receipt is durably admitted: a returned unsupported member is acquired evidence, unlike an SDK mapper exception. What must survive is the entity route so the existing hold/review path remains available.

### Required regression

Use signed raw input and an actual SDK `/events` `GenericEvent` for unknown transaction and subscription event names. Begin with a completed transaction or active bound subscription, acquire/process the unknown receipt, and assert that its validated route survives and that ordinary reduction publishes unsupported/held evidence. Assert retained-representation digests, restart/reload, and terminal cursor progress. Include an unrelated unknown entity type and malformed IDs so routing is not guessed from arbitrary payload strings. Keep the existing returned-unsupported-adjustment test and SDK mapper-poison test; their acquisition semantics are intentionally different.

## Verified areas without another material finding

### Official SDK and narrowed API1 trust

Read the exact published ESM implementation and retained official repository source, including the SDK client, resources, event dispatch, generic-event conversion, collection lifecycle, transaction/price/item/line constructors, subscription mapping, and adjustment mapping. Core imports remain provider neutral. Production uses public SDK exports and resources; it does not patch global HTTP, import a private SDK path, or substitute an own HTTP acquisition implementation.

The selected mapped-null assumptions match the declared API1/SDK3.10/decoder1 profile: price billing cycle/trial, transaction item and financial-line proration, and subscription scheduled change. Current official transaction API and webhook schemas list item/line proration as required nullable, despite some examples omitting the property. Unsupported types never enter the supported decoder sets. Other collapsed fields such as mapped null customer/subscription/current period remain unknown. I did not expand this accepted, explicitly lossy contract into original-wire custody.

### Signature and immutable representation custody

Raw bytes use fatal UTF-8 decoding before official signature verification. The independent probe signs a valid JSON body containing a replacement character, proves that string verifies, replaces its UTF-8 encoding with byte `0xff`, and proves the byte input is rejected as validation rather than accepted after lossy decoding. Existing checks cover exact-body changes, stale signatures, wrong secrets, malformed headers, stable event envelope identity, and retained-body replay integrity.

The wave 1 refresh-custody and certified common-event-identity fixes are present. Public transaction/subscription refresh retains the actual adapter receipt and matching representation digest. PostgreSQL reconciliation retains compatible raw/mapped receipts and fences contradictory certified event identities on both affected routes. The API receipt retains a versioned SDK-mapped diagnostic rather than claiming it is original response JSON.

### Mutation semantics, money, identity, time

The payment-update GET calls `getPaymentMethodChangeTransaction` once and uses mutation uncertainty after transport/mapping failure. It distinguishes payment-method and recovery origins. Cancellation passes the requested timing and acknowledges the matching observed result. Customer portal creation requires host authorization over the provider customer account.

Transaction financial lines retain their own line IDs and are matched to the price/item by explicit identity. Monetary values remain canonical integer strings; adjustment allocations retain allocation identity, original transaction-line identity, and signed totals independently. Timestamp comparison preserves fractions and normalizes equivalent instants rather than truncating them to JavaScript millisecond dates for evidence identity. No new adapter defect was reproduced in these areas.

### Durable scan and coverage guarantees

Each source call creates a new official SDK collection from the persisted pre-page cursor, fixed query, and epoch. SDK `Collection.next()` updates its internal cursor before mapping, but a mapper failure returns a durable gap without exposing/admitting a partly mapped prefix. Explicit redrive and restart reread the original cursor. The PostgreSQL tests cover rollback of all receipts with checkpoint failure, stale-CAS rejection without input admission, 429/network gaps, and unsupported adjustment custody with successful progress.

Current official Paddle docs confirm the implementation's exclusive event-recording-time `from`/`to` semantics and 90-day event retention. The published SDK type omits the newer parameters, but its public query serializer forwards them; the exact synthetic request is asserted. Required-type coverage requires separate matching completed scans and overlapping exclusive windows. The result always carries `historyComplete: false` and visibility/history limitations. No account-backed filter acceptance, live-list visibility, or full history guarantee is inferred from MockAgent results.

## Primary sources and commands

Local primary sources: `research/sources/paddle-node-published-3.10.0/package` and `research/sources/paddle-node-sdk` at the pinned official source recorded in the implementation plan. Read accepted implementation plan §5/§reconciliation, contributor instructions, and retained Q v1.1.2 in full; no architecture/style-only findings were raised.

Current official docs directly opened during this review:

- [List events](https://developer.paddle.com/api-reference/events/list-events/) — cursor/order/page limits, supported names, retention.
- [Event filtering changelog](https://developer.paddle.com/changelog/2026/event-notification-log-filtering/) — September 23, 2026 API1 addition; exclusive boundaries use event recording time.
- [Get transaction](https://developer.paddle.com/api-reference/transactions/get-transaction/) and [transaction.completed](https://developer.paddle.com/webhooks/transactions/transaction-completed/) — current required nullable proration schemas and financial-line evidence.

Representative exact commands, run in the detached checkout:

```sh
/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node node_modules/typescript/bin/tsc -b
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node --test packages/payments-paddle/test/sdk-contract.test.ts packages/payments-core/test/reconciliation.test.ts tests/integration/reconciliation.test.ts review-probes/paddle-wave2.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node --test packages/payments-paddle/test/sdk-contract.test.ts packages/payments-core/test/reconciliation.test.ts tests/integration/reconciliation.test.ts review-probes/paddle-wave2.test.ts
```

The Node 24 sets were run separately as described above; the combined command is equivalent and included for convenient reproduction. The probe restores the previous undici dispatcher and all globals installed by test-only `install()`, disables real network access, uses synthetic credentials/secrets, creates a unique PostgreSQL schema, and removes that schema in `finally`. No provider credentials, charges, live writes, or sandbox mutation were used.
