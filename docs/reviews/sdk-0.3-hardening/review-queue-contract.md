# Queue transport contract review — SDK 0.3

Current reviewed target: `/workspace/scratch/9e36ca3bbd13/implementation/payments-queue-ports` at **`ee1b4941481cc92c43f74834bca58f9a4c80961f`**, clean worktree, compared with baseline `58441742d2f3743e4681f4bb02b2ff013023d652`. Independent source review and focused re-review on 2026-10-21. No install, build, PostgreSQL test, push or source edit was performed by this reviewer. The initial finding below describes an earlier dirty snapshot and is explicitly closed against the current commit.

Authority read: repository `AGENTS.md`, `docs/developer-stack.md`, accepted plan sections 1–2 and 9, `docs/architecture.md`, PostgreSQL adapter guide, new `docs/queue-transport.md`; retained organization quality standard in `research/org-current`; pinned Q skill `5f1b5aefa96d64448d909ae9c04a823afe145ea8` (GitHub blob `c30b755f8402c470e8d407950b36ae04b2873113`).

## Current disposition

**No remaining material finding established in the reviewed scope. The cold-enqueue P2 is closed at source in the current commit.** Qualification still belongs to root and the test owner; I have not independently run their reported tests.

### P2 closure: every vendor admission SQL path now uses the supplied transaction

`job-transport.ts:125–133` creates one local executor forwarding only to the supplied `PaymentSqlTransaction`, passes it into the inert PgBoss constructor via `makePaymentBoss(..., executor)`, and also passes it as `send.db`. The pinned vendor's cold queue metadata read and its INSERT therefore both use the same checked-out connection and absolute transaction budget. Enqueue no longer depends on the worker instance's queue cache or an additional pool slot. The worker PgBoss remains separately pool-bound for its out-of-transaction lifecycle.

I inspected the pinned vendor implementation rather than assuming construction is inert: `PgBoss.getDb()` returns the configured adapter; its constructor wires subsystems without opening a pool or issuing SQL; manager, scheduler, maintenance, flow, registration and notification timers start only in their start methods. The registrar's Nurse is inert until started. Send awaits its metadata and INSERT path; error refresh reads also use the same constructor executor. There is no start, retained callback registration or background SQL path on the local admission instance. Its internal event-listener cycle is local to that call. Vendor telemetry can use the host's globally configured tracer/meter, but the never-started instance registers no queue observation callback or polling timer that retains the transaction.

The current real-PostgreSQL regression, `packages/payments-postgres/test/jobs.test.ts:137–153`, uses an actual borrowed `Pool` with `max:1`. It performs cold queued-store admission before worker start, admits a second obligation through a queue-free store, starts the same runner, and independently asserts both operations succeeded, exactly two provider calls occurred and the pool retained one connection. This directly covers both forms of the finding; no warm-cache assumption is used. Root/test owner reported Node24 focused 13/13 passing, including this test; that is owner-run evidence, not a run by this reviewer.

### Stop/start failure and physical drain re-review

`jobs.ts:251–260` still closes admission on partial-start failure and retains the original installed handlers/core runtime. `stop` closes admission before waiting, reports success only after transport stop resolves, and clears only a rejected cached cleanup attempt so the owner can retry (`272–294`). Diagnostic reporting remains nonthrowing. `drain` tolerates rejection of an in-flight stop attempt and continues to await every admitted handler and then the original core's physical drain (`297–301`). A remaining `transportStopped:false` result remains visible rather than certifying resource release.

Bundled transport stop now attempts both worker cleanups and subsystem shutdown despite individual rejection, and reports an aggregate cleanup failure (`job-transport.ts:148–155`). The alternate held-consumer test starts `jobs.stop` and `jobs.drain` concurrently, deliberately rejects the first transport stop, proves drain remains pending while the already admitted consumer I/O is held, retries cleanup, verifies an independent sibling namespace on the same borrowed pool, then releases T3 and checks exact ACK and full drain (`tests/e2e/queue-transport.test.ts:146–182`). The test uses explicit promise barriers; a microtask check only verifies that the held promise did not allow premature completion. I established no hidden physical-debt loss in these changes.

### Reviewed current source identity

All hashes below were read after the implementation commit; `git status --short` and `git diff --check` were empty.

| File | SHA-256 |
| --- | --- |
| `packages/payments-postgres/src/job-transport.ts` | `62f9891104393a600bdb48cd638f766abe0a7c70c7494f11575be0683892a592` |
| `packages/payments-postgres/src/jobs.ts` | `35e6da2332cd7c485b1a4b9d8e36192032dc86e6465cdc27c3b16855364e52fb` |
| `packages/payments-postgres/src/work-transport.ts` | `c3252e22b4e11ea82076a7b7afb464d134ff8ce3a07c03b75d4f19e45a68ec0f` |
| `packages/payments-postgres/test/jobs.test.ts` | `043bb59beb9974d7c9989dd6c47445cf7b6656c9de0ca9b1696667b72e764e74` |
| `tests/e2e/queue-transport.test.ts` | `a0fe38bc42787348d7974bcfc6c3e93f3b41095f7b796593d04b28ab524c7f55` |
| `tests/e2e/queue-transport-fixture.ts` | `a8ac5c7e1b8a2291c4c3562b053fafe398f6e2beeee157d54ec5358a893e972c` |

