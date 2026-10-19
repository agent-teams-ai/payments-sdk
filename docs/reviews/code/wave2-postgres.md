# Wave 2 independent review — PostgreSQL jobs and recovery

## Reviewed snapshot

- Frozen commit: `401e2fce0176c42ffd6adf2b881cbeb8e57e6bad` (`401e2fc`).
- Detached isolated worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-postgres`.
- Focus: `packages/payments-postgres/src/{database,records,store,job-transport,jobs,recovery}.ts`, accepted PostgreSQL/T1/T2/T3/restore/lifecycle requirements, recovery runbook, and real PostgreSQL tests.
- No production source was changed, and nothing was pushed. The additional reproduction is isolated under `review-probes/` in this worktree.
- Setup: pinned offline install and `pnpm build` succeeded on Node 24.21.0. PostgreSQL URL: `postgresql://postgres@127.0.0.1:55432/postgres`.

## Finding: P2 — partial-startup cleanup forgets physically unresolved SDK work

**Source:** `packages/payments-postgres/src/jobs.ts:229–235`, especially `handlers = undefined` at line 234; consequences at `status():241–244` and `drain():267–271`.

The startup path installs the main worker before the repair worker. If startup fails after the main worker has admitted a payment whose physical SDK promise is still unresolved, its catch block stops pg-boss and drops `handlers`. The admitted handler can already have returned at the core's logical operation deadline, while the physical provider call remains alive in the Payments instance. After dropping `handlers`, `status()` reports zero unresolved calls, and `drain()` skips that Payments instance entirely. It resolves while provider I/O and its eventual storage cleanup remain outstanding.

This violates the accepted shutdown requirement that a logical deadline/pg-boss stop is not physical drain and that failed partial startup follows the same accounting and cleanup contract. A Host following the reported drain result can close its borrowed pool or end the process before a late provider result is recorded. The durable dispatch marker still prevents automatic redispatch, so this is **not** a demonstrated automatic double-charge path. Its concrete impact is falsely reported shutdown readiness, loss of the late observation/settlement opportunity, and potentially unresolved provider outcomes requiring manual reconciliation.

### Reproduction and result

Probe: `/workspace/scratch/9e36ca3bbd13/implementation/review-w2-postgres/review-probes/startup-debt.test.ts`.

The probe uses a real PostgreSQL namespace, bootstrap, repair, ordinary pg-boss work claim, durable dispatch commit, and a deferred fake-provider SDK promise. It makes the second worker registration wait until the first worker has entered that physical SDK call, then injects a registration failure. The core operation deadline is 25 ms. The test waits for rejected startup, inspects the core and jobs lifecycle, calls `jobs.drain()`, and only releases the SDK promise in cleanup.

Both Node 24.21.0 and 26.11.1 produced:

```json
{
  "core": {"accepting":true,"unresolvedExternalCalls":1,"pendingWork":0},
  "reported": {"transportStopped":true,"admittedHandlers":0,"unresolvedExternalCalls":0,"pendingCoreWork":0},
  "drained": {"transportStopped":true,"admittedHandlers":0,"unresolvedExternalCalls":0,"pendingCoreWork":0}
}
```

The independent assertion that reported unresolved calls must remain one fails on both floors. The test finishes cleanly after resolving the held physical promise and draining the core itself.

Command, with either supported runtime directory first in `PATH`:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
node --test review-probes/startup-debt.test.ts
```

### Reachability qualification

This is a **fault-path finding**. The pinned pg-boss ordinary, nontransactional `work()` registration performs no database wait: with these two constant, valid options, a normal transient database error does not itself make the second registration fail after a physical call has started. The deterministic reproduction deliberately widens and fails the existing second-registration fault-injection seam. The repository already treats second-registration failure as supported partial-startup cleanup in its test suite, but its original test had no admitted work. This report does not claim the injected timing is a routine production SQL-failure scenario.

### Minimal fix

Keep a lifecycle owner for every Payments instance that could have admitted work until its physical tasks and cleanup drain. The narrowest change consistent with the existing one-shot post-stop lifecycle is to make any post-install startup failure terminal for that jobs object, retain its installed handlers/core reference, and require reconstruction to try startup again. `status()` must continue to report that core's debt, and `drain()` must await it. Merely retaining `handlers` while permitting another `start()` to replace it is insufficient: a second Payments instance could overwrite the first reference and hide the old physical task again.

If restart on the same jobs object is a desired public behavior, retain a deduplicated set of admitted Payments lifecycle owners, aggregate their debt, and drain all of them before releasing references. Add a regression with held provider I/O during failed startup, plus the replacement-runtime case if retry remains supported. Do not put an unbounded physical SDK wait inside `start()` failure handling itself; retain honest debt for the explicit drain API.

## Verification and other conclusions

The existing real PostgreSQL job/recovery groups passed on frozen `401e2fc`, Node 24.21.0: **8 tests, 8 passed**. Command:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
node --test packages/payments-postgres/test/jobs.test.ts \
  packages/payments-postgres/test/recovery.test.ts
```

Those tests cover migration/runtime privilege separation, durable obligation reconstruction after deleting jobs, independent delivery targets and T2 replay, persistent cooldown/quarantine, unknown-operation nonredispatch, scan progress, ordinary shutdown physical debt, producer/consumer logical rollback, immutable checkpoint substitution/counter rejection, restored prepared-operation uncertainty and lane holds, and paged recovery CAS/audits/restart. The new focused probe was run on both supported Node floors and intentionally fails only its lifecycle assertion.

No additional P0/P1 financial correctness failure was confirmed in the reviewed recovery and queue seams. In particular, this review did not treat the following as defects: the external Host fence must exist before restore and normal startup; a trusted operator must restart checks after importing owner archive data; consumer checkpoint-export completeness remains its owner's contract; full backup/WAL/PITR and RPO0 HA qualification are deployment responsibilities; append-only T1 custody/late observations may continue under the local fence. The report does not claim physical backup/restore or replica-promotion qualification.

The separately reported valid 101–200 item reconciliation page versus PostgreSQL's generic 100-record batch limit is already owned by the root implementation work and is not duplicated here.
