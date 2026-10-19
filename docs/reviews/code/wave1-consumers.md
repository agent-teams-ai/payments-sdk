# Wave 1 independent implementation review: consumers, T3 and public hosts

## Verdict

**Request changes: two P1 contract defects.** This review found no P0. Both findings are reproducible against the frozen commit, including the two supported Node runtime floors. The fixtures are explicitly nonproduction; the findings concern the mandatory P5/P6 qualification guarantees they are supposed to establish, rather than a proposed production credit policy.

Reviewed commit: `7bc3f71a2db4d7364870f6b25365986611195916` in detached worktree `/workspace/scratch/9e36ca3bbd13/implementation/review-w1-consumers`. No production source was changed. Review-only probes are under `tests/review/` in that worktree.

Scope read in full: pinned Q 1.1.2, `AGENTS.md`, the implementation plan's consumer causal rules and P5/P6 gates, all of `tests/fixtures/consumers/{owner,credit,access,index}.ts`, `tests/e2e/**`, and `examples/**`. Relevant core evidence contracts, completion classification, immutable-completion handling and message publication were cross-checked.

## Findings

### 1. P1 — Preserve the source revision fence before its buyer can be routed

**Location:** `tests/fixtures/consumers/owner.ts`, `ConsumerOwner.receive`, line 138; affected control flow lines 126–150. The buyer filter in `ConsumerOwner.sources`, line 100, causes the missing row.

`receive` correctly loads `prior` using the stable source key before routing. It then chooses `current` again from a buyer-filtered query. A source whose first accepted message was a held control or an unsupported payload schema has no `last_known`, so the buyer query excludes it. `current` becomes undefined even though `prior.revision` exists. The monotonicity branch at line 145 consequently does not run, and the unconditional upsert at line 149 replaces a newer held source with an older complete source.

Reproduced on fresh owner schemas:

```ts
const paid = message(3);
await credit.receive(held(4, paid)); // ACK true; outcome held
await credit.receive(paid);         // ACK true; outcome accepted (incorrect)
```

Actual durable result: the evidence projection moves **4 → 3**, the source obligation becomes resolved, and the credit decision becomes `issued`, `eligible="100"`, with one original Q grant. Replacing the first message with a correctly signed known envelope whose `schemaVersion` is 9 gives the same result. A directly tested `held4 → restart → complete3 → held4` trace returns `held, accepted, duplicate` and remains eligible 100: the final held replay is already receipted and therefore does not repair the lost fence.

The same bug affects the shared access owner. After accepting a paid transaction, `held(4, subscription(3)) → subscription(3)` results in `latestSubscriptionRevision=3`, `status="active"`, `newAction=true`, `expand=true`. An older active snapshot has therefore undone a newer held subscription envelope. The same restart/replay sequence returns `held, accepted, duplicate` and leaves `newAction=true`.

**Why this is material:** plan §5's bounded-control contract explicitly says a newer control advances the source revision and an older complete cannot restore permission. The T3 contract requires revision checking before product effects, including first delivery to a newly registered or restored consumer. The existing control test begins with paid revision 3 before held revision 4 and therefore does not exercise an initially unrouted source.

**Minimal fix:** use the source-key-locked `prior` as the authoritative revision/digest fence, independently of the buyer membership query. Keep contribution enumeration and buyer locking separate from deciding whether this source can advance. A stale complete must not replace the held row, resolve its obligation, or cause an effect. Apply the same rule to transaction and subscription aggregates and to unsupported-schema envelopes.

**Focused regression:** for each owner, begin with held revision 4 and then deliver complete 3, repeat 4 and restart/replay. Also run the unsupported-schema-4 variant. Assert durable projection revision stays 4, held obligation remains pending, no credit grant is issued, and access remains restricted. A later qualified complete revision 5 must still be able to advance once.

### 2. P1 — Keep the recurring paid-period identity in addition to the initial-intent guard

**Location:** `tests/fixtures/consumers/credit.ts`, `basis`, lines 13–17; subsequent grouping and grant creation in `CreditFixture.recompute`, lines 54–66 and 83–86.

An `initial` completion is keyed only by application, buyer, intent and slot. A `renewal` or `recovery` is keyed by subscription basis, slot and period. The initial-intent guard is thus used **instead of** the recurring period decision, so the two classifications can produce independent original grants for the same stable subscription basis, benefit slot and exact paid period.

Reproduced first with normal complete evidence messages:

```ts
await credit.receive(message(1, initialFact));
await credit.receive(message(1, {
  ...initialFact,
  factId: 'renewal-same-period',
  transactionRef: 'transaction-renewal-same-period',
  classification: 'renewal',
  lines: [{ ...initialFact.lines[0], providerLineRef: 'line-renewal' }],
}));
```

Both retain `subscriptionBasisId="binding-a"`, stream `subscription-A`, slot `included` and exact period `2026-10-01T00:00:00.123456Z`–`2026-11-01T00:00:00.123456Z`. Actual result: two issued decisions, **eligible total 200**, and two different original-grant effects. No duplicate hold is created because the contributions are in different maps/groups.

