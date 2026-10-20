# Bounded custody transaction read reduction

The integrated `1eb7a94` PostgreSQL gate could reach the existing 2,500 ms
transaction timeout before the intended late custody failure in a 200-input
reconciliation page. This work keeps the page bound, transaction budget, fixture
trigger, atomic rollback assertions, historical-parent fencing and all lock
phases unchanged.

The exact fixture was measured with test-process instrumentation of pg query
promises and Drizzle `toSQL()`, outside maintained runtime code. The
[before/after measurements](drizzle-custody-performance.json) retain aggregate
query counts and illustrative timings on Node 24.21.0/PostgreSQL 18.4.
Those diagnostic runs selected the exact scenario. The normal PostgreSQL group
uses Node's default test-file concurrency, even when the group has the sole
external database lease. This change leaves that group concurrency unchanged;
an isolated timing sample does not stand in for the full-group gate.

| Transaction | Before queries | After queries | Before record reads | After record reads | Lock phases |
| --- | --- | --- | --- | --- | --- |
| Late injected custody rollback | 1,215 | 815 | 803 | 403 | 5 → 5 |
| Complete page commit | 1,218 | 818 | 803 | 403 | 5 → 5 |

Each 200-input page eliminates exactly 400 roundtrips. Drizzle compilation alone
took about 40 ms in the baseline; it was not the dominant measured cost. The
baseline isolated transaction timings were 582/694 ms for rollback/commit; the
corresponding changed run took 736/524 ms. Those samples show substantial timing
variation and do not establish a universal latency percentage or prove why an
earlier full-suite run crossed its budget. The deterministic improvement is
roughly one third fewer queries with identical lock and write operations.

Two repeated reads had no additional concurrency benefit:

- T1 already loads each existing inbox receipt after acquiring the receipt
  advisory locks. The reduction loop now uses that page-local map and updates it
  immediately after every successful inbox write. Later occurrences of the same
  identity in that page therefore see the preceding admission, duplicate or
  conflicting receipt, including an already processed state.
- `inputRoutes(input)` retains explicit adverse routes;
  `objectVersionDependentRoutes()` also includes direct observation routes.
  The affected union now visits each identical `(type, id)` once. It retains the
  original lock discovery union and all historical, incoming and adverse routes.

No query template registry, persistent cache, aggregate cache, new transaction
wrapper, runtime dependency or schema change was introduced. Receipts remain
local to one locked transaction; aggregate reads continue to observe earlier
page writes through pg. A focused real-PostgreSQL oracle admits an original,
its exact duplicate, a contradictory representation on a different route and
two already processed replays in one page. It requires ordered admission
results, first-receipt retention, separately stored contradictory evidence,
custody on old/new/adverse routes, quarantine and completed receipt/work state.

The original 200-input late-fault/rollback and historical-parent concurrency
scenarios remain the end-to-end correctness gates. Their passing results must
come from the current full PostgreSQL qualification; query-count reduction by
itself does not establish a full release or production latency guarantee.
