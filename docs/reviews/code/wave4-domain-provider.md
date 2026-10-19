# Wave 4 independent final implementation review — domain and Paddle provider

## Subject, decision and boundaries

**Frozen integrated subject:** `f07bc9fb31e9b75c1d89dda3e59ee1fa9627ed32`. **Detached review checkout:** `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider`. **Review date:** 2026-10-19 UTC.

**No new actionable P0/P1/P2 finding established in this scope.** The concrete independent coverage below passes on both exact supported Node floors. This is a qualified no-finding result for the frozen subject and stated domain/provider seams, not a claim that every deployment or later patch is qualified.

The subject already includes provider corrections `a4504f6126fbd11d0bf5e175ed6d0cd6aee6c141` and `cc27a4baafba7c9a85c049a8bce1ad68abc789e6`, plus integrated architecture/qualification documentation. No source delta was applied to this detached checkout. The PostgreSQL reviewer's separate in-progress reclassification-generation and original-adjustment-parent admission fixes are excluded from this result; their final commit was not available during this completed pass. A later narrow delta check should identify its exact commit separately.

No production edits, commits, pushes, live credentials, charges, or public releases were made. The checkout contains only additional untracked review probes/config/logs. The report itself is retained outside the checkout for integration by the review owner.

Read `AGENTS.md`, the accepted implementation plan's ownership, command uncertainty, T1/T2/T3, custody, immutable evidence, subscription ordering/profile and reconciliation rules; current `docs/architecture.md`, `docs/qualification.md`, `docs/upstream-qualification.md`, and Paddle documentation; historical wave-3 domain/provider findings; and the retained Q skill. The accepted implementation plan was not edited; its SHA-256 is `b4e7ba0d5715f5ef3f6a80290d02b54be7dc8a3dd2ae8e71443c1845dafeaf95`.

Reviewed the core-owned contracts, runtime, reducers, exact values and memory/CAS seams; the official-SDK provider, normalization, errors and reconciliation adapter; relevant host ingress paths; and the PostgreSQL working-set/commit behavior traversed by the probes. Review focused on observable invariants and ownership rather than file layout or interface counts.

## Independent expected behavior and observed result

The new probes do not use the production classifier to calculate expected flags, current versions or operation outcomes. Their expected results follow directly from the accepted profile and uncertainty rules: missing required quantity cannot certify the supported profile; jointly known same-version facts can enrich unknown fields; a one-nanosecond older supported observation cannot replace a newer unsupported current profile; independent historical controls survive profile resolution; an audited logical outcome cannot physically cancel an unresolved provider promise; and late attempt evidence cannot overwrite a later administrative decision.

### New retained probes

`review-probes/domain-provider.test.ts` has **nine substantive cases, ten Node test results including its parent group**, all passing on both floors:

| Independently constructed trace | Concrete passing oracle |
| --- | --- |
| Raw partial subscription → full authenticated API entity at the same exact timestamp, including equivalent timezone spelling | Missing quantity first publishes `incomplete`; known quantity 1 then positively recovers. Replaying the partial receipt cannot discard the jointly certified quantity or reintroduce an incomplete profile. |
| Authenticated API partial → full signed raw subscription at the same exact timestamp | Same positive recovery in the opposite custody direction. The identical API receipt replay is correctly duplicate custody, not a new payment or regression to unknown. |
| Raw newer unknown collection mode, then supported observation older by one nanosecond | Current unsupported profile and hold survive the stale input. A later supported current profile resolves its own profile hold but cannot remove a separately admitted unsupported-event control. |
| Same unknown-collection sequence acquired first through the actual API SDK entity | Same result, independent of raw versus mapped acquisition and beyond the integrated manual-collection regression. |
| Raw unsupported quantity-2 current profile, then an older contradictory customer, then a newer supported current profile | The current profile resolves; independently established `ownership_mismatch` remains in `retainedFlags` and effective flags. A stale ownership contradiction is not treated as rehabilitation. |
| Same stale-ownership sequence acquired first through the API entity | Same retention across the reverse raw/API order. |
| API event with unknown quantity → raw full same event → later current watermark → API same event with quantity 2 | All receipts retain distinct custody/digests. The earlier known quantity remains relevant after current watermark advancement; the third receipt conflicts at admission and quarantines. A subsequent supported snapshot does not clear that retained conflict. This exercises both event identity and exact object-version identity with the newly added profile meaning. |
| Provider-neutral deferred checkout, memory store, timeout → audited successful binding → physical late success | No automatic second dispatch from a same-key request or repair. Audit leaves physical debt visible. `stop`/`drain` remain unsettled before explicit provider release. Late success is retained in immutable attempt observations and establishes its separate transaction binding while the administratively proved result remains authoritative. |
| Same deferred checkout through real PostgreSQL | Same observable operation history, no hidden retry, both transaction references retained, physical debt cleared only on actual settlement. |

All profile sequences also assert that the historical completion remains present. Their source fixtures go through official signature verification or public SDK resources/entity/collection constructors. The review transport uses test-only official undici `install()` and `MockAgent`, disables all network connections, and restores globals/dispatcher in cleanup. Production code is not patched, private SDK runtime paths are not imported, and no fake SDK replaces the official implementation.

Each PostgreSQL trace creates and removes a random isolated payment schema. Database read-back identifies PostgreSQL **18.4**, `fsync=on`, `synchronous_commit=on`. Installed runtime evidence identifies official Paddle SDK **3.10.0** and TypeScript **7.0.2**.

## Focused existing regression coverage rerun independently

The combined command also reran the existing core/reconciliation, official SDK, provider-profile E2E and durable reconciliation tests, rather than relying on the implementer's earlier success report.

