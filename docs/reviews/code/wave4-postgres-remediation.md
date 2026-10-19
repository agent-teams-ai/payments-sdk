# Independent Wave 4 PostgreSQL remediation recheck

## Exact subject and disposition

- Historical finding subject: `fcd57f9ad4887338edab351cb1ef6457e97644a1`.
- Independently rechecked combined candidate: **`7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`**.
- Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-postgres`.
- Qualification environment: Linux, exact Node `24.21.0` and `26.11.1`, real PostgreSQL `18.4`, pinned pg-boss `12.38.0`, TypeScript `7.0.2` and pnpm `11.25.0`.

**Both P2 findings in the original Wave 4 PostgreSQL report are verified fixed in this exact candidate. No additional actionable P0, P1 or P2 regression was established in this bounded remediation review.** The original report remains historical and unchanged. This recheck makes no claim about later commits or work outside the scope described below.

No production source was edited, committed or pushed. The original independent probes and their original assertions were retained unchanged. New passing result logs use separate remediation filenames, preserving the historical failing evidence.

## 1. Unchanged reclassification quarantine/cooldown — verified fixed

`packages/payments-postgres/src/store.ts:528–534` now recognizes changed reclassification records inside the mutable-record write path. An unchanged record is skipped before work synchronization. A genuinely different `decisionRevision` explicitly creates replacement work with reset semantics; merely loading the same pending cursor during ordinary renewal processing no longer rewrites its obligation.

`store.ts:591–595` also stops pending traversal pages from implicitly replacing their claimant's deadline/revision. Actual successful progress is handled by worker settlement; completion closes the obligation. This preserves the distinction between an unchanged decision, a successful page and a genuinely new decision.

The original independent real-PostgreSQL/pg-boss probe was rerun on both exact Node floors. Its original oracles now pass:

| Original independent case | Observed remediation outcome on both floors |
| --- | --- |
| Ordinary renewal while the unchanged decision is quarantined | State remains quarantined; attempts and issue remain unchanged; exact persisted `next_attempt_at` is identical |
| Ordinary renewal while the unchanged decision is cooling down | State remains pending; attempts and issue remain unchanged; exact persisted `next_attempt_at` is identical |

The maintained correction tests additionally verify that deleting queue jobs does not bypass the preserved disposition, audited redrive persists its audit and resets unfinished work, and a new decision directly replaces the prior generation with reset fault state.

### Claim-generation concurrency

Inspected `jobs.ts:99–122`, the obligation reset/update implementation in `records.ts`, and audited redrive. A claim now increments and returns an independent durable obligation revision. Settlement requires both its claimed attempt and exact claimed revision. Replacement work, another claim, completion and redrive advance the revision, so numerical reuse of attempt one cannot admit a stale result.

The maintained real pg-boss regression physically overlaps two claimants, both at attempt one in different generations. It waits for the old job's actual completed settlement, then compares the current obligation's complete persisted disposition with the snapshot taken while the replacement claimant is held. The old claimant cannot quarantine the replacement. Releasing the replacement claimant applies its own fault policy, and another genuine decision resets that quarantined generation. This passed on both floors.

## 2. Historical adjustment original-parent T1 fence — verified fixed

`packages/payments-postgres/src/store.ts:260–288` now locks and reads relevant exact-version certification before deriving the retained historical parent routes. `PaymentRecords.lock` uses a shared inbox → version certification → remaining-record order. T2 uses the same ranked order. This removes the stale lookup interval without introducing the inverse version/aggregate lock order identified during remediation.

The PostgreSQL adapter supplies the retained certified version to the core-owned admission reducer and locks/loads both affected parent aggregates. Core's `adverseTransactionRefs` at `packages/payments-core/src/reducer.ts:358–366` supplies the same bounded routes to admission and processing cleanup. The adapter still traverses relationships and persists custody; business classification remains in core.

The original independent stale-parent probe now observes, on both exact Node floors:

```json
{
  "result":{"kind":"conflict"},
  "originalParentFlags":[],
  "originalParentPending":["contradictory-old-parent"]
}
```

The next full A snapshot was staged before admission, but is rejected at commit. Its staged complete revision is not installed. The original oracle remains `conflict`, exactly as in the historical failing probe.

### Concurrent certification, cleanup and replay

Read and executed the maintained cases covering:

- authenticated API input, verified webhook custody and reconciliation admission, each invalidating stale T2 for both historical parents;
- removal of only that receipt's markers after both-parent processing while retaining both conflict flags and the original certified projection;
- a first-certification writer blocked inside real PostgreSQL while admission waits on its certification lock, then successful admission discovering and fencing the newly committed parent;
- a pending receipt replay after certification has appeared since its original admission, adding the newly known original-parent barrier;
- processed receipt replay preserving aggregate state and immutable evidence without recreating adverse markers or another evidence revision;
- a real 200-member reconciliation page, an injected SQL failure after prior custody writes, complete rollback of both-parent effects/checkpoint/receipts, and successful subsequent admission under that fixture's lock-bound assertion.

All eight maintained PostgreSQL correction cases passed on both exact Node floors. The corresponding core memory admission/stale-T2/both-parent cleanup case also passed on both floors.

## Migration and runtime ownership

Inspected the new `obligations.revision` migration: `migratePaymentSchema` explicitly adds a non-null positive bigint with default one using `ADD COLUMN IF NOT EXISTS`. It remains in the migration-role path. No new runtime DDL, automatic migration call or ownership transfer was introduced by the scoped delta. The worker handles revisions as strings for CAS, avoiding JavaScript number truncation.

Reran the maintained real runtime-role bootstrap/worker test on Node24.21.0. The runtime role cannot create a table, yet starts the scheduler/supervision/workers, claims and completes prepared work using the revised obligation schema, and leaves the borrowed pool usable. This passed. A separate populated legacy-schema upgrade exercise was not performed in this bounded recheck; the migration path was inspected and fresh-schema execution is exercised by every database fixture.

## Commands and retained evidence

Commands ran from the detached exact candidate with its supported Node directory and `/tmp/payments-sdk-tools` first in `PATH`, using the supplied disposable `DATABASE_URL` for database tests.

| Gate | Node24.21.0 | Node26.11.1 |
| --- | --- | --- |
| `pnpm build` | Pass | Built ESM reused for execution |
| `pnpm exec tsc -p review-probes/tsconfig.json` | Pass against current contracts, original probe source unchanged | Same strict sources executed |
| Original `quarantine-reclassification.test.ts` and `historical-parent-t1.test.ts` | 3 passed, 0 failed/skipped | 3 passed, 0 failed/skipped |
| Maintained focused PostgreSQL correction cases | 8 passed, 0 failed/skipped | 8 passed, 0 failed/skipped |
| Maintained core memory historical-parent admission case | 1 passed | 1 passed |
| Maintained restricted-runtime-role worker case | 1 passed | Not rerun |

Focused PostgreSQL command:

```sh
node --test \
  --test-name-pattern='ordinary renewal preserves exact|old failed claimant|T1 fences both historical|T1 parent discovery|duplicate pending receipt' \
  packages/payments-postgres/test/reclassification.test.ts
```

Retained evidence in `review-probes/`:

- Original strict independent `.ts` sources and `tsconfig.json`.
- `remediation-node24-results.log` and `remediation-node26-results.log`.
- `remediation-focused-node24.log` and `remediation-focused-node26.log`.
- `remediation-memory-node24.log` and `remediation-memory-node26.log`.
- `remediation-runtime-role-node24.log`.

## Limits

This was a focused independent recheck of the two established findings and their directly affected claim-generation, admission-locking, replay, migration and ownership seams. The broader provider/consumer changes in the combined candidate were read only as needed to assess scope impact; their independent reviewers own their qualification. The existing full PostgreSQL suite passed both floors on the historical subject, but was not rerun in full on this remediation candidate; only the exact focused gates above are newly executed here.

No physical backup/PITR, replica promotion/RPO0, live Paddle operation, production consumer effect, hosted deployment, npm publication, release, merge or push was performed. These results qualify the specified local code corrections, not a production deployment or a later final commit.
