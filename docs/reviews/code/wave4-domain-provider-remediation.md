# Wave 4 domain/provider remediation — independent narrow final delta review

## Exact subject and verdict

**Reviewed and executed candidate:** `7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`.

**Verdict: no new actionable P0/P1/P2 finding established in the scoped domain admission delta or its provider-profile compatibility.** The changed core semantics and retained profile/late-outcome compatibility probes pass on Linux Node **24.21.0** and **26.11.1**. This completes the requested final domain-side check of the integrated corrections. The historical `wave4-domain-provider.md` report is unchanged and continues to describe its earlier frozen subject.

Detached checkout: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider`, switched from `f07bc9fb31e9b75c1d89dda3e59ee1fa9627ed32` to the exact candidate above. No production code was edited, no commit created and nothing pushed. Only strict review probes/configuration/logs are untracked in the checkout.

The relevant integrated correction commits are `91138aaffed760109ff0a51663971f4e1c2c3531`, `e7803e3f6035d695d1a68acae6457c60a04875bb`, `4d468ebc8cafd0c419d86253690b12c3d5bfd985`, `bb5376cee409bf25de01b88908c876a5ff50c473` and `054a20b50bdfc3b76c8193d81ac518ee1fe7fa0d`. The candidate also contains consumer fixture corrections `f560818` and `560c75b`, whose consumer-specific qualification is independently owned. The later `997a5f` disposition is documentation-only; it was not substituted for the exact executed code subject.

## Scope and source inspection

Compared the complete frozen-to-candidate delta in core admission/reduction, the new maintained memory case, and the directly supporting PostgreSQL admission/record-locking/obligation changes. The only core production change is the bounded `adverseTransactionRefs` helper and its reuse by first admission, pending receipt replay and successful processing cleanup. Core profile reducers, the separate `currentProfileFlags`/`retainedFlags` contract, provider normalization and mutation settlement rules are unchanged by this delta.

The helper discovers the incoming adverse parent plus the retained certified exact-version parent. It uses the existing exact-version identity and `objectVersionDependentRoutes` rule. Admission retains custody even when an invalid object version prevents discovery of any additional certified route. Successful reduction removes only that receipt's pending markers from the same known route set; unsupported/failed input remains quarantined with its adverse marker. Thus the correction does not introduce a separate database-owned classifier or transfer product/credit decisions into payment admission.

For an existing unprocessed receipt, duplicate admission now adds a newly known parent marker without replacing its original receipt. It increments only an aggregate whose marker was absent. Repeating that pending duplicate does not add another marker or create revision churn once the known set is established. A processed receipt returns duplicate before recreating any pending marker, so a subsequent processing/publication replay remains idempotent.

Inspected the supporting PostgreSQL handoff: exact-version certification is locked/read before known aggregate route discovery; T1 and T2 share the inbox/version/aggregate lock order; core receives the certified version and both loaded routes. The independent PostgreSQL reviewer owns the dynamic lock interleavings and claim-generation/migration qualification recorded in `wave4-postgres-remediation.md`. This report does not claim those executions as its own.

## New independent core oracles

Added `review-probes/remediation.test.ts` in a strict TypeScript project. Its three cases test the changed core functions directly with explicit expected route, revision, custody and evidence cardinalities; they do not compute expectations by invoking the route helper or classifier under test.

| Independent trace | Observed result on both exact runtimes |
| --- | --- |
| Receipt for B is pending before any exact-version certification; a separate original receipt certifies A at that version and advances A to a newer version; B's identical pending receipt is replayed | Replay adds exactly one A marker and increments A's revision exactly once. B already has exactly one marker and its revision does not change. Repeating that pending replay leaves the whole state exactly unchanged. There are still exactly three immutable inbox receipts. |
| The enriched B receipt is processed and published, then replayed after successful processing | Both A and B receive the conflict, and both receipt markers clear. The original exact-version projection remains retained and becomes conflicting. Both completion facts remain byte-equivalent. Exactly two new full conflict messages publish. A processed duplicate then leaves the whole state unchanged, emits zero messages and preserves the exact evidence count. |
| A has deliberately overlapping current `unsupported` and independently retained `unsupported`/`ownership_mismatch` controls during the above admission/cleanup | `currentProfileFlags` remains unchanged. The independent retained controls survive, with the new conflict added. Routing/marker cleanup does not erase or reclassify their ownership. |
| Invalid provider object version | First admission retains the incoming parent's marker and original receipt instead of throwing. Processing quarantines it and retains that marker plus `incomplete`; no unrelated parent is invented. |
| Original A version and contradictory B version use equivalent RFC3339 timezone spellings with full nanosecond precision | They map to the same version identity. Initial B admission fences exactly both parents, retains two distinct receipts and one certified version record, and successful processing clears both receipt markers. |

The expected counts distinguish custody identity, exact-version certification, aggregate revisions and immutable evidence identity. The synthetic preexisting completion facts are fixed inputs to these pure admission tests; the test does not ask the classifier to establish its own expected financial history.

## Compatibility and maintained regression recheck

Reran the previously retained independent `domain-provider.test.ts` unchanged against the exact candidate. Its seven actual public SDK/raw/API profile cases and two memory/PostgreSQL late-outcome cases continue to pass. In particular:

- Same-version raw/API quantity enrichment remains positive in both directions.
- A supported observation older by one nanosecond still cannot replace a newer unsupported profile.
- Independent unsupported-event and ownership controls survive newer supported current-profile resolution.
- API partial → raw full → later watermark → API contradictory same event retains the jointly certified profile meaning and a durable conflict.
- Administrative outcome binding does not hide physical debt; late attempt evidence and both transaction references remain retained while the audited outcome stays authoritative, with no automatic second mutation.

The public SDK cases still use official Paddle SDK **3.10.0**, signed raw ingress or authenticated public SDK entities/collections, test-only undici MockAgent with network disabled, and isolated real PostgreSQL schemas. No production transport patch, private SDK runtime import, provider method replacement or live account is involved.

Also executed the new maintained core memory historical-parent test independently. Its explicitly staged old T2 loses CAS after admission fences the original certified parent; both parents retain the pending marker before processing, receive conflict afterward, and clean up only the processed receipt's markers.

## Commands and results

The exact candidate was rebuilt with Node24.21.0 and the existing frozen dependency graph. The review project passes strict TypeScript **7.0.2** compilation on both Node floors, inheriting `skipLibCheck:false`. No new dependency or compiler override was introduced.

From the detached checkout, with the selected exact runtime directory and `/tmp/payments-sdk-tools` first on `PATH`:

```sh
export PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
pnpm build
node node_modules/typescript/bin/tsc -p review-probes/tsconfig.json
node --test review-probes/remediation.test.ts review-probes/domain-provider.test.ts
node --test --test-name-pattern='memory admission fences a certified historical adjustment parent' packages/payments-core/test/core.test.ts
```

Strict compilation and both test commands were repeated with `node-v26.11.1-linux-x64`.

| Newly executed gate | Node24.21.0 | Node26.11.1 |
| --- | ---: | ---: |
| Strict retained review project | Passed | Passed |
| New independent core admission/custody cases | 3 passed | 3 passed |
| Retained independent profile/event/late-outcome probes, including parent group | 10 passed | 10 passed |
| Maintained memory historical-parent/stale-T2 case | 1 passed | 1 passed |
| **Focused test total** | **14 passed, 0 failed/skipped** | **14 passed, 0 failed/skipped** |

Retained additions/evidence:

- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/remediation.test.ts`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/domain-provider.test.ts`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/tsconfig.json`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/remediation-node24.log`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/remediation-node26.log`

## Limits and final disposition

This is a narrow final delta review, not a redundant rerun of the earlier 98-test frozen-subject command. The detailed PostgreSQL concurrency, obligation generations, runtime-role and migration results belong to `wave4-postgres-remediation.md`; consumer snapshot qualification and its real owner/public HTTP probes belong to `wave4-consumers-remediation.md`. Those reports are identified as external review evidence, not relabeled as independently executed here.

No additional material domain/provider defect was found, and no further optional domain test is required by this result. Actual Paddle sandbox/account behavior, production access/credit policies, physical restore/PITR or HA promotion, unpublished Observation adoption, the blocked browser wrapper, deployment, publishing and release authorization remain outside this correction check.