## Historical material finding — resolved

### P2 — Cold bundled enqueue acquires a second connection; startup now reaches this path before vendor initialization

Affected initial review lines: `packages/payments-postgres/src/job-transport.ts:119–127`, especially `boss.send` at 124; `packages/payments-postgres/src/jobs.ts:241–246`.

The new enqueuer promises to execute only on the supplied bounded payment transaction (`work-transport.ts:10–16`). Passing `send(..., {db: transaction})` routes the job INSERT through that transaction, but pinned pg-boss 12.38.0 first calls `Manager.getQueueCache(name)` on its constructor executor (`node_modules/.pnpm/pg-boss@12.38.0_@opentelemetry+api@1.9.1/node_modules/pg-boss/dist/manager.js:1518–1526`). A cache miss calls `getQueue`/`getQueues` on the independently pooled executor (`1044–1057`, `2390–2400`, `2436–2438`). Qualification calls `getQueue` directly and does not fill this cache.

Concrete reproduction: use a borrowed pool with `max:1`; bootstrap the schema; admit one prepared operation through a store without queue; construct a fresh transport/runner and call `jobs.start`. Startup now runs `repair` before `transport.start`, so repair holds the sole payment checkout and the cold vendor metadata lookup requests a second checkout. The bounded acquisition fails and startup rejects despite otherwise valid durable setup. Under a full larger pool, concurrent first admissions can also consume all slots while each waits for an extra checkout.

**New versus preexisting:** cold store enqueue before vendor startup could already make this extra checkout in the baseline. The new port makes its exclusion explicit, and moving startup repair before vendor start newly introduces this cold-cache path during normal startup; baseline `jobs.ts:245–246` called `boss.start` (which populates the cache) before repair.

Action: make every SQL operation required by enqueue—including vendor queue metadata reads—use the supplied transaction. Do not depend on a warm cache or add an unstated spare-connection precondition. Add a real PostgreSQL regression with `max:1` covering cold queued-store admission and startup repair of a queue-free obligation.

Coordination: reported to root and `storage_queue_portability_audit`; implementer confirmed and fixed the cause. The fix was independently re-read and closed against commit `ee1b4941481cc92c43f74834bca58f9a4c80961f` as recorded above. This historical section is not a finding against the current commit.

## Other reviewed guarantees and limits

- Store enqueue remains after obligation upsert on the existing payment transaction; rollback and unknown-COMMIT ownership stay in the unchanged `withPaymentTransaction`. The alternate SQL fixture inserts its durable wake-up through the supplied executor and injects failure after INSERT, so its rollback scenario tests the relevant commit boundary.
- Repair applies the trusted transport predicate before LIMIT and retains obligation `FOR UPDATE SKIP LOCKED`; placeholders are local to the transport and the runner appends LIMIT after its parameter values. No request input is interpolated into this seam. The alternate fixture uses a different relation, payload shape and two parameters, with competing batch-one repair coverage.
- Claim revision/attempt fencing, operation-state reread, durable dispatch marker, payment-local retry/quarantine and receipt validation/producer ACK remain in the generic runner. The new fixture exercises durable independent credit T3, lost receipt, mismatched digest, audited redrive and duplicate wake-up replay. Source assertions are evidence of intended coverage, not a passing-run record.
- The generic store/runner source and the newly exported transport declarations contain no pg-boss or Drizzle type; the concrete pg-boss factory remains explicit outer composition inside the existing PostgreSQL package. No fifth package, generic broker engine or core SQL port is needed.
- Bundled namespace ownership/bootstrap metadata and runtime read-only qualification are preserved. Terminal jobs are excluded from runnable deduplication and removal of `singletonSeconds` prevents retained terminal rows from imposing a repair time window on standard-policy queues.
- Admission closes before stop awaits; admitted handlers retain their original installed runtime. Concurrent edits added retryable transport cleanup and a held-consumer drain test. Existing held-provider and failed-start physical-debt regressions are retained. Their execution results require the owner's exact-head gates.

No second material defect was established in the reviewed atomicity, fairness, mutation fencing, namespace, predicate or type boundary paths; the one initial P2 is closed in the current reviewed commit. Source review does not independently qualify another production queue engine, remote-broker atomicity, another durable database or a final integrated release. Root retains final integration and exact-head qualification ownership.
