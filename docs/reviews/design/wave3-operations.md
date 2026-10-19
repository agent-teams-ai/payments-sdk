# Wave 3 — independent operating-correctness review

Reviewed immutable `research/reviews/wave3-plan.md`, SHA-256 `55a2828dadae96c92e23a3d137ee5b3c52b9b7210c5c1d0211c8cdb9d430bcd7`, in full, against the full supplied handoff, full Q 1.1.2, `research/reuse.md`, and `research/reliability.md`. Inspected the retained published pg 8.23.1 and pg-boss 12.38.0 sources. Research only; no implementation, account operations, or changes to the plan. No other critic reports were read.

## Assessment

Three remaining operational contract gaps merit changes: the database durability assumption behind dispatch permission; recovery after independently restored payment/consumer databases; and a client-side bound for database-response loss. The first two can defeat monetary correctness even when every described SQL transaction and worker behaves correctly. The third defeats the stated bounded ingress/recovery behavior during a network failure.

The ordinary-worker choice is coherent: same-client enqueue, external I/O outside SQL, short application-owned commits, automatic pg-boss settlement, and idempotent replay across the domain-commit/job-completion gap. Separate schema pairs for independent scopes, shared namespaces for replicas, borrowed-pool ownership, migration-free runtime, and physical-handler shutdown debt are explicit decisions. They are not findings. The quarantine-publication obligation is explicitly included in recovery in §5, even though §9's shorter inventory does not repeat its name.

## 1. P1 — A successful dispatch-marker commit has no stated crash/failover durability contract

**Location:** §§4–5, §9 reference deployment and recovery; particularly the rule that the SDK may run after the `dispatch_started` CAS commit succeeds.

The protocol uses this commit as an irreversible permission boundary: once external dispatch starts, every future worker must see a non-retryable command. However, the host supplies the PostgreSQL pool and deployment configuration, and the plan constrains neither commit durability nor promotion of a lagging database. PostgreSQL 18 alone does not establish that acknowledged commits survive the deployment's recovery process.

**Failure trace:**

1. A prepared create command is durably present. The host's session uses `synchronous_commit=off`, or it uses a primary whose eventual failover target is asynchronously replicated.
2. `beginExternalDispatch` returns successful commit. The worker invokes Paddle once; Paddle creates the transaction.
3. The primary crashes before that marker is flushed, or fails over before the marker reaches the promoted standby. The surviving payment store still contains the earlier prepared command, but not `dispatch_started` or the attempt observation.
4. Startup repair recreates ordinary prepared-command work. All local CAS checks succeed against that surviving history, authorizing a second create. No queue fence can identify the erased attempt.

**Consequence:** duplicate remote objects/charges become an automatic recovery behavior, contrary to the stated unknown-outcome guarantee. The same gap can erase a T1 admission after HTTP 200 or a consumer receipt after acknowledgement. These are not transaction-atomicity failures; the acknowledged transaction itself has disappeared.

