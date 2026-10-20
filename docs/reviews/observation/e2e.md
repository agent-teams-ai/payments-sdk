# Independent review: observation candidate E2E and lifecycle evidence

Reviewed code: `340641f26e0cd71b049c14cdd8b57a012b7387f3` against base `1080854` in `implementation/payments-observation-candidate`. The working tree was at documentation successor `1ae8f89f2d6e8f810d7d2edc5be86630a8e46d8b` when initially inspected; `git diff 340641f -- qualification/observation tools/qualify-observation.ts` was empty. Remediation recheck subject: `66011e3c3eb99d65ea30d9c4c02a79ff046ecbbe`. Upstream source inspected at `c5c314ab98c57d2c73448f0c3c9860424a993d8a`.

## Result

One actionable **P2 validation gap** in the reviewed commit: the post-close Commercial Access assertion does not establish that renewal advanced access. I found no demonstrated financial or projection runtime defect in the reviewed implementation. The independent Q100/T25/renewal-Q100 credit evidence is substantive, and the optional observation implementation preserves the intended ownership boundary.

**Remediation recheck: addressed in `66011e3c3eb99d65ea30d9c4c02a79ff046ecbbe`.** I independently reread the committed diff and surrounding scenario. `financial.test.ts:161-164` retains `newAction === true` and adds exact independent literals for both `renewedAccess.paidUntil` and `renewedAccess.knownLastPeriod.endsAt`. These now require the access owner to persist the newly paid December-ending period; stale October access can no longer satisfy the oracle. The five-line diff changes only this test assertion and does not expand the feature or weaken another check. No material source-review findings remain open. The parent owns the Node 24 full gate and Node 26 candidate rerun and binding new execution evidence to that change. The detailed finding below records the original reviewed commit.

This was a read-only source and retained-evidence review. I did not run the runner, pack packages, modify source/tests, create commits, contact a live payment service, or use the disposable database. The Node 24.21.0 and 26.11.1 reports/logs each record four passing tests, zero skips, both strict TS 7.0.2 resolution profiles, and the five retained upstream candidate identities. Those are inspected existing execution results, not an independent rerun.

## Finding

### P2 — Assert the access owner's renewed period after all projections close

Location: `qualification/observation/financial.test.ts:148-165`, especially line 161. Supporting locations: `qualification/observation/test-support.ts:52` and `tests/fixtures/consumers/access.ts:48-64`.

The scenario closes both projection scopes, ingests the next monthly transaction, delivers it independently to credit and access, and asserts the new credit outcomes. Its final access oracle is only:

```ts
assert.equal((await world.access.decisions())[0]?.body.newAction, true);
```

That same property is already true at line 51 before projections are constructed. `durableWorld()` fixes the access clock at `2026-10-15T00:00:00Z`, so the unchanged October paid period would still authorize new actions. A renewal delivery that took custody and ACKed without advancing access's paid-period decision could therefore pass both this assertion and the empty producer delivery queue at line 165. The queue proves delivery custody; it does not establish the access-policy effect.

The fixture's existing behavior derives `paidUntil` and `knownLastPeriod` from the latest paid completion (`access.ts:48-59`). A small targeted assertion should require the retained decision's `paidUntil` and `knownLastPeriod.endsAt` to equal the explicit renewal end, `2026-12-01T00:00:00.123456Z`. Selecting the decision by its buyer/binding identity would also make the asserted row explicit. This is an additional outcome assertion in the existing scenario, not a request for another scenario or a policy feature.

This finding narrows only the claim that post-close renewal is verified all the way through the access-owner effect. The credit renewal effect is already verified independently.

## Why the primary financial oracle is meaningful

| Guarantee | Evidence and assessment |
| --- | --- |
| Hooks are absent for initial financial delivery | `financial.test.ts:33-51` completes the purchase, verified input/T1, T2 reduction/publication and owner-local T3 before composition starts. The initial credit decision explicitly requires included/allocated/eligible/held = 100/100/100/0. |
| Lost producer ACK does not duplicate the grant | `financial.test.ts:39-49` commits consumer receipt/effect without sender ACK, observes remaining sender custody, constructs a new `CreditFixture` over the same independent schema, and requires duplicate receipt outcomes on replay. The final exact grant count also covers the replay. `ConsumerOwner.atomic` commits before `receive()` resolves (`owner.ts:83-93`); its persisted duplicate receipt branch is at `owner.ts:136-138`. |
| Credit policy is independently owned | The candidate imports the existing fixture rather than embedding a view-side ledger. `credit.ts:9` independently fixes Q=100 and T=25; its own basis grouping and effect generation appear at lines 16-31 and 94-138. Production projection code never imports this fixture or these quantities. |
| Failing optional listener is contained | `financial.test.ts:105-108` installs a real throwing subscription and observes the exact thrown cause. It remains alive during the top-up and explicit refresh. `lifecycle.test.ts:24-38` additionally verifies source/subscription/revision/cause and future delivery after failure. This is a throwing subscription test; it does not pretend the render callback is a durable delivery mechanism. |
| Top-up is separate from included quota | `financial.test.ts:110-136` starts one intentional one-time purchase, processes its actual packed provider/core/store path, delivers to independent owners, and requires included 100 versus purchased 25, both held=0. The projected completed top-up identity/classification/total is independently checked against literal expected values; durable `factId` equality ties it to the actual stored fact. |
| Closed optional views cannot be financial prerequisites | Both child projection scopes close before renewal (`financial.test.ts:138-151`). Credit eligible totals must then be included=200 and purchased=25 with no held amounts; persisted effects must include exactly three grants and net 225 (`financial.test.ts:154-160`). These are effect and allocation assertions, not merely grant-row counts. |
| Only two intentional checkout calls occur | The two declared SDK transaction POST handlers count one initial and one top-up (`financial.test.ts:28-34,110-122`). The repeat initial request returns the same intent and count remains two after close (`162-163`). The transport disables unmatched network access (`test-support.ts:25-40`), and the projection only receives the read capability. The counter establishes handled expected dispatches; it is not a generic audit log of every rejected unmatched HTTP attempt. No source path in this candidate gives the projection mutation authority. |
| Owners retain separate delivery custody | Credit and access are registered separately, use independent schemas/transactions, and are delivered and ACKed separately. Initial access being true after its own delivery also prevents a credit ACK from silently satisfying the initial access target. Final queues are checked independently. The access-renewal effect gap is the finding above. |

