# Main-push queue fixture correction

## Observed failure

PR [#6](https://github.com/agent-teams-ai/payments-sdk/pull/6) merged as
[`17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b`](https://github.com/agent-teams-ai/payments-sdk/commit/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b).
Its exact-head [PR checks](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39597496949)
passed. The subsequent [main-push checks](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39598027818)
failed at the PostgreSQL step of the Node 26.11.1 scenario job. The Node 24.21.0
scenario job, build and quality passed;
the required aggregate correctly remained failed. The failed run was not retried
and was still recorded as attempt 1 when this evidence was checked.

The failure was `55P03: canceling statement due to lock timeout` at the live
`boss.deleteAllJobs()` call in `packages/payments-postgres/test/jobs.test.ts:187`
of that merged source. The complete failing test took 857.90 ms; that duration
is not a measurement of the lock wait alone. The other 48 PostgreSQL cases
passed. The Node 26 E2E, published Observation and production npm consumer
steps after PostgreSQL were skipped. The separate quality job, including its
pnpm packed-consumer gate, passed. That main run is therefore incomplete
qualification of the merge, with a correctly failed required aggregate.

## Cause and independent reproduction

The exact admitted pg-boss 12.38.0 implementation of unnamed `deleteAllJobs()`
uses `TRUNCATE <schema>.job`. PostgreSQL requires an ACCESS EXCLUSIVE lock,
which conflicts with ordinary readers, including reads that running workers or
maintenance can hold. The test's `attempts === 1` polling could observe a
committed claim before inspection and logical settlement; it did not prove
either logical settlement or physical queue completion. The test performed
unnamed deletion with workers and pg-boss background subsystems active.
Production transport does not expose or call this vendor administration method.

The original CI log does not identify a blocking backend PID, its exact SQL or
its lock duration. The precise original blocker was not observed, and the
reproduction below does not recover that missing information. The confirmed
mechanism and fixture ordering justify the scoped fixture correction; they do
not establish a production payment-processing defect or production fix.

Two independent GPT-6.1-sol xhigh investigations reproduced the error on Node
26.11.1 / PostgreSQL 18.4 with the unchanged default bounded SQL executor:
hold a disposable transaction open after reading `<jobSchema>.job`, then
call unnamed `deleteAllJobs()`. The independent critic observed the same
`55P03` after 502 ms; the implementation owner observed it after 503 ms and
confirmed granted `AccessShareLock` entries on `job` and `job_common`.
The critic's named nonpartitioned queue deletion succeeded in 9 ms while that
same read lock remained. The implementation owner independently verified both
named deletion and bounded all-row `DELETE` under its held reader. Both
disposable databases were cleaned.
This is evidence for changing the fixture's operation and ordering, not for
increasing the production 500 ms lock timeout.

## Correction and retained guarantees

Local correction commit: `fa3144801a410aa9eb6b3e2d5a67de3e5fd89f0b`.
Changed file: `packages/payments-postgres/test/jobs.test.ts`.
Changed test blob: `5cef8345fef02305073776d7af891c3c1253416a`.
Its local parent `d7275165df42aa83623e280513c26c9721fa85ac` has the merge's exact
tree `601be0a727b55a27fd851c49315ae0cc3477e236`. Only the test file changes in
this correction; it changes no production code, timeout budget, API or gate.

The fixture wraps the existing public transport callback to hold the first
unknown-operation wake-up active after the real logical handler settles. It
compares the original saved retry deadline with an independent database clock
captured inside the first failing inspection, requiring the configured two-second
cooldown. It then parks that exact durable deadline in the future while checking
queue loss, releases the callback and observes actual vendor completion.
Bounded `DELETE` removes every queue row while avoiding `TRUNCATE`'s
ACCESS EXCLUSIVE DDL lock. The saved logical cooldown snapshot—state, attempts,
issue, revision and exact timestamp text—must survive deletion and
repair, with no unknown wake-up and no repeated provider mutation. The fixture
then explicitly makes the obligation due and retains the original second-failure,
quarantine, exact diagnostics, progressing reconciliation, audited redrive and
single-dispatch assertions. A `finally` block releases the callback on failure.

Independent review found and corrected two intermediate oracle weaknesses before
the final commit: parking a timestamp must not hide a missing real cooldown, and
observing vendor completion alone can still lose a short retry window to scheduled
repair. The final callback barrier and database-clock assertion address both.
The final exact-blob review found no material remaining issue.

## Sweep of remaining unnamed deletion calls

A source sweep at frozen source
`6f348df2d345edf5270ade0daebf67cc834de2de` found five remaining unnamed
`deleteAllJobs()` call sites. The corrected test blob above is unchanged at
that frozen source. Each remaining call occurs before its workers start or
after explicit stop and drain:

| Source location at the frozen revision | Lifecycle boundary |
| --- | --- |
| `packages/payments-postgres/test/jobs.test.ts:103` | Before `f.jobs.start()`; tests rebuilding deleted pending jobs |
| `packages/payments-postgres/test/jobs.test.ts:171` | Before `jobs.start()`; removes the initial unknown-operation wake-up |
| `packages/payments-postgres/test/jobs.test.ts:183` | Before `jobs.start()`; removes the saved scan's wake-up |
| `packages/payments-postgres/test/reclassification.test.ts:179` | Before `jobs.start()`; tests rebuilding reclassification work |
| `packages/payments-postgres/test/reclassification.test.ts:244` | After `await jobs.stop(); await jobs.drain();`; tests preservation of cooldown/quarantine in both attempt-bound cases |

The sweep found no production call to this vendor administration method and
no remaining unnamed deletion overlapping the fixture's started workers.
This is source/lifecycle inspection, not an assertion that every possible
external use of `TRUNCATE` is safe.

## Focused verification

The implementation owner executed the two complete corrected-file runs below,
the compiler check and focused lint. The independent critic executed its own
targeted original scenario and controlled held-lock reproduction, then reviewed
the corrected blob; it did not repeat these two complete corrected-file runs.

| Runtime | Exact corrected `jobs.test.ts` | Result |
| --- | --- | --- |
| Node 24.21.0 | Fresh disposable PostgreSQL database | 9/9 passed, 15.42 s |
| Node 26.11.1 | Separate fresh disposable PostgreSQL database | 9/9 passed, 15.35 s |

Each execution ran the complete file with
`node --test packages/payments-postgres/test/jobs.test.ts`, using its admitted
Node binary and a separate freshly created PostgreSQL 18.4 database. Both
databases were removed afterward. Strict `tsc -p tsconfig.checks.json`, focused
type-aware oxlint and `git diff --check` also passed on the final test blob.

These focused results belong to the fixture correction and the two runtime
versions stated in the table. They do not change the recorded failed main run,
qualify later runtime-floor changes or establish a later full-gate result.
The source frozen for the subsequent complete qualification is
`6f348df2d345edf5270ade0daebf67cc834de2de`; its subsequently passing
[complete local qualification](node-runtime-security-correction-2026-10-21/qualification.md)
is recorded separately. A subsequent hosted exact-head result remains pending.
