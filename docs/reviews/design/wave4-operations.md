# Fourth-wave independent review — SQL, storage and operations

**Verdict:** no new P0, P1 or P2 design defect established in this lens. The reviewed R3 is suitable to proceed to the specified implementation and qualification stages. This is an architecture verdict, not evidence that its SQL, timeout wrapper, recovery procedures or payment integration have passed those stages.

## Inputs and independence

Reviewed the complete handoff `upload/Вставленный текст(2).txt`, complete Q 1.1.2 at `research/sources/q/SKILL-v1.1.2.md`, and complete immutable `research/reviews/wave4-plan.md` (421 lines). Independently calculated the plan SHA-256:

`1cc43a1e8ed904e3f7dc1d85a496ff7769656173172be3a5bda5a5d4748713f9`

It matches the assigned input. I also inspected the relevant retained `research/reuse.md`, `research/reliability.md`, `research/source-audit.md` and exact published source under `research/sources/reuse/pg-boss/package/dist/` and `research/sources/reuse/pg/package/lib/`. No peer review or review journal was read. No tests, databases, payment accounts or repository operations were executed; the only authored artifact is this review.

Q is applied as contract and ownership analysis: a replacement storage adapter must preserve durability, atomicity, uncertainty and replay behavior. A class count, another store, shared cross-owner SQL or a new coordination service would not demonstrate those properties.

## Severity disposition

| Severity | New findings | Disposition |
| --- | --- | --- |
| P0 | 0 | No demonstrated path in the specified protocol to an automatically repeated external monetary mutation or unguarded duplicate fulfillment |
| P1 | 0 | The potentially material durability, restore, queue and deadline conditions are explicit requirements with matching qualification cases |
| P2 | 0 | No independently actionable correction established; implementation detail or unexecuted gates are not relabeled as design contradictions |

Consequently there is no proposed normative plan correction. The traces below explain why the main candidate hazards are already addressed and identify the existing future verification that must establish each claim.

## 1. Durable dispatch markers and lossy failover

**Candidate failure trace.** A worker commits `dispatch_started`, Paddle executes create, and the acknowledged local marker is lost after crash or replica promotion. A restarted worker sees `prepared` and creates again. Logging an intent alone does not prevent this; neither does a lease.

**Why this is not open.** Section 9, lines 252–258, makes durable commit a storage-port guarantee for both owners, requires logged crash-safe correctness records, durable WAL, fsync and explicit transaction-level `synchronous_commit=on` despite weaker inherited settings. It separately states that local WAL durability does not establish replica-promotion RPO0. The minimum supported deployment has one durable primary and no automatic lossy failover. Possible WAL loss prevents ordinary repair from authorizing monetary dispatch. Section 4 also requires confirmed marker commit before invocation; ambiguous commit never supplies a dispatch permit.

**Minimal correction:** none. Merely adding another table or replication framework would not close a missing durability precondition; here the precondition is already stated honestly.

**Future verification:** P3 and section 12 explicitly require weak inherited synchronous-commit coverage, crash after marker, and either qualification of the actual HA promotion path or a runbook prohibiting automatic lossy promotion. These are release requirements, not accomplishments of this review.

## 2. Independent restore and acknowledged-message recovery

**Candidate failure trace.** Restore only the payment owner below producer revision 10 while a consumer retains revision 10, or restore only the consumer after the sender has acknowledged every delivery. In the first direction, reusing old revision/message identities with new bodies corrupts history. In the second, ordinary undelivered-outbox repair finds no work and cannot rebuild the restored consumer. Restoring through a dispatch interval additionally resurrects commands whose provider outcome is unknown.

**Why this is not open.** The plan defines complete owner recovery units rather than queue-only backups. Independent restore/PITR is an explicit administrative recovery mode with a deployment fence before ordinary dispatch, fulfillment and publication. It does not pretend the restored database can reliably detect its own rollback. Restore horizon and uncertain interval are recorded; reverted dispatch markers remain potentially executed. Public checkpoints/exports reconcile exact producer revisions and message identities with every required consumer. Exact history that cannot be recovered remains held. A restored consumer explicitly opens backfill of previously acknowledged deliveries with original message/effect identities. External effects surviving consumer rollback require that consumer's own reconciliation or durable idempotency.

The fence must actually cover the affected fulfillment and publication paths, including already admitted work; that is the stated deployment requirement, not a new distributed-coordinator requirement. An operator can satisfy the initial profile with a controlled recovery procedure.

**Minimal correction:** none. The plan already forbids the tempting substitutes: new namespaces, reset revisions, new-consumer registration and receipt deletion.

**Future verification:** the producer-only/consumer-only/dispatch-interval restore cases are explicitly required in section 12, line 347. The resume gate must demonstrate checkpoint agreement and backfill before lifting the fence. Insufficient archives/provider history legitimately prevent automatic resume.

