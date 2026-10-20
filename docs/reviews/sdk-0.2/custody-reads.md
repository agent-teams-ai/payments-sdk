# Independent custody performance remediation review

## Exact subject and verdict

Canonical worktree: `/workspace/scratch/9e36ca3bbd13/implementation/payments-delivery`.
Reviewed commits `4d8dae3` plus documentation clarification `2f706ea`, against
`1eb7a94`. Exact integrated head inspected:
`2f706eafa3ae19ebf3539df6a67e1728c135d15a`; the worktree was clean.

**No P0–P2 findings.** The nine-line production diff is a bounded elimination of
redundant reads. It preserves transaction-local sequential receipt semantics,
the full route identity set and the existing locks, reads needed for aggregate
freshness, write sequence and atomic rollback boundary. The focused new
regression oracle is meaningful and independent of the optimized implementation.

This review closes the semantic concerns about the remediation. Closure of the
earlier full-suite timeout risk remains conditional on successful complete
qualification at this exact integrated source on both supported Node floors.
Reduced query counts alone do not prove the cause of the earlier timeout or a
wall-clock latency guarantee. The final two-floor gates were not asserted as
passed at the time of this review.

## Production diff assessment

### Page-local receipt reuse

`packages/payments-postgres/src/store.ts:289–292` uses `existingReceipts`, loaded
after the inbox advisory-lock phase, instead of rereading the same receipt in
the per-input loop. All participating receipt identities remain locked until
the owner transaction finishes. The T2 committing path also locks its inbox
read/write set before mutation, so the removed read supplied no supported
concurrency benefit after this lock was acquired.

`store.ts:331–334` updates that map immediately after each successful durable
inbox write. This placement is essential and correct. Later occurrences of an
input identity within the same page see the receipt produced by the previous
iteration, including the original immutable input, conflict flag and processed
state. A failed write exits the transaction before the next iteration. No cache
escapes the transaction, and aggregate values are still loaded from PostgreSQL
after earlier page writes rather than cached across inputs.

The initial prewrite union of incoming/existing receipt routes and version keys
is unchanged. All incoming representations are already included when computing
the lock set; page-local receipt reuse does not introduce a route after the
locking phase that was omitted from that original union.

### Duplicate route elimination

`store.ts:297–299` de-duplicates `affected` by canonical JSON of `(type, id)`.
These are the complete fields of `AggregateIdentity`; distinct transaction and
subscription identities cannot collide. Map insertion order preserves the first
occurrence's position. Replacing an equal key's route object is immaterial
because its identity fields are equal.

The union still includes the incoming route, the retained original receipt's
route, historical exact-version parent routes, explicit `adverseTransactionRef`
and event-identity routes. Only repeated identical visits are removed. This is
safer than deleting `inputRoutes(input)`, which would lose explicit adverse
routes. All route locks are still acquired from the unchanged complete prewrite
union. The loop still reads each distinct aggregate after preceding writes in
the page. The duplicate visits had no intervening mutation, and the subsequent
conflict-flag branch was already idempotent for those repeated identities.

## Regression oracle assessment

The new `durability.test.ts:11–38` scenario is independently asserted rather than
computed from the admission reducer. It submits one original, the same original
again, a contradictory representation with a different parent, and two replays
of a previously processed receipt in a single page. It specifies the ordered
admitted/duplicate/conflict result directly and queries persisted records and
obligations with SQL to require:

- Retention of the first input instead of replacement by the contradictory one.
- A conflict flag and separate contradictory evidence.
- Conflict custody on old, new and explicitly adverse parent routes.
- No duplicate pending-adverse identities.
- Quarantine of the conflicting receipt.
- Preservation of processed state, one processing attempt and completed work for
  processed replays.

This covers the important stale-map failure that would occur if the map were
not updated within the page and the route loss that could result from an
incorrect deduplication shortcut. Existing concurrency/historical-certification
scenarios remain necessary and unchanged.

## Preserved budgets, fixture and measurement claims

Read-only `git diff --exit-code` confirmed no changes to the original
`reclassification.test.ts` 200-input late-fault fixture, database timeout owner,
records implementation or Drizzle schema/execution helper. The per-row pg_locks
trigger, 512 advisory-lock oracle, injected late custody failure, rollback
assertions, successful retry and 2,500 ms transaction timeout remain intact.

The retained measurement record reports 1,215 → 815 queries for rollback and
1,218 → 818 for successful commit, with record reads 803 → 403 and all five lock
phases unchanged. Record and obligation write counts are also unchanged. This
is consistent with the two removed classes of redundant reads and proves a
fixture-specific reduction of 400 roundtrips in the recorded diagnostic runs.

The paired timing samples vary in direction: rollback 582 → 736 ms, commit
694 → 524 ms. The documentation accurately limits these samples, identifies
normal test-file concurrency and does not claim a universal speedup or a proven
timeout cause. Its statement that approximately one third fewer queries were
issued is appropriately narrower than a latency claim.

## Review limits

This review was entirely read-only except this report. It ran no database
operation, build, installation or test alongside the root's qualification run.
Reported focused/full-group passing results are implementation-agent evidence;
they were not rerun by this reviewer. Final admission requires the root's current
complete Node 24.21.0 and Node 26.11.1 gates, preserving the original fixture and
budgets. No additional remediation is requested by this review.
