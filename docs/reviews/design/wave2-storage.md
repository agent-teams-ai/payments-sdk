# Wave 2 — storage, concurrency and recovery review

Reviewed immutable `wave2-plan.md`, SHA-256 `28aebbb5b0c24231f2002e7aa2fb081d60e29cd98fe7a84e0173d55ab723a85a`. Read the complete supplied handoff, Q 1.1.2, `research/reliability.md` and `research/reuse.md`. Inspected the retained **published pg-boss 12.38.0** implementation, particularly `dist/index.js`, `manager.js`, `plans.js`, `db.js`, `timekeeper.js`, `boss.js` and configuration defaults. No peer reviews or journal were read. Research only; no implementation, database, account action or payment test was performed.

## Result

No P0 found. Two P1 recovery gaps and one P2 deployment-contract gap remain. The selected ordinary `work` mode, borrowed Host pool, explicit bootstrap and payment-owned repair obligations are defensible. I do not ask to replace them with transactional handlers or another queue engine. The findings below concern missing transitions/ownership contracts, not a demand that research already pass implementation qualification.

## P1-1 — An acknowledged pending consumer decision has no legal completion path

**Location:** §5 T3, especially plan lines 172–176; §6 pending-policy behavior; §7 correction policy; §12 end-to-end recovery criteria.

T3 allows a product effect only when a **strictly newer producer evidence revision** is accepted. The consumer atomically commits its receipt, evidence revision and effect **or pending state**, and then acknowledges. Elsewhere the plan intentionally allows `pending_policy` when late-payment, adjustment or period mapping cannot yet support an automated decision. These rules make transport adoption safe but leave pending business work stranded.

**Failure trace:** A completed renewal is delivered as revision 7. The consumer verifies it, finds that its original period has ended and records `pending_policy`, receipt and revision 7 together. It acknowledges, so payment delivery is complete. The product owner subsequently approves the required late-payment policy, or an operator resolves the existing mapping. Paddle has no new evidence to send. Replaying revision 7 is an equal-revision duplicate and, under T3's literal rule, cannot cause a grant. A policy update must not fabricate a new paid fact, change the immutable message, change its ID, or add `policyVersion` to the grant key. None of the payment-owned repair categories finds this work because the delivery was correctly acknowledged.

**Effect:** A legitimate paid benefit remains withheld indefinitely, even after its stated blocker is resolved. Implementers must either violate the documented monotonic protocol or invent an unplanned recovery mechanism. The same issue affects deferred corrections, not only first issuance.

**Minimal correction:** Distinguish adopting producer evidence from executing a consumer-owned obligation. Acceptance of a newer revision may create/update a durable local fulfillment/correction obligation, including its current evidence revision, benefit basis, blocker and selected policy metadata. The consumer's explicit resolve/redrive use case may later finish that obligation against the **currently stored evidence**, using a local revision/CAS and the existing unique effect key. Transport duplicate handling still produces no effects. If producer evidence advances while redrive is prepared, redrive must reload/reduce before committing. Keep this within the consumer fixture/protocol; it needs neither a shared transaction nor another general workflow platform.

**Acceptance:** Deliver revision 7, persist pending state, acknowledge, delete the sender job, restart both sides, resolve the policy, and complete exactly one intended effect without another provider event or changed message ID. Race the resolution with revision 8 containing an approved refund: the stale prepared grant must not commit. Repeated resolve/redrive must preserve one effect and its audit history.

## P1-2 — A terminal adverse-input failure can leave consumers permanently on paid-only evidence

**Location:** §5 T1/T2 and storage protocol, lines 139, 145, 155–159; §7 admitted-refund guarantee; §9 permanent decoding/conflict faults, line 222.

T1 records a pending adverse marker and bumps the transaction aggregate revision. Consumer messages and delivery targets are created only by successful T2. Permanent decoding/conflict/configuration faults can instead enter durable review and stop retrying. The plan does not require that this terminal path publish the aggregate's new pending/conflict state. A local barrier prevents a newly prepared positive T2 from ignoring the input, but it cannot invalidate an older immutable message already in the outbox or at the consumer.

**Failure trace:** Paid-only evidence revision 3 commits and awaits delivery. An authenticated adjustment is then admitted with a valid minimum transaction reference; T1 records its barrier. Its business normalization encounters an unsupported action/shape, or known-field conflict, and the job is quarantined for resolution. No T2 succeeds, so no revision 4/delivery exists. Revision 3 reaches the consumer and is accepted. The adjustment can remain visible to payment operators forever while Commercial Access/credit consumers continue to see a clean paid snapshot. Replaying revision 3 or repairing its queue job cannot convey the known problem.

This trace is within the plan's acknowledged T1-between-T2-and-T3 window. The plan correctly permits eventual correction for that window; the missing terminal transition prevents even the pending/hold evidence from arriving eventually. The issue does not require parsing a refund successfully or deciding how many AI credits to revoke.

**Effect:** An adverse fact that is already in durable custody is operationally disconnected from the consumers who must decide whether to hold/correct their effects. An unknown or conflicted adjustment can silently look like absence of adjustments outside the payment context.

