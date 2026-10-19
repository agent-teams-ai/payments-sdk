# Wave 3 independent provider / integration / security review

## Frozen input and result

- Reviewed full commit: `69f595a5f4ad9800f92e2259c56380abdd1824c9`.
- Detached sibling: `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-provider`.
- Scope: official Paddle SDK3.10.0 adapter, source-aware observations/custody, errors, public mutation authority, ingress examples, and reconciliation. Read `AGENTS.md` and the accepted `docs/implementation-plan.md`, especially sections 3–5 and 8–10.
- **Two new P2 findings. No P0/P1 found.** Both are independently reproduced through the public API using real PostgreSQL and the actual installed official Paddle SDK, on Linux Node24.21.0 and Node26.11.1. They are not findings about the nonproduction fixture's commercial policy: the SDK publishes unflagged evidence for an explicitly unsupported or insufficient provider state, and the independent access fixture demonstrates the observable consequence of that missing signal.
- No production edits, commits, pushes, credentials, live-provider actions, SDK replacements, or private SDK runtime imports were made. Only untracked `.ts` probes/config/logs were added to the detached review sibling.

## P2-1 — Subscription normalization drops available profile fields and reports unsupported / insufficient snapshots as clean

**Location:** `packages/payments-paddle/src/observations.ts:123–132`, with `packages/payments-core/src/contracts.ts` `SubscriptionObservation` and `packages/payments-core/src/reducer.ts:211–220`.

The subscription parser reduces each item to its `price.id`, omitting its required quantity and the subscription's collection mode. Core then decides completeness and catalog compatibility from status, scheduled change, period, price IDs and customer only. Consequently, all three of these incoming newer subscription states produce a fully populated active observation, no evidence flags, and a normal `subscription_complete` publication:

1. A subscription on the same monthly price changes item quantity from 1 to 2. The probe's price quantity bounds are minimum1/maximum100 from the initial baseline, so the changed quantity is a permitted Paddle state. It lies outside the library's declared quantity1 profile.
2. Collection mode changes from `automatic` to `manual`, with valid invoice billing details and payment terms. Manual invoice workflows are explicitly outside the accepted v1 profile.
3. Required `items[0].quantity` is absent. Raw evidence has no quantity, and the SDK mapping leaves it undefined. This is outside the specific API1 nullable-field assumptions; it must not establish a known supported profile.

Each case is reproduced independently as both a signed raw `subscription.updated` webhook and an authenticated entity refresh through the actual SDK. In each case a prior normal quantity1 automatic subscription is first durably observed, and the access fixture is proven enabled. After the changed input is admitted, processed, published and delivered, persisted subscription flags remain `[]`; the fixture's decision remains `newAction:true`, `expand:true`, `restrictions:[]`. Thus consumers receive no explicit unsupported/incomplete signal. Historical completion remains intact, as it should; the defect is certification of the current lifecycle.

