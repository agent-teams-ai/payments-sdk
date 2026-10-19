# Wave 2 independent code review — core/domain

**Frozen revision:** `15780e43e28a650fc11d62621a11a14e63f720ed` (`15780e4`). **Review checkout:** `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-domain`, detached. Review date: 2026-10-19 UTC.

## Decision

**Changes requested: three confirmed P2 correctness findings.** No P0/P1 finding established in this lane. The first two concern durable evidence consistency; the third concerns the supported audited recovery use case. No production source was edited. The review does not count unfinished PostgreSQL worker/reconciliation work, the separately owned T1 event-identity admission fix, or consumer findings being integrated elsewhere.

Read the repository `AGENTS.md`, accepted `docs/implementation-plan.md`, Q 1.1.2 in full, both wave-1 core/Paddle reports, and the integrated operation/evidence fixes. Reviewed all core source plus the relevant Paddle acquisition, payment-update, and PostgreSQL commit code. Applied Q to actual ownership/contracts; no file-count, stylistic SOLID, or speculative abstraction finding is proposed.

## Verification

The **33 existing core tests pass on both Node 24.21.0 and Node 26.11.1**. This positively verifies the integrated pinned-subject retries, known customer-mismatch rejection, authority-read CAS, exact acquisition custody, cross-source event compatibility, and quarantined preflight regression in this frozen snapshot. The independent probes below add **four reproductions**, all passing on both floors because they assert the defective behavior. The probe project also passes strict TypeScript checking. A core build passed on Node 24.21.0.

