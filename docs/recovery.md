# Administrative restore and recovery

The PostgreSQL adapter exposes `createPostgresPaymentRecovery` as a trusted owner administration capability. It coordinates bounded checks **inside one payment owner**. The Host remains responsible for backups, restoring each owner's complete correctness unit, externally fencing the deployment, collecting consumer exports, reviewing external effects, and deciding when to restart normal work. This capability is not a distributed coordinator, automatic failover mechanism, or backup tool.

## Deployment contract

Before restoring any payment or consumer database, the Host must stop new commands, payment dispatch, fulfillment and external publication at the deployment boundary. Stop claims and producers, drain outstanding handlers and consumer acknowledgements, and retain the external fence across process restarts. Apply this fence **before restore and before starting any normal runtime**. A restored database cannot prove that a later dispatch marker or acknowledgement was lost. The SDK cannot infer rollback solely from its own restored rows.

The supported minimum deployment uses one durable PostgreSQL 18 primary, logged correctness tables, durable WAL, `fsync=on` and critical transactions with `synchronous_commit=on`. Automatic lossy promotion is prohibited. A high availability deployment needs separate qualification of its actual RPO0 promotion path, including every acknowledged correctness commit; setting local `synchronous_commit` alone does not qualify that path.

Record a stable incident/session ID, external fence reference and application time, restore horizon, and uncertain interval. Retain the same payment schema, original producer namespace, consumer identities and deduplication history. A new namespace or consumer ID does not repair lost history. Creating fresh receipt tables or deleting receipts is not a recovery procedure.

The payment backup unit includes intents, operations and attempts, bindings and lanes, inbox and deduplication records, facts, exact-version evidence, immutable evidence messages and revisions, delivery checkpoints, administrative recovery state and durable obligations. A consumer's unit includes its receipts, source/contribution state, decisions, effects and outbox. Disposable queue rows cannot substitute for either correctness unit.

## Public administrative surface

Import recovery capabilities from `@agent-teams/payments-postgres`. Keep the resulting object outside buyer-facing HTTP services. Supply the same qualified `PaymentPostgresDatabase` capability used by the payment store. Recovery uses short durable transactions, the configured SQL deadlines, the existing payment scope ownership check, and no cross-owner SQL. For a host-owned node-postgres pool, construct the capability through the explicit driver entrypoint:

```ts
import { createPostgresPaymentRecovery } from '@agent-teams/payments-postgres';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';

const database = createNodePostgresPaymentDatabase(pool);
const recovery = await createPostgresPaymentRecovery({
  database,
  schema: 'payments_application_a',
  scope,
  producerNamespace: 'original-deployment-namespace',
});

let session = await recovery.begin({
  sessionId: 'incident-2026-001',
  externalFence: {
    deploymentRef: 'application-a-production',
    fenceRef: 'operations-incident/2026-001/stop-and-drain',
    appliedAt: '2026-10-19T10:00:00Z',
  },
  restore: {
    horizon: '2026-10-19T09:45:00Z',
    uncertainFrom: '2026-10-19T09:45:00Z',
    uncertainThrough: '2026-10-19T10:00:00Z',
    reason: 'Owner restored to the reviewed backup horizon',
  },
  restoredConsumerIds: ['credit'],
  audit: { actorId: 'operator-42', auditRef: 'incident/2026-001', reason: 'Begin owner reconciliation under the external fence' },
});
```

`begin` installs the durable owner fence and captures every currently registered consumer as required. It rejects another active session, reused session IDs, an unknown restored consumer, and a conflicting registered producer namespace. The external references document actions the Host actually performed; they are not an automated check that the deployment is stopped.

Every session mutation requires its current `revision` and an actor, audit reference and reason. Stale revisions throw `PaymentRecoveryConflictError`, roll back the whole change, and do not append an audit or advance a cursor. `read(sessionId)` resumes administration after restart. `readAudits(sessionId, afterRevision, limit)` exports the immutable per-revision audit trail, including the resulting cursor states and session digest, in bounded pages. Page limits are integers from 1 through 100. Transaction deadlines still apply; a page count does not promise a fixed wall-clock completion time.