This is adapter-induced loss, not an unavoidable SDK loss. The retained exact published SDK directly assigns `SubscriptionItem.quantity` (`research/sources/paddle-node-published-3.10.0/package/dist/esm/entities/subscription/subscription-item.js:15–25`) and `Subscription.collectionMode` (`.../entities/subscription/subscription.js:49`), so both values are available through the public result. No private import is needed to use them. The primary [update-subscription documentation](https://developer.paddle.com/api-reference/subscriptions/update-subscription/) describes updates of existing item quantities (request `items.quantity`) and changing collection mode to manual with billing details. Accepted plan sections1/5/6 limit the profile to one monthly price, quantity1, no trial and no manual invoices, and require unsupported external changes to be retained/classified rather than silently confirmed.

**Required correction:** Carry enough neutral profile information, or explicitly reject the unsupported profile into a routed non-granting observation, to publish a durable unsupported/incomplete signal. Validate the non-null required item children; do not widen the selected nullable schema-assumption contract to infer missing quantity. Preserve the complete source receipt and routing. A newer supported observation can then follow ordinary explicit resolution/reconciliation semantics.

**Regression evidence:** `review-probes/wave3-provider.test.ts`, six cases: `raw/api × quantity_two/manual_collection/missing_quantity`. All six fail the independent intended oracle on both floors with `received flags=[] restrictions=[]`, actual `newAction:true`, expected false. Baseline creation, paid confirmation, normal lifecycle refresh, enabled fixture decision and durable delivery assertions all pass before the change.

## P2-2 — Unknown transaction status is treated as ordinary noncompletion and republishes a clean prior payment

**Location:** `packages/payments-paddle/src/observations.ts:113–119`; `packages/payments-core/src/reducer.ts:94–95` and `167–194`.

Transaction normalization accepts every nonempty string as a known status. `classifyCompletion` maps every status other than `completed` to `not_completed` without checking the supported status set. `reduceTransaction` records the newer current observation but has no unsupported branch for that result. When a historical completion already exists, publication consequently retains that completion with no hold flag.

The probe first completes a supported purchase and observes an active subscription. It then receives a newer `transaction.updated` with `status:'future_provider_status'`, or the same state from a real SDK entity GET. Both inputs are accepted and durably processed. The persisted `current.status` is the unknown string, the immutable prior completion remains, aggregate flags are `[]`, and the independent access fixture remains enabled with no restrictions after consuming the higher evidence revision. Payment publication does not expose current transaction status, so the consumer cannot independently notice the unknown current state from that message.

The defect is specifically the missing explicit unsupported signal for an unknown provider state. It is **not** a claim that a currently documented noncompleted status should delete a historical completed fact, nor a claim that Paddle currently emits this synthetic status. The accepted plan explicitly requires unknown external changes to be retained and classified, and the existing future-event tests establish the same hold behavior for unknown event types. The known event/unknown status route bypasses that behavior. The official SDK assigns the status string without a runtime enum guard, so using its public typed result does not close the route. Paddle's [transaction.updated schema](https://developer.paddle.com/webhooks/transactions/transaction-updated/) enumerates the currently documented transaction statuses; any other value is outside the supported decoder profile.

**Required correction:** Distinguish the known noncompleted statuses from unknown statuses during normalization/reduction, retain the original receipt, and publish an unsupported hold while retaining immutable financial history. Do not treat every arbitrary string as an ordinary `not_completed` state.

**Regression evidence:** `review-probes/wave3-provider.test.ts`, two cases: `raw/api × future transaction status`. Both fail on Node24.21.0 and Node26.11.1 with `received flags=[] restrictions=[]`, actual `newAction:true`, expected false. The probe explicitly asserts that `current.status` changed and that the historical completion still exists, so it cannot pass by ignoring the changed input or deleting the payment history.

## Verification

Installed dependencies offline using the exact frozen lockfile. Installed public SDK manifest reports `3.10.0`. Build and probe typecheck used the installed TypeScript7.0.2 compiler.

| Gate / probe | Runtime | Result |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile` | Node24.21.0 | Pass; cached packages only |
| `pnpm build` | Node24.21.0 | Pass |
| `pnpm test:paddle` | Node24.21.0 | 16/16 pass |
| `node --test tests/integration/reconciliation.test.ts` with real PostgreSQL | Node24.21.0 | 12/12 pass |
| `pnpm exec tsc -p review-probes/tsconfig.json` | Node24.21.0 | Pass, strict TS project |
| `node --test review-probes/wave3-provider.test.ts` with real PostgreSQL | Node24.21.0 | 8/8 intended behavior assertions fail; parent group is also marked failed |
| Same independent probe | Node26.11.1 | Same 8/8 intended behavior assertions fail |

Reproduce from the sibling using:

```sh
export PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
node --test review-probes/wave3-provider.test.ts
```

Replace the Node directory with `node-v26.11.1-linux-x64` for the second floor. Each probe migrates a new random payment schema and a separate access-owner schema, and drops them in cleanup. The test-only transport uses official undici `install()` + `MockAgent`, disables all network connections, and restores globals/dispatcher in cleanup. Production provider code still invokes actual public SDK resources, constructors and signature verification. No fake SDK or provider method replacement is used.

Evidence files:

- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-provider/review-probes/wave3-provider.test.ts`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-provider/review-probes/tsconfig.json`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-provider/review-probes/node24-provider.log`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-provider/review-probes/node26-provider.log`

## Checked controls and limits

Read-only review also checked explicit cancellation timing and target-ID checks, side-effectful payment-update GET mutation uncertainty, namespaced server correlation, customer-wide portal authorization, source-specific null assumptions, exact raw webhook byte/string handling, event identity and unsupported-route preservation, SDK mapper failure before durable cursor advance, per-transaction adjustment scans, coverage caveats and retained fixed query/epoch identity. The existing target gates passed, including actual SDK101/200-member pages, full receipt persistence, two-parent conflicting routes, and restart/redrive behavior. No additional P0/P1/P2 is established for those paths by this review.

The report does not count the already disclosed unpublished Get Modular observation gate, Paddle.js upstream TS7 browser gate, planned live sandbox qualification, SDK-selected nullable assumptions, or documented provider retention/visibility limitations as new defects. No new issue is inferred merely from the absence of live provider tests. `from/to` event filters describe registration time rather than `occurred_at`; consequently this review does not incorrectly require rejecting an event solely because its occurrence timestamp is outside the registration-time query window. The synthetic future-status test is an explicit decoder robustness counterexample, not evidence of a live provider incident.