## Lifecycle and read ownership assessment

`projection.ts:5-6` restricts the supplied payment capability to `Pick<Payments, 'readPurchase'>`. The Assembly display receives only `ProjectionView` plus its renderer; the projection commands remain a separate contract (`composition.ts:20-28,46-79`). Neither store nor provider DTOs are used as financial commands.

Selection copies and validates buyer/intent before storage (`projection.ts:47-52,126-134`). The output is synchronously invalidated to loading, or idle when cleared, before selection returns. The financial test proves a second run requesting another buyer cannot see the first buyer's purchase (`financial.test.ts:77-103`), and the lifecycle test proves the latest selected query is the one published (`projection-lifecycle.test.ts:42-68`). These checks accompany actual store-side buyer isolation (`payments-postgres/src/store.ts:600-610`); they are not a claim that a Get Modular facet is an authorization sandbox.

The summary clone is finite and detached. `projection.ts:59-78` copies the retained public shape with `structuredClone`, so nested offer data, totals and arrays do not become borrowed objects that the observation store freezes. `financial.test.ts:92-101` checks that the borrowed public result remains mutable, while the projected result is frozen and unaffected by caller mutations.

The async loader awaits the complete borrowed read promise and checks abort after it settles (`projection.ts:103-112`). It does not race the read against supersession. The installed upstream `LoadRegistration` serializes active and pending work, keeps the latest pending job, checks the source revision before publication, and drains its active promise on close (`get-modular-source/packages/observation/src/features/store/load.ts:79-81,92-141,144-160`). These source guarantees support the observed stale-result and cleanup behavior.

`projection-lifecycle.test.ts:13-58,80-97` uses explicit deferred barriers to hold an obsolete read port through its cleanup and to hold a closing port through its cleanup. It proves no successor starts while the old port promise remains unsettled, maximum concurrency is one, close remains incomplete until cleanup is released, obsolete ready results are not delivered, subscriptions detach, and the borrowed pool remains usable. Error sanitization and explicit-only retry recovery are checked at lines 69-78. No fixed sleep is used as a correctness oracle.

Two limits are worth preserving when describing this evidence; I do not classify either as another material defect:

- The real PostgreSQL `readPurchase()` at `projection-lifecycle.test.ts:28` has already completed before the held barriers at lines 30-35. The test proves settlement of the complete borrowed port promise, including its explicitly modeled temporary cleanup, beside real PostgreSQL reads. It does not hold an actual SQL query or PostgreSQL transaction in flight, and should not be cited as a database blackhole/cancellation test. The comments at lines 26-27 already state this distinction.
- The `states` array is populated by a coalescible watcher (`projection-lifecycle.test.ts:40,54,64,95`). It establishes observed callback history and settled output, rather than a lossless history of every store write. The synchronous invalidation assertion and upstream revision guard provide the stronger source-backed basis for stale-publication suppression. The README correctly documents coalescing and does not make the view an event log.

Scope cleanup tests also verify read/watch gap catch-up, synchronous registration without immediate callback, later-task delivery, callback failure attribution, subscriber-close detachment, source-close diagnostics and rejected reads after source close (`lifecycle.test.ts:18-57`). Sibling scopes stay usable after closing the first projection, and both scope closes leave the host pool usable (`financial.test.ts:138-146`). The full financial scenario's subsequent successful T1/T2/credit T3 is stronger evidence that projection cleanup did not stop the borrowed runtime than a read alone, since the core intentionally still permits store reads after `stop()`.

## Installed boundary and deterministic execution

The runner fails without `DATABASE_URL` before execution (`tools/qualify-observation.ts:38`), and `durableWorld()` independently fails without it and checks PostgreSQL major 18 (`test-support.ts:45-56`). There are no absent-database skips in these four tests.

The runner hashes and checks all five upstream archives before installation, installs actual packed core/Paddle/Postgres packages, omits the older payments Get Modular adapter, preserves strict peers, copies the existing independent fixtures, typechecks both strict resolver profiles with `skipLibCheck:false`, and executes all four copied tests (`tools/qualify-observation.ts:45-117`). The identity test checks actual resolved physical peer paths and absence of both the old adapter and development tooling (`identity.test.ts:7-20`).

The reports expressly retain `unpublished-upstream-candidate`, `npmPublicationProven:false` and `productionAdmission:false`. The implementation and its evidence therefore remain a candidate consumer qualification, not proof of published-release adoption. No wider financial correction/recovery regression suite needs to be duplicated in this change; the existing SDK E2E/consumer suites own those cases.

## Review constraints

I read both repositories' `AGENTS.md`, the candidate files named in the assignment, public SDK/provider/store paths, existing consumer fixtures and the relevant full-system tests. The organization policy URL was unavailable through the web reader; I read the identified retained copy at `get-modular-source/research/module-resources-2026-10/raw/evidence/module-resource-contract-20261001/inputs/engineering-quality-standard.md` instead. This review does not claim that retained copy verifies the current remote policy revision.
