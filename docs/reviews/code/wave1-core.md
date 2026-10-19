# Wave 1 independent core review

**Reviewed commit:** `786663cfb63af204e98c73ea92b1ce4f850359a5` (`786663c`).

**Verdict: NOT ACCEPTED.** Three P1 defects are confirmed below. They affect mutation serialization, immutable command meaning, and enforcement of known ownership restrictions. They are observable through public runtime operations, rather than hypothetical misuse of a storage port.

## Scope and method

Read Q 1.1.2 in full at `/workspace/scratch/9e36ca3bbd13/research/sources/q/SKILL-v1.1.2.md`, the frozen implementation plan, every source file in `packages/payments-core`, and relevant PostgreSQL, Paddle, Get Modular and consumer boundaries. Applied Q as a contract and invariant review: no finding is based on folder layout, interface count, or a preferred abstraction style.

Production sources were not changed. A detached worktree was created at `/workspace/scratch/9e36ca3bbd13/implementation/review-w1-core`. Builds used the installed dependencies. The frozen core suite passed under Node `26.11.1`: **21 tests passed, zero failed**. Focused reproductions are retained in:

`/workspace/scratch/9e36ca3bbd13/implementation/review-w1-core/review-reproductions.mjs`

The `lane` reproduction used a real local PostgreSQL 18 instance through the public schema migration and store factories, with its own temporary schema, removed on exit. `target` and `ownership` use the exported memory testing store and the public runtime with a deterministic provider. They preserve physical unknown calls until the failure has been observed, then settle and drain those calls.

Commands from the detached worktree:

```sh
../node-v26.11.1-linux-x64/bin/node --test packages/payments-core/test/core.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres ../node-v26.11.1-linux-x64/bin/node review-reproductions.mjs lane
../node-v26.11.1-linux-x64/bin/node review-reproductions.mjs target
../node-v26.11.1-linux-x64/bin/node review-reproductions.mjs ownership
```

The temporary connection above has no password and is only the local review database. No remote systems or real monetary mutations were used.

## 1. P1 — A late result for terminal operation A releases the lane still owned by unknown operation B

**Primary location:** `packages/payments-postgres/src/store.ts`, `PostgresPaymentStore.operationCommit`, lines **182–184**; relevant checks at **162–165**.

**Caller:** `packages/payments-core/src/runtime.ts`, `settleAttempt`, lines **48–70**.

### Reproducible trace

1. A monthly purchase operation A times out while its first provider create is physically pending.
2. An operator explicitly accepts duplicate risk and authorizes a second attempt of A. That attempt succeeds and binds `new-tx`; A becomes `succeeded`.
3. A completed observation establishes the selected `sub-a` stream.
4. A cancellation operation B on that basis is dispatched and becomes `outcome_unknown`; its provider call remains physically pending. The actual persisted lane is:

   ```json
   { "revision": 7, "unresolvedOperationId": "id-6" }
   ```

5. The first, old attempt of A finally succeeds with `old-tx`. `settleAttempt` correctly refuses to replace A's newer result, but still invokes `finishAttempt` to preserve the late binding and observation.
6. `operationCommit` loads the *current* lane revision and accepts its CAS. It then derives lane ownership solely from A's terminal state and overwrites the lane with:

   ```json
   { "revision": 8 }
   ```

7. B remains `outcome_unknown`. Nevertheless, a new payment update C is admitted and **actually dispatched**, returning `succeeded` while B is still unresolved.

The reproduction asserts the persisted owner before and after the late result, B's unchanged unknown state, and the count of calls to the provider's payment-update method. Observed `paymentUpdateDispatched` is `1`.

### Contract violation and impact

The plan at `docs/implementation-plan.md:128,134,136` requires a single unresolved mutation lane for the same mutable entity, and says an old attempt must not overwrite newer history. A fresh numeric lane revision proves freshness of the read; it does not prove that A owns the lane. The store currently treats those as equivalent.

This also violates substitutability: the memory store's dispatch check at `packages/payments-core/src/memory.ts:81` scans for another unresolved operation and blocks C in the same situation, while PostgreSQL allows C. Passing the existing memory core suite therefore does not establish the durable adapter's guarantee.

The practical effect is concurrent or sequentially conflicting external subscription mutations after a timeout. No malicious input, direct record editing, or fabricated commit is necessary.

