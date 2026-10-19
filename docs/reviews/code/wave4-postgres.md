# Wave 4 independent implementation review — PostgreSQL, durable reclassification and recovery

## Frozen subject and result

- Reviewed full commit: `fcd57f9ad4887338edab351cb1ef6457e97644a1`.
- Detached worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-postgres`.
- Runtime qualification: Linux Node `24.21.0` and `26.11.1`; real PostgreSQL `18.4` at the supplied disposable local endpoint; pinned `pg-boss 12.38.0`, TypeScript `7.0.2`, pnpm `11.25.0`.
- Result: **two actionable P2 findings**. No P0 or P1 established. The frozen candidate's existing PostgreSQL suite passes **31/31 on both exact Node floors**; the independent probes below expose additional contract failures on both floors.

No production source was edited, committed or pushed. Review-only strict TypeScript probes remain under the detached worktree's `review-probes/`. This report does not qualify subsequent changes; a final-SHA delta review must be recorded separately.

## 1. P2 — Ordinary renewal processing reopens unchanged quarantined reclassification work and erases its cooldown

### Location and mechanism

`packages/payments-postgres/src/store.ts:528` synchronizes an obligation for **every reclassification record present in the loaded working set**, even when its decision and cursor are unchanged. A normal renewal working set includes the originating subscription binding's existing reclassification record. `PaymentRecords.obligation` at `packages/payments-postgres/src/records.ts:75–79` unconditionally replaces an existing obligation's state with the requested state and reduces any pending `next_attempt_at` to the current time.

Consequently, an unrelated successful renewal T2 turns an unchanged reclassification obligation from `quarantined` to `pending`. If the obligation is merely cooling down, the same renewal makes it immediately due. This requires no `jobs.redrive`, no actor/audit record and no new classification decision.

The public operational contract says persistent faults retain logical cooldown/attempt state independently of job retention and become visible quarantine, with explicit audited redrive after repair. The reclassification documentation separately identifies a genuinely new decision as replacement work. Loading an existing unchanged cursor while processing another receipt is neither event.

### Independent reproduction and oracle

Probe: `review-probes/quarantine-reclassification.test.ts` in the review worktree, strictly compiled by `review-probes/tsconfig.json`.

The probe creates a real monthly checkout and completed initial transaction, accepts an audited stream selection to create an unfinished reclassification decision, bootstraps real pg-boss, and installs a deterministic failing reclassification handler. A real pg-boss claim/settle records the fault using configured `maxAttempts`. The probe stops and physically drains the workers before the ordinary renewal, so no concurrent claimant can explain the result. It then ingests and processes one legitimate new recurring transaction through the public runtime. The reclassification record is deep-equal before and after that receipt.

Two separate cases establish both aspects:

| Configured case | Persisted state before ordinary renewal | Persisted state after ordinary renewal |
| --- | --- | --- |
| `maxAttempts:1`, cooldown 30 seconds | `state:quarantined`, `attempts:1`, `issue:handler_failed`, `next_attempt_at` approximately now +30s | `state:pending`, same attempts/issue, deadline moved to now |
| `maxAttempts:2`, cooldown 30 seconds | `state:pending`, `attempts:1`, `issue:handler_failed`, `next_attempt_at` approximately now +30s | Same pending state/attempts/issue, deadline moved to now |

Representative Node24 cooldown output (PostgreSQL session renders its configured timezone):

```json
{
  "before":{"state":"pending","attempts":1,"issue":"handler_failed","nextAttemptAt":"2026-10-19 21:39:41.229181+01"},
  "after":{"state":"pending","attempts":1,"issue":"handler_failed","nextAttemptAt":"2026-10-19 21:39:11.273327+01"},
  "attempts":1,
  "errors":0
}
```

The independent oracles require the unchanged obligation to retain its state and its **exact** persisted deadline. Both cases fail on Node24.21.0 and Node26.11.1. The probe has no fixed sleep as its correctness oracle; polling only waits for the actual persisted fault disposition.

### Impact and narrow fix

Continuing legitimate receipts can repeatedly wake the same poison traversal despite the configured fault bound, defeat its backoff and repeatedly reopen a quarantine the operator has not reviewed. This can waste worker/database capacity and hide the intended stable quarantine state. It is **not** evidence of an automatically repeated provider mutation or a demonstrated double charge.

Treat the classification decision revision as the obligation generation. When an ordinary commit merely carries forward the same generation/cursor, preserve existing quarantine, attempts, issue and `next_attempt_at`; do not enqueue runnable work over an unchanged persisted deadline. A genuine new decision revision is new repair work and can explicitly reopen/reset the generation. A successful bounded page may reset the logical fault budget under the existing progress policy, retaining its intended cooldown. Ensure an older claimant's later settle cannot overwrite a newer decision generation.

Keep regressions for both unchanged quarantine and unchanged cooldown, plus genuine decision replacement and successful multi-page progress. The existing 205-history and one-fault-budget progress scenarios remain useful positive gates.

## 2. P2 — Historical adjustment reparenting does not fence the known original parent at T1

### Location and mechanism

`packages/payments-postgres/src/store.ts:260–265` derives T1 aggregate locks only from incoming input routes, an existing same-receipt route and existing same-event routes. It does not consult the durable exact-version adjustment certification for its retained original parent. The corresponding per-input affected set and adverse admission later in `admitInputs` likewise omit that original parent.

The new two-parent helper is used by `workingSet` for the contradictory receipt's **T2**, so processing that receipt eventually marks and publishes both parents. However, the original parent is already established by durable certification at successful T1. A T2 publication for that original parent, prepared before the contradictory T1 and committed after it, still passes its complete CAS and publishes an unheld complete snapshot. The successful T1 creates no original-parent pending marker, revision change or publication obligation to invalidate that stale reduction.

This violates the explicit T1-before-successful-T2 guarantee in `docs/architecture.md` and the accepted protocol at `docs/implementation-plan.md:174–176`: admitted adverse evidence changes the affected aggregate revision and durable publication obligation, invalidating a reducer prepared before its admission. It is distinct from the acknowledged cross-owner interval for inputs admitted **after** T2.

### Independent reproduction and oracle

Probe: `review-probes/historical-parent-t1.test.ts`, compiled by the same strict review project.

1. Create and complete two legitimate purchases A and B in separate subscription bases.
2. Process rejected refund adjustment `historical-adj` at exact version V1 under A, followed by a newer V2 under A. V1 remains in durable exact-version certification; V2 is the current adjustment watermark.
3. Load A's ordinary publication working set, replay its saved transaction observations using the public core reducer, and prepare its next full evidence revision.
4. Admit an authenticated receipt for the **same adjustment identity/V1**, now claiming parent B. T1 succeeds. Do not process the contradictory receipt's T2.
5. Commit the previously prepared A publication using its original complete expected read set.

Expected: `conflict`, because T1 knows A is an affected original parent and must invalidate its stale T2. Observed identically on both exact Node floors:

```json
{
  "result":{"kind":"committed"},
  "originalParentFlags":[],
  "originalParentPending":[],
  "produced":[{"revision":4,"kind":"complete","flags":[]}]
}
```

The probe's independent conflict oracle fails. This result does not depend on a race lottery or synthetic SQL corruption; the stale-T2/T1 interleaving is scheduled explicitly through the public store/runtime boundary. The use of a rejected refund makes the observed complete A revision unheld rather than relying on an already adverse approved refund.

### Impact and narrow fix

Until the contradictory receipt's T2 progresses, A can publish financial evidence omitting a contradiction that was durably admitted before its commit. If that receipt's worker is delayed or fails, the original parent has no T1-created correction obligation. Eventual successful processing currently repairs both parents; that does not restore the promised admission fence during this interval. No irreversible consumer effect or financial loss was exercised by this producer-only probe.

During T1, derive the bounded already-known historical parent route from exact-version certification, serialize that lookup with concurrent certification/aggregate writers using a consistent lock/read-set protocol, and install original-parent adverse/conflict custody plus its publication obligation in the same admission transaction. Retain incoming-parent routing. When processing the receipt, remove only its own pending markers after the appropriate both-parent disposition; avoid leaving a permanent marker on the extra parent. Preserve the T2 both-parent read sets and immutable original certification implemented by this candidate.

Add the inverse interleaving above to the existing historical-parent suite. Its current test changes A after preparing the contradictory receipt's T2, which correctly tests both-parent T2 CAS but does not test a previously prepared A T2 crossing contradictory T1 admission.

## Verification performed

Commands ran from the detached worktree, with the relevant exact Node binary directory and `/tmp/payments-sdk-tools` first in `PATH`, and `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres` for real database runs.

| Gate | Node24.21.0 | Node26.11.1 |
| --- | --- | --- |
| Offline frozen pnpm install | Pass, exact locked dependencies | Same installed immutable closure reused |
| `pnpm build` | Pass | Built ESM reused by tests |
| `pnpm exec tsc -p review-probes/tsconfig.json` | Pass | Runtime probes use the same strict TS source |
| `pnpm test:postgres` | 31 passed, 0 failed/skipped | 31 passed, 0 failed/skipped |
| `node --test review-probes/quarantine-reclassification.test.ts` | Both independent oracles fail as described | Both independent oracles fail as described |
| `node --test review-probes/historical-parent-t1.test.ts` | Conflict oracle fails as described | Conflict oracle fails as described |

The passing suite includes 205 acknowledged historical renewals, bounded restartable fanout, stale selection CAS, concurrent fanout/reselection, concurrent pages, a new member sorting behind the cursor, immutable completion/evidence preservation, exact historical adjustment both-parent T2 CAS, queue deletion reconstruction, successful pages under a one-fault budget, partial-startup physical SDK debt retention, runtime role/bootstrap separation, SQL deadlines/lost COMMIT, and the real logical recovery scenarios.

## Other scoped conclusions and limits

Read `AGENTS.md`, the accepted implementation plan, architecture/operations/qualification/recovery/reclassification guides, relevant historical reviews, and the PostgreSQL adapter's store, record/transaction, job transport, worker and recovery source. Reviewed the corresponding core classifier, reclassification command/read-set path and historical-route helper as necessary to derive the adapter oracles.

No additional concrete P0/P1/P2 was established in pg-boss partial startup/physical drain or recovery. Failed startup retains its installed core lifecycle owner and rejects replacement installation; `status`/`drain` retain physical debt. The host-owned pool remains borrowed. Restore administration uses owner-local CAS/audits, preserves producer and immutable message identity, verifies consumer-owned checkpoint manifests without consumer SQL, scans every restored prepared operation as uncertain, and retains per-lane review holds after global resume. These conclusions are bounded to inspected code and passing local real-PostgreSQL scenarios.

No physical backup/WAL/PITR, replica promotion/RPO0, live Paddle request/charge, production credit ledger, hosted deployment, npm publication or release was attempted or qualified. The provider quantity/collection-mode and future transaction-status fixes assigned elsewhere are not duplicated. A final candidate SHA including those changes and the fixes above still requires independent impact review and qualification.