| Coverage in the combined execution | Node 24.21.0 | Node 26.11.1 |
| --- | ---: | ---: |
| Core/reconciliation tests | 47 passed | 47 passed |
| Official Paddle SDK contract tests | 18 passed | 18 passed |
| Durable reconciliation with real PostgreSQL | 12 passed | 12 passed |
| Integrated provider-profile E2E | 11 passed | 11 passed |
| New independent review results, including group | 10 passed | 10 passed |
| **Total** | **98 passed, 0 failed/skipped** | **98 passed, 0 failed/skipped** |

The integrated profile cases independently rerun the original eight reported source/status combinations, newer supported resolution, stale-state rejection, noncompleted-status meaning, period-end cancellation/lifecycle meaning, trial/cycle holds, and raw/API historical profile conflicts. The durable reconciliation cases cover official 101/200-member SDK pages, failed commit/cursor recovery, SDK mapper failure and restart, transport/429 gaps, raw/mapped conflicting identities and retained routes, adjustment sweeps, unsupported adjustment custody, restart, and complete API source receipt persistence.

## Reasoned non-findings

- The core dependency direction remains inward and provider/storage/framework DTOs do not leak through public core contracts. Payment operations/evidence, product access, credit accounting and usage retain separate owners. The provider-neutral deferred-promise traces establish the uncertainty behavior independently of Paddle.
- The dispatch marker remains the single mutation authorization site. Prepared/dispatch/unknown and audited resolution are distinct; the late-result logic retains attempt evidence and transaction bindings without overwriting an already resolved result. The new tests explicitly check physical debt, rather than assuming `Promise.race` or an audit stops external execution.
- Current profile flags and retained historical controls have separate observable ownership. Newer supported profile evidence removes replaceable profile holds while independently admitted unsupported events, exact-version conflicts and ownership contradictions remain effective. The new stale and partial-enrichment traces found no loss of the new quantity/collection meaning.
- Transaction status interpretation is closed at the adapter boundary. The rerun integrated cases confirm unknown statuses hold while all explicitly supported noncompleted statuses preserve historical completion without inventing a new completion or deleting paid history.
- Source receipt identity, provider event identity, exact object-version certification, financial fact identity and immutable publication identity retain different purposes. The new API/raw/API profile trace confirms that partial receipt compatibility cannot hide a later jointly known profile contradiction after the current watermark advances.
- Ownership and portal authority remain separate: local saved bindings establish the beneficiary; customer-wide management still requires explicit host authorization. Mutation authority reads acquire durable API custody and check the expected bounded read set before dispatch. Profile holds alone do not remove independently established cancellation authority.
- Public host examples retain verified ingress and server reads as financial paths. No browser checkout callback, success navigation or optional Get Modular hook is used as a payment fact or financial delivery mechanism. The known Paddle.js strict-declaration and unpublished Observation release gates remain explicitly separate.
- Normalization preserves selected nullable-field assumptions as an explicit SDK/API trust profile, without extending them to missing quantity. No finding is inferred merely because SDK-mapped API evidence cannot recreate lost original wire fields. Primary Paddle subscription documentation confirms collection mode, item quantity and required nullable current period/price fields; top-level subscription billing cycle is derived from the subscription's prices, so no separate mutable-cycle counterexample was established merely from a synthetically inconsistent duplicate field.

## Reproduction and retained evidence

From `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider`, using the qualified Node directory first on `PATH`:

```sh
export PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres
pnpm install --offline --frozen-lockfile
pnpm build
node node_modules/typescript/bin/tsc -p review-probes/tsconfig.json
node --test review-probes/domain-provider.test.ts packages/payments-core/test/*.test.ts packages/payments-paddle/test/sdk-contract.test.ts tests/integration/reconciliation.test.ts tests/e2e/provider-profile.test.ts
```

Repeat the strict check and final test command with `node-v26.11.1-linux-x64` for the other exact runtime. Both combined test executions used that exact path independently. The strict review project extends the repository checks project, inheriting strict TS7 ownership and `skipLibCheck:false`; no declaration suppression or runtime source edit was introduced.

Retained files:

- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/domain-provider.test.ts`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/tsconfig.json`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/node24-domain-provider.log`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-domain-provider/review-probes/node26-domain-provider.log`

Initial probe construction had a type-annotation typo and then an overstrict assertion requiring `processed` for an intentionally repeated identical API receipt. Both were corrected in probe code before the successful strict check and final 98/98 executions. The receipt's `duplicate` result was correct behavior, not a production defect. An initial install attempted with ambient Node24.19 was correctly rejected by engine policy; the successful frozen installation/build used the explicitly qualified Node24.21.0 path.

## Limits and handoff

This pass does not qualify a real Paddle sandbox account, actual collection/renewal timing, production commercial or credit policy, physical PostgreSQL restore/PITR or HA promotion, every operational gate, unpublished Observation artifacts, or the separately blocked browser wrapper. It does not rerun the full PostgreSQL jobs/fault suite or all other E2E files; those are separately owned gates. The new delayed-provider probe is deliberately provider-neutral; official Paddle HTTP behavior is covered by the actual SDK profile/event/reconciliation suites.

The separate PostgreSQL unchanged-generation reclassification quarantine/cooldown and original-parent T1 admission-fence issues were already disclosed and assigned to that reviewer. They are not duplicated here and are not claimed fixed by this frozen-subject report. Review owner should append the exact final delta SHA and narrow post-integration evidence when that change is available. Concrete domain/provider coverage is complete; no additional optional testing is requested by this result.
