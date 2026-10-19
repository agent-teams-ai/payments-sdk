# Wave 3 independent code review — core/domain

**Frozen revision:** `6a5d2972946bdacdda1d5782659f948d06e06bcd` (`6a5d297`). **Detached checkout:** `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-domain`. **Date:** 2026-10-19 UTC.

## Decision

**Changes requested: two confirmed P2 findings.** No new P0/P1 finding established. Three independently constructed public-runtime traces demonstrate these findings against both the memory reference and the real PostgreSQL adapter. No production source, upstream ADR, provider transport, or existing user project was changed. The only checkout additions are the retained review probes.

Read `AGENTS.md`, the core money/operations/evidence/reconciliation portions of `docs/implementation-plan.md`, Q 1.1.2, and the wave-1 core and wave-2 domain reports. Reviewed `packages/payments-core/src/{contracts,values,reducer,runtime,memory,reconciliation}.ts` and the PostgreSQL working-set/commit seams needed to establish whether the failures survive the durable implementation. The prior pinned-subject, authority-read CAS, exact receipt custody, historical version certification, stale ownership publication, and audited payment-update binding fixes are present; the findings below do not repeat them.

## Verification

Offline frozen dependency installation and the complete workspace build passed on Node 24.21.0. The retained probe project passes strict TypeScript checking. All **45 existing core/reconciliation tests** and all **6 independent probe executions** pass on **both Node 24.21.0 and Node 26.11.1**: **51 passed, 0 failed per runtime**. The probes intentionally assert the defective behavior; their passing result is reproduction evidence, not acceptance of that behavior.

Retained files:

- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-domain/review-probes/domain.test.ts`
- `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-domain/review-probes/tsconfig.json`

Commands from the detached checkout, with the corresponding Node floor first on `PATH`:

```sh
pnpm install --offline --frozen-lockfile
pnpm build
node node_modules/typescript/bin/tsc -p review-probes/tsconfig.json
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test review-probes/domain.test.ts packages/payments-core/test/*.test.ts
```

The final test command ran independently with `/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin` and `/workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin`. Each PostgreSQL trace creates and removes its own schema. The neutral provider is an ordinary core-owned contract implementation; inputs retain exact authenticated representations with matching digests. No live provider credentials, charges, or network mutation were used. The full PostgreSQL jobs/recovery baseline, real SDK transport suite, consumer suite, and release qualification remain separately owned gates; this report claims real PostgreSQL proof only for its six executions.

## 1. P2 — Changes to duplicate-initial knowledge and selected stream do not invalidate dependent renewal evidence

**Primary locations:** `packages/payments-core/src/reducer.ts:149–152`, `markDuplicates`; `packages/payments-core/src/runtime.ts:331–345`, `selectSubscriptionStream`.

**Related contract/load locations:** `reducer.ts:126–128` defines renewal eligibility from selected stream and known duplicate initials; `memory.ts:132–135` and `payments-postgres/src/store.ts:386–399` load initial/one-time completions for an intent, excluding existing renewals. `runtime.ts:347–351` repairs only recorded inbox/publication obligations.

### Trace A: a late duplicate leaves an acknowledged renewal unheld

The first retained test, `review-probes/domain.test.ts:60–75`, uses the supported audited unknown-retry path to establish two provider transaction bindings for one monthly intent. It then performs this sequence:

1. Process completed initial A for subscription stream A.
2. Process a valid completed recurring transaction for A's next period. It has an immutable completion, no flags, and is delivered and acknowledged.
3. Process the delayed completed initial B for the same intent and stream B.
4. Call ordinary `repair()`.

Both initial completions now carry `duplicate_initial_purchase`, but the existing renewal A still has **no flags**, the **same evidence revision**, **no new delivery**, and **no publication work item**. Reobserving that exact renewal at its original version through a distinct compatible receipt immediately adds `duplicate_initial_purchase`. Thus new financial information changes the classifier's answer, but the durable evidence remains the earlier answer until an unrelated reobservation happens.

`markDuplicates` deliberately selects only initial/one-time completions. It never invalidates the dependent renewal even though `classifyCompletion` consults those initial flags when deciding the renewal's hold. The store's bounded working set also excludes those renewals, so this is not repaired accidentally by PostgreSQL loading a complete scope ledger.

### Trace B: selection cannot redrive an old hold, and reselection cannot restore it

The second retained test, `review-probes/domain.test.ts:77–91`, establishes both initial streams and a held completed renewal for B. It then:

1. Successfully selects B through `selectSubscriptionStream` with the exact expected read set and audit metadata.
2. Calls `repair()`. Renewal B remains held; no dependent renewal publication obligation was saved.
3. Explicitly calls `flushPublication({ type: 'transaction', id: 'renewal-b' })`. The existing classifier now removes the hold.
4. Successfully selects A with a fresh expected read set and audit metadata, then calls `repair()`.
5. Renewal B remains **unheld with unchanged evidence revision**, although it now belongs to the unselected stream.
6. Explicitly flushing that transaction again restores `duplicate_initial_purchase`.

The current existing regression manually calls `flushPublication` after selection (`packages/payments-core/test/core.test.ts:223`). It demonstrates that replay can calculate the new answer, but it does not establish a durable obligation to perform that replay or to revisit the formerly selected stream. A caller cannot safely discover every affected transaction by guessing IDs.

### Impact

The plan requires pending/review/conflict changes to create durable evidence/publication obligations, independently of a fresh provider delivery (`docs/implementation-plan.md:174–176`). It also requires a renewal to come from the selected stream and holds ambiguous bindings (`:219`, `:223`, `:237`). Both demonstrated transitions change information that the classifier itself uses, yet downstream payment evidence can indefinitely remain either falsely unheld or unnecessarily held.

This report does not claim an automatic second credit grant in the reference consumer. That owner has additional independent guard/selection policy. The concrete core defect is arrival-order-dependent and repair-incomplete evidence: replaying unchanged saved provider facts can alter the published disposition because a committed dependency change was never propagated.

### Minimal faithful fix and regression

Commit a **core-owned durable reclassification obligation** when duplicate-initial knowledge or technical stream selection changes. It needs a binding/decision revision and a resumable bounded cursor over dependent transaction references. Process bounded pages using the existing `reduceObservation` / `classifyCompletion` rule and normal publication commit; do not copy the classifier into the database adapter.

The dependency fanout can grow without bound. Do not expand `includeIntent` into an unbounded transaction archive or load a prefix and treat it as complete. Each page must validate the relevant binding/decision and membership read set and commit its publications plus cursor atomically. A concurrent selection or membership change must invalidate/restart the old pass, while newly admitted renewal evidence must classify against the latest binding state. Durable obligations remain authoritative; PostgreSQL job transport is only a wakeup. The memory reference must implement the same observable protocol.

Keep both retained sequences against both stores and on both Node floors. Assert eventual higher immutable evidence revisions after ordinary durable repair, with no new provider event and no caller-specified transaction flush. Include selection A→B→A and a restart/interleaving between pages. This is an invariant-driven extension of the existing owner-local boundary, not a need for a global repository or cross-owner transaction.

## 2. P2 — An exact-version adjustment parent contradiction leaves the original affected transaction's accepted refund unheld

**Primary locations:** `packages/payments-core/src/reducer.ts:54–61`, `certifyObjectVersion`, and `:225–233`, `reduceObservation`'s conflict path.

**Related load/repair locations:** `memory.ts:131,140–147` and `payments-postgres/src/store.ts:381–384,407–425` load the exact version evidence but only route the incoming adjustment's transaction. `runtime.ts:210–212` publication replay visits transaction observations, not the saved adjustment evidence whose certification has become conflicting.

### Reproduction

The third retained test, `review-probes/domain.test.ts:92–109`, creates two ordinary one-time purchases A and B and confirms both. It uses **distinct authenticated receipt IDs and no shared provider event ID**, exercising the newly added object/version guarantee rather than the already fixed event-envelope identity path:

1. Process approved full refund adjustment `adjustment`, version V, parent transaction A, with the exact full amount and a full allocation to A's line.
2. Deliver and acknowledge A's unheld adjustment evidence.
3. Process a second authenticated receipt with the **same adjustment identity and exact version V**, now claiming parent transaction B.
4. Call `repair()`.

The durable `versionEvidence` summary correctly becomes conflicting because its retained original projection names A and the new projection names B. Transaction B receives `conflict`. **Transaction A keeps its accepted approved full refund with no conflict flag, unchanged evidence revision, and zero new delivery.** Even explicitly flushing A's publication does not discover the now-conflicting adjustment certification.

This behavior reproduces in real PostgreSQL, so memory is not masking an adapter problem. The old parent is not unknowable: the loaded certified summary already contains `projection.transactionRef` for A. The conflict handler nevertheless picks only `observation.transactionRef` from B.

### Impact

The plan requires a contradiction at an equal object version to produce conflict/reconciliation (`docs/implementation-plan.md:229`) and known affected aggregate review changes to reach durable evidence rather than remain local (`:174–176`). Once the producer knows the same identified adjustment has incompatible parent relationships, continuing to serve A's refund as unheld financial evidence silently omits a known contradiction. A consumer that has acknowledged A cannot learn about it from the B feed and may belong to a different buyer/owner scope within the application.

The immutable original refund should remain retained; the finding does not ask to erase it, invent a reversal, pick B as correct, or treat API snapshots as raw-byte-equal. It asks that both established routes receive the explicit uncertainty that the producer has already recorded for their shared adjustment identity/version.

### Minimal fix and regression

Before reducing a contradictory exact-version adjustment, include both the **previous certified parent** and the **incoming parent** in the bounded owner-local working set and expected read set. Persist the version conflict, flags, publication obligations/evidence, and inbox disposition atomically for both routes. This is bounded two-parent fanout, comparable to the existing event-identity conflict protocol; it does not require scanning the complete inbox. Preserve the original certified projection and both immutable receipts.

Ensure that late compatible evidence or restart cannot clear the conflict accidentally. Retain the acknowledged-A → contradictory-parent-B trace and reverse arrival order, including equivalent RFC3339 spellings of V. Assert higher conflicting evidence for **both** parents after ordinary repair. Historical summary size holds must likewise retain sufficient bounded route identity to avoid silently losing a known affected parent.

## Reasoned non-findings and scope limits

- The reviewed source dependencies point inward. Core contracts/runtime import no Paddle, SQL, Get Modular, product entitlement or credit implementation. The ordinary factory remains an appropriate composition boundary. No style-only SOLID/DRY change is proposed.
- Normal settlement and audited successful binding now use the same successful-outcome rule, including bounded transaction identity, intent validation, and payment-method/recovery purpose. The existing regressions verify early evidence reclassification and invalid proof rejection. I established no additional concrete outcome-binding defect.
- Subscription mutation commands retain their pinned provider subject across retries. The preflight path rejects retained ownership contradictions and validates a fresh authority read set at the dispatch marker. Existing mismatch, CAS interleaving, and quarantined-acquisition regressions pass on both runtimes. Commercial eligibility holds alone correctly do not remove independently established cancellation authority.
- Exact-version summaries compare historical subscription/adjustment evidence after watermark advancement and preserve compatible partial knowledge and precise timestamp equivalence. The new second finding is specifically the omitted **original parent route** when the exact-version contradiction changes that parent; it does not repeat the fixed current-only comparison defect.
- Oversized certification creates bounded held tombstones and incomplete-history evidence while preserving receipt custody. Evidence overflow uses a bounded control envelope. No new generic truncation or normal-profile overholding finding was established.
- Reconciliation now durably saves immutable query/cursor state, validates acquired page custody, preserves failed cursors for explicit redrive, and does not claim complete provider history from query exhaustion. I established no new reconciliation finding; the separately fixed PostgreSQL 200-item scan admission path is not reported again.
- Optional unpublished Get Modular hooks are projections and remain separately gated. They were not treated as financial transport. The review does not claim provider sandbox qualification, consumer accounting ownership approval, production recovery qualification, or full release acceptance.

**Acceptance remains blocked on the two concrete P2 corrections and their focused durable regressions.** The existing 45 passing core/reconciliation tests do not exercise these sequences.