### Minimal correction and regression gate

Make lane transitions conditional on **owner identity** as well as revision. A late result for A may persist A's immutable attempt evidence and trusted binding without changing B's lane ownership. Only a transition authorized for the current owner may clear or transfer that owner. Do not discard late evidence to avoid the problem.

Keep this as a real PostgreSQL regression: A retry succeeds, B becomes unknown, an old A result arrives, and C must not call the provider. Assert that B remains the persisted lane owner. Also cover a late rejected/unsupported result, because the unconditional lane rewrite does not depend on a successful binding.

## 2. P1 — An audited retry silently changes its provider subscription target after stream selection

**Primary locations:**

- `packages/payments-core/src/runtime.ts`, `admitSubscriptionCommand`, lines **210–215**: the fingerprint and saved operation include only the local binding, with no immutable provider subscription target.
- Same file, `executeOperation`, lines **98–101**: every attempt resolves its target from the latest `selectedSubscriptionRef`.
- Same file, `resolveUnknownOperation`, lines **243–251**, and `selectSubscriptionStream`, lines **274–287**: an unknown operation may be prepared for retry after an independent stream selection.
- `packages/payments-core/src/contracts.ts:39–41`: neither the saved command nor attempt records carry the dispatched provider target.

### Reproducible trace

1. Two successful purchase attempts for one originating intent establish two paid candidate streams `sub-a` and `sub-b`. Both external payments are preserved. `sub-a` is initially selected.
2. A cancellation operation is dispatched to `sub-a`, then times out and remains physically unresolved.
3. Through the public read-set and audited `selectSubscriptionStream` APIs, the operator selects `sub-b`.
4. Through `resolveUnknownOperation`, the operator explicitly accepts duplicate risk for a **retry of the same cancellation operation**.
5. `executeOperation` dispatches that retry to **`sub-b`** and reports success.

Observed output:

```json
{
  "targets": ["sub-a", "sub-b"],
  "attemptFingerprints": [
    "246e7c040a7df491aaaa8486a5b60d1e54b4ddf4f465f813f133600120cd7b0a",
    "246e7c040a7df491aaaa8486a5b60d1e54b4ddf4f465f813f133600120cd7b0a"
  ],
  "selectedTarget": "sub-b",
  "state": "succeeded"
}
```

The first physical cancellation is still pending when the second call succeeds. The unchanged fingerprint claims the two attempts have the same meaning even though their external subjects differ. The saved operation cannot tell an auditor which subscription either attempt targeted.

### Contract violation and impact

The plan's durable operation/attempt fingerprint and audited retry contract (`docs/implementation-plan.md:125–128,134–136`) protects a particular command, not a mutable pointer to whichever provider entity is selected later. Accepting the risk of executing a cancellation twice on A is not authorization to execute it once on A and once on B.

In the duplicate subscription workflow this can cancel the stream the operator has just selected to keep. It can also report the old cancellation successful while the original external target remains unknown. This is a command-history defect in core policy, independent of the PostgreSQL lane defect above.

### Minimal correction and regression gate

Persist the resolved provider subscription subject in the immutable operation command before first dispatch and use that same subject for all linked attempts. Include the resolved subject in the command/attempt evidence that establishes what was authorized. If changing the selected stream invalidates execution of the old command, return a conflict and require a new explicit operation; do not silently retarget it.

At the dispatch boundary, validate the authority/selection snapshot required for that command under the same CAS/read-set discipline, so a selection between the read and durable dispatch marker cannot change the command's meaning.

Retain a test with two paid candidate streams, unknown cancellation of A, selection of B, and audited retry. The test must prove either that the retry still targets A or that the old command is rejected without a provider call; B must not be mutated by the retry. Apply the same guarantee to payment-update operations.

## 3. P1 — A known current ownership mismatch does not prevent cancellation or payment-update dispatch

**Primary locations:** `packages/payments-core/src/runtime.ts`, `admitSubscriptionCommand`, lines **213–219**, and `executeOperation`, lines **86–101**.

**Evidence already available:** `packages/payments-core/src/reducer.ts`, `reduceSubscription`, lines **171–177**, correctly sets `ownership_mismatch` when the current observed provider customer differs from the established binding.

### Reproducible trace