The ordinary `setRecoveryFence(false)` operation cannot bypass an active session's resume gate. Normal admission, provider dispatch, T2 publication/reduction, delivery reads and delivery acknowledgements remain fenced. Read-only inspection, T1 custody, and append-only late attempt observations remain available. Keep the Host's external fence until all owners have completed their recovery protocol; clearing this local fence does not reopen the deployment boundary automatically.

## Check original immutable history

1. Restore all available payment-owned immutable history and corresponding aggregate counters from the qualified backup/WAL/archive. Provider evidence can help establish an outcome, but cannot recreate every original identity and historical body by assumption. Do not overwrite a historical message with a newly generated body.
2. Use `exportCheckpoints({limit: 100, after?})` to export original `messageId`, aggregate, revision and `bodyDigest` checkpoints. Pages are ordered by message ID; pass the returned `after` until `complete` is true. An exactly full last page requires a final empty page. `readEvidence(messageId)` exports one original body with a 2 MiB bound and checks its stable identity, scope, namespace and digest. Secure retained exports as correctness archives.
3. Run `scanProducerHistory(sessionId, revision, limit, audit)` until `producerScan.status` is `complete`. The scan checks every restored immutable body and verifies that its owner aggregate counter has not regressed below that revision. A malformed message or regressed counter leaves the session blocked. It never publishes replacement history.
4. Ask **each required consumer owner** for a consistent immutable checkpoint export through that owner's public capability. The export must include all retained accepted/custodied producer message receipts relevant to the original namespace and scope, including older revisions, rather than only a latest-revision counter. The consumer owns the export's completeness and the review of external effects that survived its database restore. Do not inspect its tables from payment-owner production code.

Create a consumer manifest with the immutable export reference, its owner audit reference, the count and rolling checksum of all checkpoints, and the consumer's external effects review reference. Sort checkpoints strictly by message ID. Each checkpoint has the same four fields as the producer checkpoint export. Compute the checksum with `recoveryCheckpointDigest(orderedCheckpoints)`, or carry the checksum between export pages with `recoveryCheckpointDigest(nextPage, previousChecksum)`. The empty checksum is `recoveryCheckpointDigest([])`.

Register that manifest with `startConsumerVerification(sessionId, revision, consumerId, manifest, audit)`, then submit pages to `verifyConsumerPage`. Each page contains at most 100 checkpoints. A manifest becomes complete only when the exact declared count and checksum match. A missing producer message, different historical body, conflicting revision/aggregate, or regressed aggregate evidence counter leaves a durable blocked consumer status and issue. Resume is rejected. An explicitly empty consumer manifest still requires its owner/export/external-effects review references; absence of an export is not an empty manifest.

Failed pages do not advance the manifest cursor. After fixing an input error, resubmit that page. `startConsumerVerification` can replace an incorrect manifest under a new audited session revision, and restarts that consumer's verification. Record the owner rationale when changing a manifest; omitting evidence to make the gate pass is not a qualified recovery.

If additional payment archive data is imported after a check, call `restartChecks(sessionId, revision, audit)` before proceeding. It resets the producer and uncertainty scans, consumer verification, restored-consumer backfill cursors and archive review so that a previously completed scan cannot qualify newly restored rows. Physical database restore also requires the Host to reassert its external fence and reenter/reconcile the administrative session; the library cannot detect an externally rolled-back session from the restored database alone.

## Quarantine the dispatch uncertainty interval

Run `scanUncertainOperations(sessionId, revision, limit, audit)` until its cursor is complete. It scans **all operations**, without an intent `createdAt` filter. An old intent can have dispatched inside the lost-WAL interval. Every restored `prepared`, `dispatch_started` or `outcome_unknown` operation is potentially executed. The scan records it as `outcome_unknown` with an audited `keep_unknown` resolution, completes its prepared obligation, creates its unknown-resolution obligation, and pins its mutation lane with `recoveryReviewRequired=sessionId`.

