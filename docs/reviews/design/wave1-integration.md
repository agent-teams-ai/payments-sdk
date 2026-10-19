# WAVE1 independent integration review

**Subject:** `research/reviews/wave1-plan.md`, SHA-256 `bf6902d8bbba502ce4b93492dc5646d0a1a704e575f0f98fabf012f61ccb6cce` (verified before review). Read the complete supplied handoff and Q 1.1.2. Lens: Get Modular, Foundation/TS7, runtime and distribution, pg-boss lifecycle, and executable acceptance criteria. No peer reviews read, plan edits, implementation, package installation, database/account actions, or test executions. Existing source/archive evidence was inspected; this review makes no fresh upstream publication or qualification claim.

## Verdict

**Revise before implementation qualification; no P0 found.** The fundamental direction is sound: plain core, external provider/storage/composition adapters, no monetary observation callbacks, separate consumer transactions, and no invention of an accepted Commercial Accounting context. The plan correctly distinguishes published GM 0.5 composition from pending observation and does not invent init/start/stop hooks. The remaining defects concern identities and operational contracts that an implementer currently has to guess. They can be fixed with a few explicit choices and gates, without adding another abstraction layer or changing accepted ADRs.

## Findings

### 1. P1 — Evidence revision delivery identity is ambiguous against the stated per-fact uniqueness

**Sections:** §5, especially lines 127–139, and §7.

The outgoing payload is an immutable `PaymentEvidenceChanged` revision, but delivery uniqueness is stated as `(factId, consumerId)`. The only concretely defined fact identity is the completion fact keyed by transaction/completion. An approved adjustment changes the evidence revision while retaining that completed fact. If delivery intents are unique by the completed fact ID, the consumer that acknowledged revision 1 already occupies the slot needed for revision 2. The refund can be durably observed yet never delivered. Reusing its message ID also causes a correct consumer receipt to discard the update.

This is not an argument for deltas: full evidence snapshots are appropriate. It is a requirement to distinguish three identities: immutable completion/adjustment facts; each immutable evidence revision/message; and the consumer's business effect/grant basis.

**Smallest change:** define the outgoing message and target key as `(scopedTransactionAggregateId, evidenceRevision, consumerId)`, with one stable message ID per revision and target. Keep the grant key from §6 independent of message/schema/policy revisions. State that an acknowledgment marks that revision only; a later revision creates another delivery intent. A consumer atomically records the message receipt and advances its aggregate revision, while using its separate business keys for grants/corrections. If `factId` already means evidence-revision identity, rename/define it explicitly rather than relying on inference.

**Acceptance:** acknowledge a completed-only snapshot, then admit an approved partial refund. The second immutable snapshot must reach that same consumer despite the earlier acknowledgment; replay/reordering must neither issue a second grant nor lose the correction. Evidence: plan §5/§6 itself defines the conflicting identity roles.

### 2. P1 — Retention repair is explicit only for outbox jobs

**Sections:** §9 lines 179–189; P3/P5 and line 251.

The plan chooses pg-boss for inbox, delivery, and unknown/reconciliation work, acknowledges finite job retention, then specifies repair only for unacknowledged delivery intents. An inbox job can exhaust retries or disappear after retention while the trusted inbox row remains unprocessed. An unknown-operation resolution job can disappear likewise. Financial rows survive, but surviving data is not an executable recovery path. A later reconciliation may happen to rediscover an inbox result; it does not guarantee retry of all unresolved bindings, unsupported-state transitions, or uncertain commands.

**Smallest change:** make one bounded payments-owned repair pass cover every durable work obligation: unprocessed/retryable inbox rows, unacknowledged delivery intents, and due unresolved/unknown operations plus reconciliation checkpoints. It recreates missing/terminal jobs under a guarded logical work identity, and surfaces permanent review states. This pass does not implement queue retry/backoff/claiming itself. Unknown commands remain resolution-only; repair must never turn `dispatch_started` back into a fresh monetary dispatch.

Give this pass a startup trigger and periodic owner. State whether failed/dead-lettered work requires automatic safe read retry or explicit operator redrive, so a scan cannot create an infinite hot loop.

