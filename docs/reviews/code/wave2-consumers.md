# Wave 2 independent implementation review: consumers and public hosts

## Verdict

**Request changes: one P1 and one P2.** No P0 was found. The prior held-first revision-fence and recurring-period/initial-guard fixes pass their regressions. Two additional reachable credit-owner defects remain: equivalent RFC3339 representations split a single paid period into two eligible grants; returning an initial allocation to a previously selected period creates an extra allocation instead of transferring the existing one.

Frozen commit: `81f91ddbdbd1711f5dc19a37e053bd2a0d6553ca`.

Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-consumers`.

No production source was changed. Review-only probes are in that worktree under `tests/review/`. The review read the pinned Q 1.1.2 instructions, `AGENTS.md`, the implementation plan's T3/consumer/initial-guard and P5/P6 requirements, the previous consumer report, all independent consumer fixture sources, both host examples, the E2E suites, and the relevant producer/decoder/authority contracts. It did not use other wave-2 critics' findings.

## 1. P1 — Canonicalize exact paid-period instants before using them as the benefit identity

**Location:** `tests/fixtures/consumers/credit.ts:14–17`, `basis()`. This identity controls grouping at line 59 and original issuance at lines 125–128.

The recurring basis serializes the original `startsAt` and `endsAt` strings. Two supported RFC3339 spellings of the same exact instants therefore become different period decisions. An initial completion using:

```text
2026-10-01T00:00:00.123456Z → 2026-11-01T00:00:00.123456Z
```

and a distinct renewal completion using:

```text
2026-10-01T00:00:00.123456000+00:00 → 2026-11-01T00:00:00.123456000+00:00
```

receive two original Q grants and **eligible total 200**. Both decisions have `status="issued"`. The initial-intent guard selects the same provider stream and does not prevent this because only the first fact is classified `initial`; the renewal is grouped under the second raw-string period key.

This is reachable through the frozen producer. The adapter accepts and preserves these timestamps in `packages/payments-paddle/src/observations.ts:16,29–32`; the core's own semantic comparison deliberately normalizes period endpoints to exact seconds/fraction in `packages/payments-core/src/reducer.ts:15`, but the completion keeps the original strings at lines 114–117. The public trace creates one server-side purchase and submits two different completed transactions through the actual official SDK webhook verifier, PostgreSQL admission/T2, and public deliveries. The resulting immutable payment facts both have `flags=[]`; neither is a malformed replacement of the other.

**Reproductions:**

- `tests/review/wave2-consumer-probes.test.ts`, second test: direct independent-owner protocol, real PostgreSQL.
- `tests/review/wave2-alias-public.test.ts`: actual SDK and real PostgreSQL through both `node-http-factory` and `fetch-static-gm`, with initial-first and renewal-first consumer delivery, including a consumer restart between them.

All four public-host traces reproduce on **Node 24.21.0 and Node 26.11.1**. The independent expected value is a single exact period, an unresolved duplicate-payment decision, eligible zero, and at most one original issuance. Actual is two issued period decisions, two original issuances, eligible 200. The trace retains both distinct financial facts, as it should.

**Impact:** ordinary supported timestamp representation differences bypass the invariant that different transaction identities cannot create a second benefit for the same stable binding/slot/paid period. This reopens overissuance despite the wave-1 fix that combined initial, renewal and recovery classifications into a shared period decision. The problem is observable in the mandatory nonproduction P5/P6 qualification owners; it is not a request to invent production credit pricing.

**Minimal fix:** derive the recurring identity from a canonical exact pair for both period endpoints, preserving all supported fractional precision and normalizing timezone equivalence. Keep original provider strings in the financial evidence for audit. Do not use `Date.getTime()` or another millisecond conversion for the identity: it would merge genuinely different microsecond/nanosecond periods. Apply the same semantic period identity to initial-guard `selectedPeriod`/allocation ownership references. If this owner were already deployed, existing raw-string keys would require an explicit reconciliation/migration rather than silently inventing new grant identities.

**Regression:** run initial/renewal/recovery duplicate support with equivalent fractional padding and timezone offsets in both orders and across restart. Assert one decision, eligible zero before explicit support selection, one Q after valid resolution, and at most one original issuance. Add a neighboring nanosecond period that remains distinct, so the fix does not round away precision.

## 2. P2 — Reassign an existing initial allocation even when the target period already remembers its original grant

**Location:** `tests/fixtures/consumers/credit.ts:106–115`, especially the `!originalGrant` precondition; subsequent restoration at lines 125–134 and guard persistence at lines 140–147.

The first authorized transfer from initial period A to competing initial period B works. A becomes allocated zero, B receives the original 100 allocation, and `initial_guards.allocationOwner` becomes B. Returning support to A then skips the transfer because A still correctly remembers `old.originalGrant`. The general restoration branch instead adds another 100 to A. B retains allocated/held 100, while the initial guard selects A but still says B owns the allocation.

Minimal sequence on current, valid evidence:

1. Accept paid initial A; it issues Q=100.
2. Accept competing initial B for the same originating intent and slot, another provider subscription and another initial paid period. Both become held.
3. Resolve B with the latest decision revision and whole evidence read set. This transfers the existing Q from A to B.
4. Resolve the now-held A with its latest decision revision and whole evidence read set.

Actual durable result after step 4:

| Decision | Allocated | Eligible | Held | Status |
| --- | ---: | ---: | ---: | --- |
| A | 100 | 100 | 0 | issued |
| B | 100 | 0 | 100 | held |
| Total | **200** | 100 | 100 | |

The effect history is `grant +100`, `support_transfer_out -100`, `support_transfer_in +100`, **`restoration +100`**. Its net is 200. No refund or removal of an adverse state occurred. There is still only one row with `kind="grant"`, so counting original-grant rows misses the error. The selected-period guard and applied allocation ownership also disagree.

**Reproductions:**

- `tests/review/wave2-consumer-probes.test.ts`, first test: real owner-local PostgreSQL transactions and two unmodified immutable completion facts.
- `tests/review/wave2-transfer-public.test.ts`: actual Paddle SDK transport held by an explicit promise barrier; operation deadline; authorized unknown-operation retry with accepted duplicate risk; second checkout success; late first checkout success; two verified completed webhooks; real PostgreSQL T1/T2/public deliveries; then the two local support resolutions.

The public producer trace confirms both facts are classified `initial`, have different transaction/subscription/period identities, and carry `duplicate_initial_purchase`. Both local resolution commands return `resolved` using the current revisions/read set. It reproduces on **both Node runtime floors**. No immutable completion was rewritten, no arbitrary SQL binding was inserted, and no external network was allowed. The expected amount is independently fixed at a single conserved Q=100, with the allocation owned by whichever initial period was selected last.

**Impact:** the new cross-period support-transfer mechanism is not reentrant. A legitimate correction of an earlier operator selection manufactures an additional restoration and leaves held allocation behind. Eligible is still constrained to one Q in this minimal trace, which is why this is P2 rather than another immediate eligible-overissuance P1. Its allocation and financial effect history are nonetheless incorrect, and future correction/restoration/reassignment decisions start from contradictory ownership.

**Minimal fix:** decide whether an allocation transfer is needed from the current guard allocation owner, independently of whether the target decision already contains immutable original-grant metadata. Atomically remove/move the existing amount, update both period decisions and `allocationOwner`, and preserve the original issuance identity. A real transfer back is not a provider refund or a second restoration. Give each real transfer transition its own stable idempotency identity; the present effect keys use only original grant + old basis + new basis, so an A→B→A→B regression should also guard against suppressing a later genuine transfer through an earlier pair's effect key.

**Regression:** extend the existing one-direction transfer test to A→B→A→B with restart and duplicate command replays. After every successful selection, assert allocated total Q, eligible total Q, held zero for the displaced initial, guard owner equals the selected initial period, one immutable original grant, no fabricated correction/restoration, and effect totals per basis agree with the durable allocated amounts. Include a stale competing resolution to retain the already fixed shared-guard CAS behavior.

## Verified prior fixes and other checked boundaries

The frozen build succeeds with TypeScript 7.0.2. The existing **31 E2E tests pass on Node 24.21.0 and Node 26.11.1** against the authorized local PostgreSQL 18 instance. Specifically:

- A first unrouted held or unknown-payload-schema revision 4 remains authoritative across complete 3, restart and replay in both owners. A later qualified complete 5 advances once. The original wave-1 revision regression is closed.
- Initial/renewal/recovery evidence with identical period strings shares one period decision. The additional initial guard holds competing initial periods/streams, and a resolution changes the other period's decision revision through the guard digest. The concurrent stale operator command loses. The original wave-1 classification-key defect is closed for identical timestamp representations.
- Refund-first `4→3→4`, ordinary paid/refund/reversal causal history, duplicate support selection, pending/partial local policy redrive, buyer membership phantom coverage and before-commit rollback assertions remain green. The new defects do not require bypassing those locks or CAS checks.
- Access uses separate owner-local custody, combines transaction and subscription contributions under the buyer guard, preserves known financial periods, holds newer unknown lifecycle evidence and keeps read/export/cancel available under commercial restriction. Security restriction writes and expiry refresh share the buyer guard.
- The public purchase handlers obtain buyer identity from authentication and ignore a body-supplied buyer. Webhook verification precedes durable admission. Management/customer-wide authority remains a separate trusted-host capability; no new token-authority bypass was established in this review.

These are scoped observations, not claims that every unsupported provider state has a product policy or that a consumer fixture is a production ledger. I did not classify conservative access policy choices or hypothetical mutable completion rewrites as new findings.

## Reproduction commands and limits

Run from the detached review worktree with its frozen installed/build outputs. For each runtime floor, use that runtime's full Node path and the authorized temporary database:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node tools/run-tests.ts e2e
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test tests/review/wave2-consumer-probes.test.ts tests/review/wave2-alias-public.test.ts tests/review/wave2-transfer-public.test.ts
```

The existing suite passes; the review-only independent oracles intentionally fail on the reported actual values. All probes use random isolated payment/consumer schemas and remove them in `finally`. The SDK transport is controlled only in the test process using the existing MockAgent approach, with network connections disabled. The unknown-operation trace uses a promise barrier and the operation's real deadline, not a fixed sleep as a correctness oracle. No live key, customer, external request or charge is involved.

This review did not rerun physical crash/PITR, real Paddle sandbox destination, full production SQL fault injection, packed-consumer or reconciliation/worker qualification. Those limits are not additional findings. This is a focused independent consumer/protocol/public-host review at the exact frozen commit above.