## 3. Absolute database deadlines and unknown COMMIT

**Candidate failure trace.** Server-side statement timeout succeeds, but the response is blackholed. The HTTP request waits beyond Paddle's acknowledgement window, or an application timeout returns a checked-out client to the pool while its transaction remains uncertain. Another command could then run on that connection. A lost COMMIT reply can also be misreported as rollback.

**Why this is not open.** Section 9, lines 248–250, requires one absolute client budget spanning acquisition, queries, COMMIT and cleanup, with reserved cleanup time. It specifically rejects restarting the budget per statement and rejects a naked `Promise.race` as cleanup. An uncertain client is discarded, not recycled. Lost COMMIT response means unknown commit; repeat admission checks durable custody, and dispatch requires an acknowledged marker. The same bounded client-wait discipline covers pg-boss polling, settlement and maintenance through the scoped wrapper.

This precision matters with the inspected `pg@8.23.1` implementation: `lib/client.js` implements query-read timeout and suppresses a late query callback; that code alone is not proof of transaction rollback or safe connection reuse. R3 does not make that inference.

**Minimal correction:** none. Numerical SQL settings remain qualification targets rather than a hard-real-time claim about Node scheduling.

**Future verification:** held-row and post-BEGIN/post-COMMIT blackholes must produce bounded 5xx, discarded uncertain connections, no pool leak, safe duplicate admission and no unconfirmed dispatch. The plan already names the case where COMMIT really succeeded but its reply was lost.

## 4. Exact pg-boss lifecycle, completion and repair

The selected ordinary `work` profile is internally consistent. Same-client `send(...,{db:tx})` establishes atomic work admission; external I/O happens outside the short domain transaction; pg-boss owns queue completion after callback return. Crash after domain commit and before queue settlement replays an idempotent domain operation. Domain attempt tokens remain separate from queue retry counts. R3 explicitly excludes `transactional:true`, avoiding the unsupported inference that `executeSql` alone implements `beginTransaction`.

The inspected `dist/index.js` start path invokes `timekeeper.start()` when scheduling is enabled. `dist/timekeeper.js` creates its internal `__pgboss__send-it` queue through `manager.createQueue()`. Therefore `migrate:false` by itself does not prove DDL-free startup. R3 already addresses this exact seam: bootstrap precreates internal scheduler queues, disables automatic reindex, and requires qualification of the real DDL-free runtime grants. It does not claim two flags establish the permission profile.

The inspected stop path and manager cleanup can outlive a nominal grace interval; stopped queue ownership is not cancellation of an SDK promise. R3 retains explicit Host tracking of live handlers/promises and unresolved debt, keeps the borrowed pool available until dependent scopes finish, and forbids an adapter from ending the Host pool.

Finally, queue deletion/expiry cannot erase the work obligation. Payment-owned records cover inbox, prepared commands, unknown-resolution reads, scan checkpoints, evidence deliveries and quarantine-publication duties. Bounded repair restores missing/terminal work or persists review with cooldown. Repair never converts unknown into a new monetary send.

**Minimal correction:** none. **Future verification:** the existing missing-job, failed-startup, DDL-free grants, held-SDK shutdown and bounded poll/settlement cases exercise the actual remaining risks.

## 5. Multiple scopes and consumer decision concurrency

Sharing a borrowed pool is not a queue-routing mechanism. R3 assigns each independent application/account/environment runtime its own stable payment-store/pg-boss schema pair. Same-scope replicas intentionally compete; different scopes do not share processed bits, queues or schedules. Namespace metadata binds the precise scope, and payload identities are checked before effects. No automatic second authoritative namespace is permitted as a reinstall shortcut. This resolves the candidate trace where scope A claims and completes B's job without performing B's work.

On the consumer side, monotone per-source ingestion is supplemented by a stable benefit/commercial decision lock or full expected-read-set validation. Payment feed, subscription feed and operator resolution therefore cannot independently commit decisions calculated from mutually stale contributions. Acknowledgement persists custody plus effect-or-pending obligation. Resolving held policy after restart requires neither a new producer revision nor receipt deletion. These are the necessary ownership boundaries; a shared payment/consumer SQL transaction would violate the accepted Platform boundary and is unnecessary.

The existing P3/P5/P6 tests must verify sibling-scope isolation, borrowed-pool lifetime, concurrent source updates and operator resolution. This review does not substitute source inspection for those tests.

## Conclusion

No new actionable defect was established. The operational guarantees now have explicit preconditions and conservative uncertainty handling, with concrete qualification cases for the failure traces above. Proceed with the selected single-primary PostgreSQL 18 and ordinary pg-boss worker profile. Preserve the documented recovery fence, stable identities, absolute client deadlines, owner-specific atomic boundaries and independent durable obligations during implementation. Broader HA, additional stores, alternate worker modes and cross-owner transactions are not needed to make this v1 plan coherent.