This scan never calls a provider, creates a replacement attempt, or returns an operation to prepared. An unknown operation can remain held for manual review after the global local fence is cleared. Its lane continues to reject fresh commands and dispatch. Late terminal observations can settle an operation, but preserve the lane's recovery review hold. This matters when several restored operations share a subscription lane: one late result cannot release another uncertain command.

Resolve unknown outcomes using the existing owner/provider-evidence resolution workflow after global resume. A deliberate monetary retry remains a separate audited duplicate-risk decision; this restore protocol does not authorize it. When every operation in a lane is terminal, `releaseReviewedLane(sessionId, operationId, expectedLaneRevision, audit)` can remove the lane hold. It requires a resumed session and the current lane revision, locks the lane and subscription binding, and rejects release while any operation in that lane is prepared, dispatch started or unknown. Preserve the evidence and approval reference for that lane's review.

## Backfill a restored consumer

Declare restored consumers at `begin`; each must already be registered under its original identity. For each declared restored consumer, call `backfillRestoredConsumer(sessionId, revision, consumerId, limit, audit)` until its cursor is complete. The bounded operation walks original immutable messages and reopens their existing delivery rows, including previously acknowledged rows. It uses the exact original consumer ID and message ID, preserves delivery attempt history, and creates durable pending delivery obligations. It does not generate a new evidence revision, effect ID or receipt identity.

Normal delivery remains fenced while this runs. Late ordinary acknowledgements cannot re-acknowledge reopened rows under the fence. After resume, the normal delivery/repair path replays these original messages. The consumer's own idempotency and reconciliation contract must prevent duplicate effects, especially effects or external publication that survived its restore. Payment-owned backfill cannot guarantee consumer/external atomicity.

## Resume gate and manual limits

Record `reviewArchives(sessionId, revision, {auditRef, sources, limitations}, audit)` with concrete backup/WAL/archive/provider evidence references and an honest statement of coverage and limitations. A required nonempty limitations description makes the scope of the human review visible; it is not a Boolean claiming complete historical recovery. Record missing archives, unavailable historical provider data and unresolved operations explicitly.

`resume(sessionId, revision, audit)` clears the owner fence only if:

- the producer-history scan is complete;
- the uncertainty scan is complete;
- every originally required consumer manifest is complete;
- every restored-consumer backfill cursor is complete;
- an archive review exists; and
- the current registered consumer set exactly matches the captured required set.

An incomplete or blocked checkpoint cannot be waived through an archive-review text field. If exact previously accepted history is unavailable or mismatched, keep this owner fenced while recovering it or arranging a separately designed, audited affected-aggregate resolution. The v1 protocol does not fabricate missing historical messages. A provider's limited retention window, including a 90-day event history limit where applicable, is not an archive and does not promise full restoration of financial history.

Resume appends the audit atomically with the local fence change. Review its returned session and all consumer-owned recovery results before releasing the external deployment fence. Unknown operations and their pinned lanes remain held until their separate reviews finish. Read `PaymentRecoveryBlockedError.reasons` to identify unfinished gates; never loop on resume as a substitute for completing them.

## Qualification evidence and limits

`tests/integration/recovery.test.ts` runs against real PostgreSQL 18 with isolated payment and independent consumer schemas. Its **logical restore fixtures** cover producer-only rollback with an intact consumer at revision 10, missing/mutated immutable history and counter regression, consumer-only rollback with sender ACKs and original financial effect identities, restore through a prepared/dispatch gap including an old intent, lane hold preservation after late settlement, stale administrative CAS/audits, restart, and 205 records across 100-record pages. Provider-call counters prove the recovery path does not issue monetary mutations.

These tests do not perform a physical base backup, replay archived WAL, select a PITR target, validate backup completeness, or promote a replica. They do not qualify a concrete PITR or HA deployment. Operators must separately exercise their physical backup/WAL restore path under the same Host fencing contract and verify the full owner units and all acknowledged commits. No automated test uses live Paddle keys or makes charges.