**Acceptance:** remove/expire the queue job separately for an unprocessed inbox row, an unacknowledged delivery, and an unknown create. After restart/repair all three obligations become visible/workable; only the first two may finish ordinary processing, and the unknown create performs zero additional mutations. Retained source: `research/reuse.md`, “Retention is the material caveat,” and inspected pg-boss `QueueOptions`/retention mechanics.

### 3. P1 — The described Db wrapper does not establish the transactional-worker capability

**Sections:** §9 line 181 and §12 P3.

The plan correctly says same-transaction admission uses a Db wrapper over the checked-out SQL client. It then permits `transactional:true` workers without specifying a different capability required at construction. An `executeSql` wrapper sufficient for `send(...,{db:tx})` is not sufficient for a pg-boss instance to open worker transactions. In exact 12.38.0, `work()` asserts that the instance Db implements `beginTransaction`; otherwise worker registration fails before the first job. Transaction ownership also determines who releases the checked-out connection after commit/rollback.

**Smallest change:** select one supported v1 mode. The minimal choice is ordinary `work` for the existing HTTP-bearing flows and application-owned short T2 transactions; explicitly leave transactional workers unused until needed. If a concrete SQL-only stage uses them, specify the borrowed-pool Db's `beginTransaction(): {db,commit,rollback}` contract, bounded rollback/release behavior, and pool headroom. Do not create a general transaction manager merely to expose this seam.

**Acceptance:** same-client enqueue rolls back with domain admission, and ordinary workers replay safely after T2 commit. If transactional mode is selected, registration succeeds with the real adapter, handler SQL and completion roll back together on failure, and every acquired client is released. The exact refusal is in `research/sources/reuse/pg-boss/package/dist/manager.js:1160–1176`; the optional capability and settlement requirements are in `dist/types.d.ts:18–83`. These are source observations, not executed results.

### 4. P1 — Migration authority, pool ownership and physical shutdown remain instructions to decide, rather than a decided host contract

**Sections:** §5 line 105, §9 line 183, §10 lines 197–203, P3/P6.

“Host owns stopAccepting→drain→cleanup” and “ownership must be indicated” are correct principles, but leave the central embedding decision open. Does the adapter receive a borrowed pool, does pg-boss open a second pool, and who closes each? Is worker `start()` allowed to migrate? The exact package defaults `migrate`, `createSchema`, `schedule`, and `supervise` to true. An otherwise innocent explicit worker start can therefore perform schema work or fail under an ordinary runtime DB role. A generic `await boss.stop()` is also not proof that an SDK call which ignored cancellation has physically settled. Declaring the resource cleanup complete too early leaves late work using a closed pool or leaked activity in a reused host.

**Smallest change:** choose a reference profile now. For example, host-owned borrowed `pg.Pool`, explicit bootstrap/migration command creates both payment and pg-boss schemas/queues, runtime `migrate:false`, explicit scheduler/supervisor settings, and installed error/warning handlers before start. Runtime startup fails visibly for an incompatible/missing schema. The adapter never calls `pool.end()` on the borrowed pool. If a separate pg-boss-owned pool is chosen instead, name it and budget it explicitly.

Define cleanup as one real sequence: stop ingress/new claims and schedules; await tracked producer/handler settlement or report unresolved debt; stop pg-boss; release adapter-owned resources; host closes its pool after dependent scopes. Persisted `dispatch_started` commands remain unknown after forced process termination. Do not hold a SQL transaction open while waiting for Paddle. Failed partial startup must run the same cleanup obligations.

**Acceptance:** migration-free runtime with reduced DB privileges; failed startup after acquisition; two sibling scopes sharing a borrowed pool; shutdown while provider I/O is held unresolved. Closing one scope must leave its sibling/pool usable, must not report physical drain while the producer is held, and restart must reconcile the unknown command. Exact evidence: pg-boss `dist/attorney.js:407–417`, `dist/index.js:198–235,258–367`; published resources README “Closing,” where `abandon` is explicitly not release and close reports debts.

### 5. P1 — GM dependency ownership and the observation upgrade train are not fixed in the distribution plan

