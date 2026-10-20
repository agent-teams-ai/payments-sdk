# Independent custody batching review

## Subject and verdict

Reviewed `dadf150` (bounded read batches), `623b4db` (per-input record batches)
and evidence correction `7dcadf6`, against `2f706ea`, in
`implementation/payments-performance`. Exact clean review head:
`7dcadf6762a37e694dbca3b08a92fd1498921395`. Runtime source subject:
`623b4db4a729973c3e4947d6624750573acc9fda`.

**No remaining P0–P2 findings.** The code preserves owner-local transaction and
lock semantics while reducing round trips for the maximum contradictory-event
page. The change does not reduce the 200-input limit, weaken the original fault
oracles, raise deadlines, coalesce revisions across inputs, cache aggregate
state across a page, or omit obligation/queue work.

A narrow machine-readable evidence error was identified during review: the
initial per-input batch record counter was 1 rather than 201 because a classifier
overwrote rather than summed two SQL shapes. It is corrected in `7dcadf6` from
the retained raw trace. This finding is closed; the correction does not change
runtime source.

## Read batching

`PaymentRecords.readMany` uses public typed Drizzle schema/query construction,
`eq` and `inArray`. It deduplicates requested IDs, skips empty input, enforces
the existing 512-identity record/lock bound, preserves missing-key absence and
validates every returned revision with the same safe-integer check as `read`.
Its `id`, `revision` and JSON body projections use existing raw pg-compatible
column representations. Generic JSON-body assertions retain the existing
private record-store trust boundary; no ORM validation is falsely inferred.

Event identities, inbox receipts and exact-version evidence are loaded only
after their respective unchanged lock phases. Incoming plus retained versions
may exceed 200 keys, so the 512-key bound does not accidentally narrow the
accepted page profile. Returned row order is irrelevant to these lookup maps.

Aggregate batches are restricted to the current input, after all route locks
and after the preceding input's complete writes. The code then populates state
in the affected-route order. It retains the original/adverse/historical/event
route union and sees preceding same-page aggregate changes. There is no
page-wide aggregate snapshot or cache whose stale state could overwrite a prior
input's transition.

## Per-input writes and limits

`writeMany` prevalidates the complete call's unique canonical `(kind,id)` keys
before the first SQL statement. Repeated identities are rejected across future
chunk boundaries, rather than being silently coalesced or updated twice in one
statement. Its 515-record cap accommodates the existing maximum of 512 locked
aggregate identities plus an event identity, inbox receipt and conflicting
representation. This does not impose a 200-record cap on a valid input.

The helper streams at most 100 rows or approximately 2 MiB of serialized body
bytes per statement. The documentation correctly identifies that metric as
body bytes, not a complete protocol-packet guarantee. An individual larger
stored body is still executed singly, preserving the prior single-write
behavior. Empty input is a no-op.

Single-record `write` delegates to the same typed upsert implementation. Its
explicit serialized jsonb parameter preserves JSON null. `body IS DISTINCT FROM
excluded.body` retains no-op revision and timestamp behavior; changed records
advance exactly once and use the existing `clock_timestamp()` expression.
Membership guards retain their separate unconditional increment logic.

Within each input the staged record order remains event identity, inbox,
conflicting representation, transaction aggregates and subscription aggregates.
All chunks complete before the receipt and event maps update. The code then
executes every existing publication/inbox obligation and pending pg-boss enqueue
sequentially through the same transaction before processing the next input.
Grouping records before those obligations is the explicitly authorized bounded
change; no queue singleton identity, transport seam or transaction owner changes.

Across inputs, every transition is still a distinct awaited operation. There is
no whole-page flush, revision rewrite or key coalescing. Any failure propagates
through the unchanged transaction owner, rolling back prior chunks and inputs.

## Independent oracle review

The new batch regression seeds rows using direct SQL, then requires independently
specified persisted outcomes: equal jsonb leaves revision 5 and the original
timestamp unchanged; changed content advances revision 9 to 10; JSON null is
stored as JSON null. It also covers empty input, all 515 supported identities,
rejection above that bound, duplicate rejection across a prospective chunk
boundary before any row is written, an individually oversized body, and a
row-trigger failure at identity 514 that rolls back all preceding chunks.

The same-page admission regression now explicitly requires the adverse route's
previous pending marker to survive a later input. Its existing direct persisted
checks cover first-receipt retention, separately stored contradictory evidence,
old/new/adverse route conflict flags, quarantine and processed receipt/work
preservation. These are meaningful consumer/storage oracles, not expected values
computed from the optimized implementation.

Read-only git comparison confirmed the original reclassification 200-input
fixture, actual official-SDK 200-member reconciliation fixture, database timeout
owner and schema/execution helper remain unchanged from `2f706ea`. Late custody
and final scan-update faults, atomic cursor/input rollback assertions, the
original pg_locks row trigger, 512-lock checks where present, and the 2,500 ms
transaction budget remain intact.

## Evidence inspection and limits

The retained history honestly distinguishes three different results: the first
redundant-read fix did not close the maximum SDK-page failure; bounded reads
passed isolated execution but still failed the full PostgreSQL group; the final
per-input record batching subsequently passed the unchanged full group on Node
24.21.0 in the author's retained run.

I independently read `/tmp/payments-performance-events-upserts-node24.json` and
recounted record SQL shapes for the complete maximum-page transactions. Both
contain 200 multirow record statements and one single-row checkpoint record
statement, totaling 201. Their total query counts are 1,013 for intended rollback
and 1,014 for complete commit. The raw trace SHA-256 is
`ca570b7c9237da29b6e9fc55a0d2908197e23802581b7fee2d4b415b3c2915c8`, matching
the corrected record. The earlier baseline's 2,013 queries were partial work
before timeout, and the documentation correctly avoids comparing them as a
completed baseline.

I also inspected the retained full-group log
`/tmp/payments-performance-upserts-pg-node24.log`: it reports 45 tests, 45 passes,
zero failures and zero skips. Its SHA-256
`2c24f08bddbae9b322fe3e06c5a50f202600356507a07fa4966f16e43f9097ce` matches
the retained source-bound record. This is inspected author-run evidence, not a
new test run by this reviewer.

Timing samples remain variable and illustrative. The review does not claim a
universal speedup, proven historical wall-clock cause or final release latency
guarantee. Final integrated release admission requires the root's current full
gates on both supported Node floors. Those two-floor gates are not asserted as
passed here.

This review ran no PostgreSQL operation, build, installation or test. Only this
report was written outside the git worktree. No further remediation is requested
by the source, oracle or corrected-evidence review.