1. A bound monthly purchase establishes `buyer`, `sub-a`, and non-null customer `customer`.
2. A newer authenticated subscription observation for that exact stream reports `customerRef = different-customer`.
3. The reducer commits this observation. The public subscription read shows:

   ```json
   {
     "knownFlags": ["ownership_mismatch"],
     "originalCustomer": "customer",
     "currentCustomer": { "presence": "known", "value": "different-customer" }
   }
   ```

4. The original buyer requests immediate cancellation through the ordinary public runtime method.
5. The runtime calls the provider with `subscriptionRef: sub-a` and returns:

   ```json
   { "kind": "succeeded", "value": { "kind": "applied", "observedStatus": "canceled" } }
   ```

This is an already committed, known contradiction; the reproduction does not rely on an unobserved external transfer or a narrow timing race. The same admission/dispatch path is shared by payment updates.

### Contract violation and impact

The plan requires core to recheck binding and operation scope (`docs/implementation-plan.md:95`) and explicitly puts a change of an already non-null customer on a bound subscription into durable review until an authorized policy permits transfer (`:132`). The implementation records the contradiction for consumers but grants mutation authority from the historical `binding.buyerId` alone.

Thus the original buyer can still cancel, or obtain a payment-update transaction for, a subscription whose current relationship core already knows is inconsistent with that authority. App authentication of that buyer does not resolve the conflicting provider relationship.

### Minimal correction and regression gate

Before a subscription mutation can receive its durable dispatch marker, validate the pinned subject against the established binding and current trusted authority evidence. A known ownership contradiction must return a closed rejection/review outcome without invoking the provider until explicit authorized transfer resolution exists. Validate the relevant binding and observation revisions in the dispatch CAS; a read-only precheck alone leaves a stale-authority window.

Do not indiscriminately ban every commercial status: cancellation of an otherwise authorized past-due or unsupported lifecycle can still be legitimate. The gate should express the authority invariant rather than reusing a product-access decision.

Add a focused public API regression for both cancellation and payment update after a committed non-null customer mismatch. Assert **zero external mutation calls**, preserved mismatch evidence, and a visible rejection/hold. Add the interleaving where the mismatch commits after command preparation but before dispatch admission.

## Architecture assessment and boundaries that held

The core source dependency direction is sound in this snapshot: domain/runtime contracts do not import Paddle, PostgreSQL, Get Modular or a product credit implementation. The small ordinary factory is an appropriate composition seam. Get Modular does not need financial callback effects to implement the reviewed core use cases. The defects above arise because consumer-shaped contracts omit or fail to enforce identity and authority guarantees, not because the project needs more packages, a DI container, generic repositories, or an event platform.

Existing focused tests demonstrate immutable completion preservation, compatible same-version partial recovery, current unknown versus lastKnown subscription state, exact timestamp ordering, pending-adverse invalidation, bounded held evidence, independent acknowledgements, recovery fencing, duplicate initial stream preservation, and physical shutdown tracking. Those positive checks do not cover the three failing traces.

## Separate considerations and coordination

- A fourth verified financial trace was forwarded to the independent consumer critic for disposition to avoid duplicate formal findings: a valid initial completion and a distinct recurring completion for the **same exact initial period** produce two `grant` effects and total eligible `200` in the real PostgreSQL `CreditFixture`. Its `basis()` uses an initial-intent key for the first and a separate period key for the second. The retained reproduction includes mode `period`. The plan requires both the initial-intent guard and paid-period decision in one consumer commit (`docs/implementation-plan.md:140,239`). This is not counted among this report's three findings; it remains a release gate until the consumer critic/root handles it.
- The provider reviewer owns the separately confirmed API retained-representation/digest custody mismatch in `refreshPurchase`/`refreshSubscription`; it is intentionally not duplicated here.
- No style-only SOLID/DRY refactoring is proposed. No additional unproven failure is classified as a finding.

## Remaining gates and final decision

**NOT ACCEPTED at frozen commit `786663c`.** Close all three P1 findings with runtime/store contract changes and focused regressions. The lane regression must run against real PostgreSQL, because the memory implementation currently masks it. Coordinate closure of the paid-period double-grant and API custody findings with their assigned critics, then rerun the required type, boundary, integration, end-to-end, packed-consumer, and release gates for the new frozen candidate. Paddle sandbox qualification and production accounting ownership remain separate gates; the synthetic provider reproductions here do not claim those qualifications.