**Evidence:** PostgreSQL explicitly cautions against asynchronous commit when the client takes an external action relying on the transaction being remembered. Its replication documentation also states that asynchronous streaming can lose already committed transactions on promotion. Setting local `synchronous_commit=on` addresses local WAL flushing, but does not make an arbitrary asynchronous promotion target lossless. See [PG18 asynchronous commit](https://www.postgresql.org/docs/18/wal-async-commit.html), [WAL settings](https://www.postgresql.org/docs/18/runtime-config-wal.html#GUC-SYNCHRONOUS-COMMIT), and [standby replication](https://www.postgresql.org/docs/18/warm-standby.html).

**Minimal fix:** state the deployment precondition for the promised guarantees. Payment-owner and consumer correctness records must use logged, crash-safe storage and locally durable acknowledged commits; the adapter should enforce or verify its per-transaction commit setting instead of inheriting a weaker borrowed-session default. An automatically promoted database must preserve the acknowledged correctness records. A simple supported first profile can be one durable primary with no automatic lossy promotion; synchronous HA is not mandatory infrastructure. Any recovery that may have discarded acknowledged WAL must enter the restore/reconciliation fence in finding 2 before dispatch or fulfillment resumes. Do not attempt to solve lost dispatch markers by retrying Paddle.

**Focused gate:** qualify dispatch-marker, T1, T2 and consumer commits against the declared database profile. Demonstrate refusal/override of a deliberately weakened session setting. If HA is advertised, exercise its actual promotion path after an acknowledged marker and prove it remains visible before any new monetary worker runs. The accepted alternative is a demonstrably closed recovery gate, not an assumed safe replay. This is a deployment qualification requirement, not a request to construct a new HA controller.

## 2. P1 — Queue repair and provider catch-up cannot safely resume independently restored owners

**Location:** §5 producer revisions and acknowledgements; §9 recovery/retention; P7 runbook.

The plan correctly separates payment and consumer transactions and retains each owner's correctness records. It does not define what happens when one database is restored to an earlier point while another owner retains newer state. Normal restart repair assumes monotone surviving history. A restore invalidates that assumption, even with perfect backups and no corrupted rows. PostgreSQL's [PITR documentation](https://www.postgresql.org/docs/18/continuous-archiving.html) describes restoration to an earlier database state and a new WAL timeline; a new PostgreSQL timeline does not update the application's producer identity, receipts or evidence counters.

**Producer-rewind trace:** the consumer has accepted evidence revision 10. The payment database is restored to revision 3, keeping the same stable producer namespace. A newly discovered approved refund produces revision 4. The consumer follows the specified contract exactly: it writes a stale receipt, performs no correction and acknowledges custody. Sender delivery is then complete. The refund need never affect the consumer unless enough unrelated future revisions happen to overtake 10. Alternatively, a reused revision/message ID with a different body creates a permanent integrity conflict. A full retained-window event scan does not repair this protocol mismatch.

**Consumer-rewind trace:** the payment owner retains an acknowledged delivery, while the consumer restores to before its receipt/grant commit. Its own database is internally consistent, but the paid entitlement is absent. The sender's unacknowledged-delivery repair finds nothing to send. This can persist indefinitely without a new provider event. Restoring only receipts, effects or balances separately introduces still worse mismatches; their transaction boundary must also be their recovery unit.

**Consequence:** silent missed refunds or paid benefits, conflicting immutable message identities, and potentially repeated irreversible downstream work. The 90-day provider history limit makes waiting for general reconciliation especially inadequate. Queue rows cannot reveal erased producer/consumer checkpoints.

**Minimal fix:** add a short owner-controlled recovery runbook and one explicit resume gate, rather than a distributed transaction framework:

- Define the backup/recovery unit of each owner: payment bindings/intents/attempts, facts, evidence revisions, delivery checkpoints and deduplication; consumer receipts, causal contributions, decisions, effects and outbox. Queue jobs remain reconstructible.
- After restoration or uncertain WAL loss, keep monetary dispatch and automatic fulfillment closed. Record the restored horizon and unresolved coverage. Prepared commands in the possible lost interval are not evidence that no dispatch occurred.
- Recover payment truth and immutable producer history from available WAL/archives and provider evidence. Before publication resumes, reconcile aggregate revision/message identities with every required consumer's durable checkpoints. Never silently reuse a previously issued identity for a different body, or resume at a revision lower than a consumer's accepted history. If exact recovery cannot be established, hold the affected aggregates for recorded resolution.
- A restored consumer explicitly reopens its delivery/backfill position and replays retained immutable evidence using the original message and benefit identities. This is distinct from adding a new consumer. Preserve effect idempotency and previously committed external effects; resetting a receipt table or inventing a new producer namespace is not a recovery shortcut.

The smallest honest v1 contract may declare automatic PITR resumption unsupported and require this manual fenced procedure. It must describe the fence and reconciliation conditions, rather than imply that ordinary startup repair is sufficient. Independent ownership does not require a shared SQL transaction to compare recovery checkpoints through public APIs/exports.

**Focused gate:** restore only the producer with consumer checkpoint 10 retained, then admit a refund; restore only the consumer with sender acknowledgement retained; and restore across a dispatch-marker interval. Assert that normal workers remain fenced until recovery is resolved, refund evidence cannot be acknowledged merely as stale, paid benefits can be explicitly backfilled, no revision/body identity is reused, and no second create is automatically authorized. Use isolated databases/fixtures, not live accounts.

## 3. P2 — Server SQL budgets leave database-response loss outside the bounded ingress contract

**Location:** §9 T1's 500/500/1500/2500 ms budgets, 4500 ms ingress target, cleanup and shutdown.

The chosen server limits bound server execution and locks; they do not bound the client's wait for a reply over a partitioned connection. The exact pg 8.23.1 client distinguishes `query_timeout` from server `statement_timeout`; `query_timeout` defaults to disabled. See retained `research/sources/reuse/pg/package/lib/defaults.js:65–76`, `lib/client.js:702–735`, [pg client configuration](https://node-postgres.com/apis/client), and [PG18 timeout semantics](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-STATEMENT-TIMEOUT).

**Failure trace:** T1 acquires a client promptly and executes within the SQL budgets. The database commits the inbox, but the COMMIT response is lost in a network blackhole. PostgreSQL has finished its transaction, so its server transaction timeout cannot resolve the JavaScript wait. With no client read deadline the handler remains suspended beyond Paddle's five seconds, holding a borrowed client. Repeated deliveries exhaust the shared pool. If the lost reply occurred during a failed statement, unbounded rollback cleanup can produce the same pool/shutdown debt. The same class affects queue fetch/settlement and maintenance queries through the external Db wrapper.

**Consequence:** the held-row gate can pass while actual database connectivity failure indefinitely blocks ingress and shutdown. Even an HTTP-layer timeout alone leaves the resource leak unless it also settles or destroys the outstanding database operation. This is distinct from the deliberately tracked unabortable Paddle request.

**Minimal fix:** make the existing overall ingress budget an absolute client-side deadline covering SQL waits and cleanup, using the driver's supported read timeout or a narrowly scoped connection-destruction path. Reserve cleanup time; do not multiply a fresh full budget for every statement. On expiry, return bounded 5xx and remove the uncertain client from the pool. A lost COMMIT reply means unknown commit outcome, not proof of rollback: duplicate admission must discover whether custody committed, and dispatch must never start without confirmed permission. Apply explicit client wait limits to the borrowed Db wrapper's queue queries as well; do not change the host pool's global session state for sibling scopes.

**Focused gate:** inject response loss/blackholing after BEGIN and around COMMIT, including the case where COMMIT actually succeeded. Assert bounded HTTP failure, disposal rather than reuse of uncertain clients, stable pool occupancy after cleanup, and safe duplicate admission. Check the same failure during a pg-boss poll/settlement so `stop()` cannot wait indefinitely on an unbounded database promise. This supplements the already specified held-lock gate; it does not require a broad fault-testing platform.

## Final disposition

No change of worker engine, ordinary-work mode, schema topology, or context boundaries is needed. Findings 1–2 need explicit operational preconditions and a fenced recovery path; finding 3 needs the missing client-side deadline/disposal rule. The plan's existing crash, quarantine-publication, sibling-scope, physical-shutdown and migration-free gates should remain as written. Their lack of execution during research is not itself a defect.

Final immutable-input hash rechecked before delivery: unchanged at `55a2828dadae96c92e23a3d137ee5b3c52b9b7210c5c1d0211c8cdb9d430bcd7`.