This is also reachable through the real public integration path, rather than requiring a malformed producer message. A review-only variant of `full-system.test.ts` creates the initial server purchase, then sends a distinct completed transaction with `origin="subscription_recurring"` and the same original billing period through the official SDK webhook verifier, PostgreSQL inbox/T2/evidence, and public deliveries. **Both** `node-http-factory` and `fetch-static-gm` produce two completed facts with `flags=[]`, two original Q grants and `eligible="200"`. The classifier accepts this as a renewal; no upstream duplicate flag closes the gap.

**Why this is material:** plan §6 specifies a recurring unique benefit basis of application/beneficiary + stable local subscription basis + slot + exact paid period. An initial purchase must additionally check the originating-intent guard in the same consumer transaction. The two constraints protect different ambiguities: one initial intent across different streams/periods, and one paid period across different transaction/classification identities. A shared buyer lock cannot compensate for the missing period constraint.

**Minimal fix:** retain a recurring period decision/unique identity for **all** recurring classifications, including initial, and make the initial-intent guard an additional owner-local record/check. Correlate initial/renewal/recovery contributions for the same paid period so unresolved duplicate support produces eligible zero and a durable review obligation. Preserve the immutable original-grant identity and explicit support selection; do not add policy version or provider transaction/line IDs to the unique grant key.

**Focused regression:** extend one public-host E2E trace with an initial completion and a distinct recurring completion for exactly the initial paid period, in both orders and after restart. Assert both financial facts survive, unresolved duplicate support is held with eligible zero, and at most one original issuance exists. Authorized local selection of valid support must yield one Q, preserve the original issuance identity, and leave a genuinely next period independently eligible.

## Verification and supporting observations

- Frozen build succeeded with TypeScript 7.0.2.
- Existing frozen E2E group: **16 passed, 0 failed** on Node 24.21.0 against real PostgreSQL 18 at the authorized temporary endpoint.
- New held-first and unsupported-schema-first traces reproduced finding 1 on **Node 24.21.0 and Node 26.11.1**. A subscription control trace reproduced the access consequence on both floors.
- New same-period trace reproduced finding 2 at both the consumer protocol level and through **both public host environments**, on **both runtime floors**.
- All probes used isolated randomly named consumer/payment schemas, and cleanup removed them. No external API connection, live credential or charge was used; official SDK HTTP was controlled by the existing test-only MockAgent pattern.

The reviewed paths otherwise showed the intended separation: owner-local WAL-logged receipt/projection/decision/effect/obligation/outbox transactions precede ACK; the buyer guard is shared by evidence, lifecycle, restriction, refresh and local resolution writers; credit ACK does not satisfy access custody; source revisions are not compared across aggregates; ordinary refund-first/paid-first and qualified reversal traces preserve the distinction between original issuance and restoration; local partial-policy redrive checks decision revision and the whole read set; access retains financial periods, recognizes newer unknown lifecycle fields, and leaves read/export/cancel allowed.

These observations do not override the two counterexamples above. In particular, the passing test named “control overflow, unknown schema and conflicts hold monotonically” covers an already routed source, and the passing initial-stream test uses a genuinely different renewal period.

## Remaining limits

This is a focused consumer/host review, not a renewed qualification of every production adapter, SQL fault path, queue worker or packed-consumer gate. Temporary PostgreSQL exercised real owner transactions, but this review did not inject consumer COMMIT-response loss, physical database crash/PITR, or a real Paddle sandbox destination. It did not review other critics' reports before reaching these findings. Illustrative full-refund, no-grace and unsupported-adjustment policy choices were not treated as defects solely because a production product might choose different policy.

A deliberately altered immutable completion can also rekey the fixture's contribution and leave an old decision behind; this is **not reported as a separate finding**, because a corresponding valid path through the frozen producer's immutable completion contract was not established. The reported same-period problem above requires no such mutation.

## Contract sources

- Q 1.1.2: `research/sources/q/SKILL-v1.1.2.md`, source pin `777genius/agent-rules@5f1b5aefa96d64448d909ae9c04a823afe145ea8`, blob `c30b755f8402c470e8d407950b36ae04b2873113`; particularly LSP history properties, consumer-owned contracts and actionable review evidence.
- Frozen `docs/implementation-plan.md`: §5 bounded control and T3 monotonicity; §6 recurring grant identity plus initial guard; §12 P5/P6, held/unknown envelope cases and meaningful consumer assertions.
- Frozen `packages/payments-core/src/contracts.ts`: `CompletionFact`, `EvidenceEnvelope`, `PaymentEvidenceChanged`, `ObservedSubscriptionEvidenceChanged`.
- Frozen `packages/payments-core/src/reducer.ts`: `classifyCompletion` and `markDuplicates` for the public reachability of the initial/renewal same-period trace.
