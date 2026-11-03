# Operations and recovery runbook

This runbook addresses the supported single durable PostgreSQL primary profile. It does not claim a qualified lossy failover, physical PITR exercise or live Paddle collection. The [qualification matrix](qualification.md) separates local evidence from deployment gates.

## Deployment and startup

1. Provision stable trusted scope, producer namespace and the separate payment/job schema pair. Store credentials separately. Back up the payment owner's entire correctness unit and each consumer's complete correctness unit.
2. Apply `migratePaymentSchema` and the explicitly selected `createPgBossPaymentTransport(namespace).bootstrap()` under a migration role. Provision the [qualified runtime grants](../packages/payments-postgres/README.md#runtime-role) afterwards. Construct a separate runtime transport with runtime credentials and supply it to the worker; do not use migration credentials in ordinary workers.
3. Start with `fsync=on`, logged tables and durable WAL. The adapters set `synchronous_commit=on` for correctness transactions even if inherited session configuration is weaker. One local durable commit is not proof of RPO0 replica promotion.
4. Supply a qualified `PaymentPostgresDatabase`, such as `createNodePostgresPaymentDatabase(pool)` from `/node-postgres` wrapping the host-owned pool, then create the provider, store and core. Select the queue transport explicitly (`/pg-boss` requires its optional peer), register stable required consumers, and start the worker with explicit handlers and error/warning reporting. Start HTTP/command admission only after dependencies qualify.
5. If startup partially fails, stop the worker/core, await real handler and external-call settlement, and release only host-owned resources. The adapter never ends the shared pool.

The [durable example](../examples/paddle-postgres.ts) separates bootstrap from runtime and leaves authentication/consumer policy explicit. The [PostgreSQL package guide](../packages/payments-postgres/README.md) is authoritative for queue names, grants, exact SQL budgets and pg-boss flags. The default PostgreSQL18 budgets bound acquisition, lock, statement, transaction and total connection ownership. Set host ingress/body-read limits with headroom for signature verification and durable admission.

Replicas sharing one scope intentionally compete on one namespace and use bounded claims/CAS/read sets. Independent scopes use separate stable schema pairs even on one borrowed pool. Do not create a fresh namespace or producer ID to make a conflicting deployment start; investigate its owner binding.

## Monitor and repair ordinary failures

Monitor oldest pending inbox, publication/delivery lag by consumer, oldest unknown operation, unresolved bindings, quarantined obligations, conflicting/held evidence, reconciliation gaps and worker/SDK lifecycle debt. Distinguish durable custody from an applied product effect. Keep keys, webhook secrets, portal URLs and raw personal payloads out of normal logs; protect retained diagnostic evidence.

Payment-owned obligations remain authoritative after queue retention/cleanup. The pg-boss transport is disposable. One bounded startup pass and the persisted periodic repair schedule recreate missing/terminal work from those obligations. `jobs.repair(limit)` requests another bounded pass. Queue deletion does not authorize recreating a financial mutation whose dispatch marker already exists.

Persistent faults become visible quarantine with bounded cooldown/attempts. After fixing a fault, use `jobs.redrive(workIdentity, auditRef)` to reopen its unfinished local obligation. This changes neither the operation nor its mutation authorization. Unknown operations require read-only inspection or the core's audited resolution. Missing handlers are a configuration failure, not an instruction to auto-dispatch.

Delivery backfill and ACK share the delivery lock, so backfill cannot reopen a
concurrently acknowledged target. If an older version left pending work for an
already acknowledged delivery, the worker validates its retained message and
replays the producer ACK to complete that obligation without calling the consumer
again. A duplicate ACK checks the saved body digest and reasserts completion.
Workers do not automatically claim quarantined obligations; use the audited
redrive procedure above to resume that worker path.

| Incident | Response |
| --- | --- |
| Webhook body/signature invalid | Reject before trusted admission; inspect endpoint configuration without logging secrets |
| T1 SQL deadline/lost COMMIT reply | Return bounded 5xx; let the connection be discarded when state is uncertain; replay checks durable custody |
| SDK mutation deadline/error | Preserve unknown and attempt history; inspect provider evidence; never assume a failed response means no effect |
| Duplicate payment or initial streams | Retain every financial fact; use authorized stream/consumer decision resolution and explicit duplicate/refund policy |
| Held evidence/consumer decision | Inspect reason and complete read set; redrive through its owning capability after fixing policy/binding, without deleting receipts |
| Missing queue jobs | Repair from owner obligations, retaining original logical/message identities |
| Consumer outage | Keep its target pending; other consumers can progress independently |
| Possible owner database rollback/WAL loss | Apply the external fence and follow the restore procedure below before ordinary startup |

## Reconcile provider evidence

Use `createPaymentReconciler` with `createPaddleReconciliationSource(provider)` and the same payment store/scope. Persist a fixed scan query, epoch and application-owned `after` cursor; `beginScan` saves that scan before acquisition and each `resumeScan` commits a returned page's inputs and checkpoint together. The [integration scenarios](../tests/integration/reconciliation.test.ts) show the actual public protocol.

Run overlapping fixed exclusive event windows, required event-type scans and wider retention sweeps. Supplement events with transaction/subscription refresh and adjustment scans for relevant completed transactions. An exhausted current query is not proof of complete historical coverage. Keep coverage/gap status independently from one successful page.

A mapped page failure, invalid/nonprogressing ID, or empty nonterminal page must not advance the checkpoint. Each retry creates a fresh public SDK collection from the last durable cursor; its discarded internal cursor may already have moved before mapping failed. Preserve the failure/query/SDK profile and gap. Unsupported observations are retained rather than skipped as if absent.

Paddle's retained event history and SDK mapping constrain recovery. A poison member that the SDK cannot return remains a gap requiring an SDK change or explicit manual acquisition/resolution. Entity refresh is not proof of every historical adjustment. Read the [Paddle reconciliation limits](../packages/payments-paddle/README.md#webhook-custody-and-decoding) before declaring a catch-up complete. Do not use private SDK fields, intercept production global fetch or silently substitute a raw HTTP client.

## Graceful shutdown and concurrency debt

First stop host HTTP ingress and producers of new commands. Stop core command admission with `payments.stop()`, then `await jobs.stop(budgetMs)`. The returned report distinguishes transport stop, admitted handlers, pending core work and physically unresolved SDK calls. A stop deadline does not cancel an SDK request.

Await `jobs.drain()` and `payments.drain()` for actual settlement before disposing dependencies. Close a shared pool only after all dependent siblings finish. If an external promise remains alive, retain the pool/provider resources and report debt; process termination is an operational decision, leaving durable unknown recovery obligations. Never equate `Promise.race`, an abort notification or an expired lease with physical cancellation.

For Get Modular, close dependent observation/attempt scopes through host-owned `Scope.control`, including after failed/cancelled run. Retain the original patient close promise and inspect `complete`/`settled` and unresolved debt. A bounded `close({ abandon })` snapshot ends only caller waiting; keep the runtime and pool alive until the patient close completes. A parent continues after failed child cleanup, so LIFO alone does not establish this dependency gate. Register workers after the dependent payment module so reverse cleanup stops worker admission first. The [integration lifecycle guide](../packages/payments-get-modular/README.md#ownership-cancellation-and-shutdown) describes the actual published resource semantics.

## Independent restore, PITR or possible WAL loss

Apply a fence **outside the database being restored**, before restoring or promoting and before normal runtime startup. Disable payment dispatch, fulfillment and outward publication across every replica/worker; retain concrete deployment/fence references across restarts. A flag in the rolled-back database cannot prove a later dispatch marker was lost. All restored prepared operations are potentially executed, regardless of intent creation time.

Follow the authoritative [administrative restore and recovery procedure](recovery.md). It documents the actual public `createPostgresPaymentRecovery` API, current-revision/audit checks, original immutable message export and consumer checkpoint manifests, uncertainty scans, restored-consumer backfill, archive-import check restart, guarded resume and per-lane review release. Obtain checkpoints through consumer-owned public exports; payment-owner code must not read their SQL.

Preserve scope, producer namespace, original message bodies/revisions, consumer identities and effect keys. Independent consumer restore also requires owner-led reconciliation of effects that survived outside its database. Changing namespace, deleting receipts, creating new consumer IDs or manufacturing old evidence bodies cannot repair lost history. Missing or mismatched history blocks resume, and the external fence stays in place until the host verifies all owner recovery results.

The recovery suite uses logical restored-state fixtures against real PostgreSQL. Physical backup/WAL/PITR and a claimed RPO0 promotion require separate [deployment qualification](qualification.md#deployment-and-credential-gates). Ordinary queue repair is never authority to resume after possible WAL loss.
