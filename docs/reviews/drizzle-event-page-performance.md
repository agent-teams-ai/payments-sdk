# Maximum contradictory-event custody page

The first custody optimization removed repeated reads but the SDK reconciliation
fixture has another maximum valid shape: 200 retained event identities, 200
incoming receipts and 400 distinct old/new aggregate routes. At baseline
`2f706ea` the isolated integration file itself reproduced PostgreSQL's 2,500 ms
transaction timeout during admission, before its intended final scan-update
fault. This is a production I/O path issue independent of whether test files
also run concurrently.

The [retained measurements](drizzle-event-page-performance.json) distinguish
that incomplete baseline from complete transactions after each bounded change.
The same original fixture, trigger, transaction timeouts and 200-input bound were
used throughout. The usual full PostgreSQL group still uses Node's default file
concurrency; an isolated sample is not a replacement for that gate.

| Stage | Queries | Record reads | Record upserts | Obligation upserts | Result |
| --- | --- | --- | --- | --- | --- |
| Baseline, partial | 2,013 before termination | 723 individual | 801 attempted | 480 | Server transaction timeout |
| Phase preloads | 2,013 / 2,014 | 401 individual + 2 batches | 1,001 | 600 / 601 | Intended rollback / complete commit |
| Current-input route batches | 1,813 / 1,814 | 1 individual + 202 batches | 1,001 | 600 / 601 | Intended rollback / complete commit |

All stages retain five advisory lock phases. The before count is partial and
must not be interpreted as a fully completed baseline with the same work.
Phase-local event and receipt batching removes 398 lookup roundtrips from the
complete page; batching each input's same-kind old/new routes removes another
200. No write or revision transition is coalesced.

The baseline timeout occurred after 2,538 ms. Complete phase-preload transactions
took 1,687/2,056 ms; the route-batched transactions took 1,790/755 ms. These are
illustrative, variable diagnostic timings rather than a universal speedup or
production latency guarantee. Drizzle `toSQL()` was about 80–109 ms in those
transactions; reducing roundtrips addresses the substantially larger query
promise duration.

`PaymentRecords.readMany` is a typed collection lookup using the existing schema,
`eq`/`inArray` and transaction executor. It deduplicates keys, skips empty input,
preserves missing-key absence, and validates each returned int8 revision. Its
512-key bound shares the existing lock-set bound: incoming and retained exact
versions can legitimately exceed 200 keys. Lookup maps do not depend on database
row order.

Event identities, receipts and version evidence each load only after their own
unchanged lock phase. The receipt/event maps retain their preceding per-input
write updates. Aggregate lookup is limited to the **current** input after all
route locks are held and every preceding input has completed its writes. The
state is populated in the original affected-route order. There is no page-wide
aggregate snapshot, global cache, new transaction wrapper, write batching or
queue/enqueue change.

Regression coverage includes duplicate/missing/null lookup keys, empty input,
400 supported keys, rejection above 512 and safe-integer overflow checks. The
same-page duplicate/conflicting-route oracle also requires a later input to
retain the previous aggregate's pending-adverse marker. Existing historical
certification races, late page failures, atomic checkpoint rollback and full
SDK custody tests remain unchanged and must pass in the current full gate.

Read batching alone passed the isolated integration file, strict compilation
and lint, but the unchanged full PostgreSQL group still failed this maximum
SDK page with a server transaction timeout (42/44 including its parent failure).
That red result is retained; successful isolated samples do not qualify this
intermediate stage. The remaining 1,001 record upserts and 600/601 obligation
upserts in the complete page justify investigating bounded per-input record
write batching while keeping every input's revision and queue work distinct.