Retained probe: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-domain/review-probes/domain.test.ts`.

Commands, from the detached checkout:

```sh
../node-v24.21.0-linux-x64/bin/node node_modules/typescript/bin/tsc -b packages/payments-core
../node-v24.21.0-linux-x64/bin/node node_modules/typescript/bin/tsc -p review-probes/tsconfig.json
../node-v24.21.0-linux-x64/bin/node --test review-probes/domain.test.ts packages/payments-core/test/core.test.ts
../node-v26.11.1-linux-x64/bin/node --test review-probes/domain.test.ts packages/payments-core/test/core.test.ts
```

Each combined runtime run: **37 passed, 0 failed**. Probes use public runtime calls and the exported memory testing store; they do not mutate persisted records directly. No credentialed network access, live monetary action, or PostgreSQL integration qualification is claimed by these probes.

## 1. P2 — A stale customer contradiction changes the durable authority hold without publishing it

**Location:** `packages/payments-core/src/reducer.ts:163–169`, `reduceSubscription`.

### Reproduction

1. A normal completed monthly transaction establishes a binding to customer `payer` and subscription `sub`.
2. Process a subscription observation at `2026-01-02T00:00:00Z`, active and owned by `payer`. The registered access consumer receives and acknowledges its subscription evidence.
3. Process a distinct authenticated receipt for the same subscription at `2026-01-01T00:00:00Z` with customer `other-payer`.
4. Line 165 adds `ownership_mismatch` to the aggregate. The comparison at line 169 then returns because the observation is older.

The resulting durable aggregate has `flags: ['ownership_mismatch']`, still holds the newer current observation, and still has `revision: 1`, `evidenceRevision: 1`, and `publicationRequired: false`. There are **zero new deliveries and zero publication work items**. Calling public `repair()` does not create a delivery. The input is marked processed.

### Impact and scope

The reducer has deliberately recorded a review/authority restriction, but the independently acknowledged subscription feed never receives it. The plan's T2 failure/publication rule requires attributable review/conflict changes to produce a durable evidence obligation (`docs/implementation-plan.md:174–176`); the subscription feed is explicitly the reliable path to Commercial Access (`:186`). Any consumer relying on that feed can retain the earlier unheld state indefinitely.

This finding does **not** claim that the stale receipt should replace current customer data, that a past snapshot proves a present transfer, or that the fixed runtime permits a mutation after reading this flag. Its precise failure is an already committed flag that is absent from both evidence and repair obligations.

### Minimal fix and regression

Make every actual flag change increment the aggregate revision and set its publication obligation, including before a stale-version return. Preserve the newer current observation. If the intended policy instead treats this historical mismatch as harmless, do not commit a hidden authority restriction; choose and encode that policy consistently.

Keep the acknowledged-feed → stale contradictory receipt → repair regression. Assert that the intended persisted hold and delivered hold agree, with an immutable higher evidence revision whenever a new hold is recorded. Replaying the same receipt must not invent a new financial fact. Run the regression against PostgreSQL as well as memory, since downstream recovery depends on the durable work index.

## 2. P2 — Advancing a watermark disables conflict detection for previously observed versions

**Locations:** `packages/payments-core/src/reducer.ts:166–172` (subscription), `:190–196` (adjustment).

### Reproductions

Two independent traces use distinct receipt IDs and no shared provider event ID, so they exercise the per-object/version promise rather than event-envelope conflict detection:

| Object | First receipt, version V1 | Newer receipt, V2 | Late conflicting receipt, V1 | Observed result |
| --- | --- | --- | --- | --- |
| Subscription | `status=active` | `status=active` | `status=canceled` | No conflict; current remains V2; `lastKnown` still contains the contradictory first V1 |
| Adjustment | pending refund, amount `100` | approved refund, amount `100` | pending refund, amount `90` | No conflict; approved V2 continues to be published as unheld |

All receipts process successfully. The current-only `order < 0` return runs before comparison with any matching historical version. For the subscription reproduction the first V1 is even still present in `lastKnown`; it simply is not consulted. Adjustment history is retained in inbox custody but is absent from the reducer's comparison input.

### Impact

The accepted ordering contract says equal provider object versions with different known content require conflict/reconciliation (`docs/implementation-plan.md:228`). Arrival of an unrelated newer version must not turn that contradiction into an ordinary duplicate/stale receipt. Two runs containing the same contradictory V1 evidence can therefore disagree on whether to hold solely because V2 arrived between those receipts. The transaction reducer already compares against its saved observations, so the violation is specific to the subscription and adjustment paths.

This is not a request to overwrite a newer mutable projection with an older one, nor a claim that every stale receipt is suspicious. The missing check is against **a previously accepted observation with the exact same scoped entity version**. No provider promise of mutation retries or cross-object ordering is assumed.

### Minimal fix and regression

Preserve a bounded, durable way to compare certified content for a known entity/version before applying the current watermark rule. Load or index compatible semantic evidence by exact version; compare both-known fields and merge compatible partial evidence. Keep current projection advancement separate. A contradiction must persist a conflict and publication obligation while preserving both immutable receipts and the current V2 projection. If the necessary history cannot fit the declared working set, publish an explicit hold rather than silently treating it as absent. Do not grow every aggregate payload into an unbounded receipt archive.

Test V1→V2→conflicting-V1 and V1→conflicting-V1→V2 for both kinds, including restart and a previously acknowledged V2. Both must end with the same conflict disposition and no stale overwrite. Add nanosecond/offset-equivalent V1 spellings and compatible partial receipts as non-conflicting controls. Exercise the durable store's historical lookup/read set as well as the pure comparison.

## 3. P2 — Audited payment-update outcome binding exposes checkout success without the transaction binding

**Location:** `packages/payments-core/src/runtime.ts:294–311`, `resolveUnknownOperation`; compare normal payment-update settlement at `:58–62`.

### Reproduction

1. Establish an ordinary monthly subscription.
2. Public `openPaymentUpdate` receives `outcome_unknown` from the provider.
3. An authorized operator calls `resolveUnknownOperation` with the correct operation revision, audit metadata, `action: 'bind_outcome'`, and a proven successful `PaymentUpdateReady` containing transaction `update-transaction`, purpose `payment_method`, the original intent ID, and checkout instructions.
4. Resolution succeeds. Repeating the original `openPaymentUpdate` request key returns the successful checkout value.
5. Load the transaction's payment-owner working set: `bindings['update-transaction']` is **undefined**. The operation is terminal `succeeded`.

The recovery handler constructs a transaction binding only for `operation.kind === 'purchase'`. Normal SDK payment-update settlement does construct the purpose-preserving binding. The audited path also bypasses that branch's purpose/identity validation.

### Impact

The supported operational resolution reports that it has bound a proven outcome while omitting the external-ID/purpose binding that ordinary settlement requires before exposing checkout. Later method-update evidence remains unresolved despite a successful operator resolution, and the terminal operation provides no prepared/unknown obligation to finish this binding. The problem occurs through the intended audit API, with valid data and no store bypass. It is separate from missing background reconciliation work.

The plan requires proof-preserving audited outcome binding (`docs/implementation-plan.md:128,136`) and classifies payment-update transactions by their saved purpose (`:225`). This does not establish a second grant or an unauthorized charge by itself, so it is classified P2.

### Minimal fix and regression

Reuse one core-owned successful-outcome validation/binding rule for ordinary settlement and audited `bind_outcome`. For payment update, validate the intent, bounded transaction reference and proven `payment_method`/`recovery` purpose, then commit its transaction binding and publication obligation atomically with the successful operation state and audit. Preserve the pinned subscription command; do not infer its subject from a newly selected stream.

Add public regressions for both payment-method and recovery outcomes, including an early webhook processed before operator resolution. Successful resolution must produce the same purpose-preserving durable binding as normal settlement and allow saved evidence to be reclassified through publication repair. Invalid/mismatched outcomes must reject without changing the operation or exposing checkout. Repeat resolution must remain idempotent under the expected-revision contract.

## Architecture and remaining gates

The package boundary remains coherent: core owns neutral contracts and reduction policy; provider/storage adapters depend inward; Commercial Access and credit effects remain independently owned. The wave-1 fixes are visible in both code and passing focused tests. The additional changes above belong in existing evidence and operation contracts; they do not justify a general event platform, more packages, or broad refactoring.

This lane did not establish a new defect in customer-wide portal authority: both the host command and Paddle adapter retain explicit customer authority checks, and subscription deep-link lists are not treated as an access sandbox. It also did not upgrade the accepted SDK nullable-field trust profile into a raw API custody guarantee.

Acceptance gates for these findings are the independent regressions above plus relevant real PostgreSQL durable-obligation/read-set checks. Broader worker/reconciliation, consumer, packed-package and provider sandbox gates retain their separate owners. No unfinished in-flight implementation is classified here as a defect.