**Sections:** §10 lines 195–205; §11; P6/P7.

The plan pins Core/Assembly 0.5.0, but omits resources/conformance pins and the host/module peer rule. It then adds observation “when ready” without saying that the inspected candidate belongs to another coordinated train. The retained research records 0.5/0.5/resources 0.1/conformance 0.3 for published static composition, versus candidate 0.6/0.6/resources 0.2/conformance 0.4/observation 0.1. Adding observation to a module with an ordinary nested resources dependency can install two physical resource copies. This is a functional issue: published `scoped()` identifies scopes through a package-local WeakMap and rejects scopes from another installed copy.

**Smallest change:** add a two-row compatibility/adoption record. Initial static GM integration uses the exact published train; GM packages are host-owned peer dependencies constrained to one 0.x minor, with exact dev/test pins. Future observation adoption is a fresh exact-release/registry/peer-identity gate for its coordinated train, including prerequisite #197. Do not assert that those candidate versions are already released or that the upgrade can be made automatically. Plain consumers install no GM integration package.

**Acceptance:** packed modular consumer resolves one physical copy of resources and exercises a host-created scope through the module's actual `scoped` factory; two concurrent runs have different declared account/environment inputs and closing one leaves the other live. Test the actual module package, not merely upstream's own examples. After upstream admission, repeat these checks against the new train and add the pending observation-specific catch-up/supersession/drain tests. Evidence: `research/get-modular.md` §§2.2–2.3, 6.1, 8; published resources README lines 23–24 and `dist/features/scope/scope.js` identity guard. No upstream ADR changes are required.

### 6. P2 — The support matrix and stage exits omit distribution/typecheck conditions that can invalidate otherwise passing source tests

**Sections:** §11 lines 227–231, §12 P1/P3/P6/P7.

The plan gives Node 24.21.0/26.11.1 qualification targets while citing a wider published GM engine range; it never states whether payment support starts at those targets or inherits GM's lower floors. It does not choose a PostgreSQL qualification target or explicitly state ESM distribution. “Strict typecheck” and “packed imports/types” also do not require NodeNext **and** Bundler consumers, `skipLibCheck:false`, or strict ownership of tests/tools. A package can pass its workspace aliases and one resolver while its packed `.d.ts` reference an unavailable peer or an undeclared subpath.

**Smallest change:** choose a compact matrix: explicit supported Node range with tested floor/current targets, at least one named PostgreSQL major, ESM JS plus declarations, and two strict packed consumer projects using NodeNext/Bundler with `skipLibCheck:false`. Preserve exact TS7.0.2+ for every executed compiler/parser/oracle; new `.ts` tests/tools participate in a required strict project. The Foundation preset and installed gates should execute on the real governed universe, with negative dependency mutations, as already intended. Do not infer qualification of v3 root authority or old compiler-bearing tools from strict typecheck alone.

This is a specification gap rather than a request for broad OS/database/browser matrices. P7 should have named commands and observable pass conditions before implementation begins; it need not contain scripts now.

## Residual release gates and non-findings

The smallest useful remaining gates are:

| Gate | Required observation |
| --- | --- |
| Persistence/repair | Real PostgreSQL rollback, concurrent CAS/locking, disappeared jobs for all work classes, restart from persisted state |
| Host lifecycle | Bootstrap separate from runtime start, borrowed pool survives sibling close, partial-start cleanup, unresolved physical work reported |
| Packed distribution | Plain consumer without GM/provider/SQL packages; modular consumer with one peer identity; both TS resolver modes |
| Monetary delivery | One business grant across duplicate sources, new evidence revision delivered after previous acknowledgment, correct adverse correction/review |
| Pending observation | Fresh upstream acceptance/publication evidence, coordinated peer train, catch-up/supersession/cleanup tests; money remains correct with observation disabled |

These are proposed acceptance conditions. None ran during this review. No new ADR, universal lifecycle interface, generic hook registry, broker, second provider, or second queue engine is needed to address them. Four distribution packages, an opt-in FMS profile, and the exact breadth of a future PostgreSQL matrix are preferences unless they break the stated dependency or support contract. Existing Platform ownership remains unchanged.