**Minimal correction:** For a known affected aggregate, make transition into pending/review/conflict a consumer-visible evidence change with durable publication obligation. Either admission publishes the pending snapshot atomically, or a small failure/quarantine commit publishes it independently of successful business normalization. The latter must retain the pending marker, the problem/source references and the last trusted monetary facts, append an immutable evidence revision and create delivery targets together. A decoded refund is still required for a definitive refund fact; a hold flag is not fabricated settlement. Later resolution emits another revision. Define what happens when the affected aggregate cannot yet be identified; do not claim that case has already been routed.

**Acceptance:** Commit revision 3, admit an adjustment with a valid transaction reference but unsupported business content, force permanent decoding failure and terminal queue state, then deliver revision 3. Without editing SQL or inventing a provider event, both required consumers must eventually receive a newer pending/review snapshot. Restart and delete the quarantine job: its publication obligation must remain recoverable. Resolving the decoder/mapping must publish a further revision without removing the original evidence or double-applying a correction.

## P2-1 — Shared-pool sibling scopes lack a defined store and queue ownership topology

**Location:** scope contract in §3; global event key in §5 line 137; foreign-scope handling in §8; reference deployment/shutdown in §9 lines 224–226; sibling-scope gate in §12.

The plan promises independent runtime scopes using a borrowed pool, but does not specify whether their payment tables and pg-boss schema/queue names are separate, or whether one runtime owns the shared account-wide store and dispatches every scope. This distinction changes correctness. A scoped `executeSql` wrapper provides pool ownership/lifetime isolation; it does not automatically filter queue claims by `PaymentScope`.

In exact 12.38.0, `Manager.work(name, ...)` builds its fetch from the **queue name** (`dist/manager.js`, approximately lines 1160–1215); ordinary callbacks have automatic completion. Queue operations use the configured pg-boss schema. The public [worker contract](https://pgboss.io/api/workers) likewise registers workers by queue name. Payload fields are not a worker-routing predicate.

**Failure trace A:** Independently configured production and sandbox runtimes share a boss schema and default queue name. Either worker can claim the other's job. A core scope check can prevent a wrong financial commit, but it cannot route that job to the correct SDK/configuration. Returning a foreign/unsupported result completes it; throwing consumes attempts and repair can repeatedly assign it to the wrong runtime.

**Failure trace B:** Applications A and B share payment tables for the same merchant account. Their ingress key omits application by design. A receives B's event first and marks it foreign/processed. B then admits the same event ID, sees the existing processed record and has no independent obligation. The correct binding is never processed unless the shared owner has a defined routing state beyond this one processed bit.

**Effect:** The two-scope lifecycle example can appear isolated while work is consumed by the wrong owner or suppressed by cross-scope deduplication. This is a conditional deployment defect, not a claim that sharing the physical PostgreSQL pool is inherently unsafe.

**Minimal correction:** Select a v1 topology explicitly. The smallest option is separate configured payment-store and boss namespaces for independently configured runtimes, even when they borrow one pool; queue/schedule identities must include that stable runtime/store namespace. Alternatively, specify one account-wide store owner with durable application routing and workers capable of selecting the correct configured adapter. Do not leave both models implicit, and do not add `applicationId` indiscriminately to the financial fact key to conceal shared ownership. Define a stable producer namespace across restarts and reject conflicting runtime registrations for the chosen store/queue identity.

**Acceptance:** Run two differently configured scopes against one Host pool. Interleave identical merchant event IDs for different owning applications and jobs for different account/environments. Each obligation reaches exactly its configured owner; foreign admission cannot mark the correct owner's work complete. Stop one scope, restart it and repair its jobs while the sibling continues. Neither sibling's claims, schedules, pool nor dedup state may be disabled accidentally.

## Qualification notes, not additional findings

The exact source confirms same-client enqueue through `send(...,{db})`; [pg-boss's adapter contract](https://pgboss.io/api/adapters) documents its rollback behavior. Ordinary `work` then completing after an idempotent domain commit is a valid replay design. The plan already excludes `transactional:true`, so the absent `beginTransaction` capability is not a defect.

The common aggregate row plus expected revisions can enforce the adverse-input barrier under READ COMMITTED. Qualification must apply one lock order across admission batches, reduction, bindings and repair, not only within a single T2 helper, and retry only the local SQL closure after a deadlock. The plan's “single order” requirement is enough architectural direction; I do not request a new lock manager. PostgreSQL's [locking documentation](https://www.postgresql.org/docs/18/explicit-locking.html) explains both consistent ordering and deadlock aborts.

DDL-free runtime grants need the named real-package gate. Source-specific checks should include scheduler startup's `manager.createQueue('__pgboss__send-it')`, precreated internal queue access, and supervisor reindex behavior (`reindex` defaults true, with index ownership filtering). These are configuration/grant qualifications, not proof that the plan needs migration privileges at runtime. Explicit `reindex:false` is a useful way to make the intended maintenance ownership unambiguous.

The shutdown contract correctly distinguishes boss timeout from physical SDK/handler drain and keeps the borrowed pool available to late producers. Domain attempt fencing must remain separate from queue retry counts; the existing crash, expired lease, stale response and failed-startup gates already target that risk. No additional architecture finding is warranted merely because those gates have not yet run.
