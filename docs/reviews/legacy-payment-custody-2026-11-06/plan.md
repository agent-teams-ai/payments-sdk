# Payments SDK — scoped legacy and architecture refactor

Date: 2026-11-06
Base: main at 6fdcf6070b4c86393ac5484b83867e83f4fa997d
Status: execution plan, preliminary critical passes recorded; exact-head CI and independent reviewers still required.

## 1. Goal and baseline

Reduce demonstrable legacy and accidental responsibility concentration without changing payment contracts or inventing new frameworks. The requested 10k–20k line scale is an upper review/change budget, **not** a target to fill with churn. This repository currently has 117 package source files, approximately 513 KB of TypeScript source, four already independent delivery packages and an adopted Feature Module Standard v1.1. It is not an unmodularized legacy monolith.

Authoritative guidance: AGENTS.md, accepted docs/implementation-plan.md, docs/architecture.md, docs/developer-stack.md, docs/feature-module-adoption.md, local architecture/feature-module-standard.json and central Engineering Quality Standard. The accepted architecture, existing ADRs and evidence are not editable as a side-effect of refactoring.

Four package owners:
- payments-core: provider/storage-neutral operations, verified evidence, financial semantics and consumer ports.
- payments-paddle: official Paddle SDK, provider interpretation and webhook signature custody.
- payments-postgres: SQL transactions, durable input/operation/reduction, delivery and recovery mechanisms.
- payments-get-modular: optional composition and read-only projections; never a financial delivery owner.

Current baseline includes supported Node 24.22.1/26.12.1, TS 7.0.2+, PostgreSQL 18 and pnpm 11.25.0. The repo has packed consumer and real Postgres/E2E suites. Prior green checks are historical evidence, not qualification of this refactor.

## 2. Concrete findings and priority

| Finding | Source evidence | Decision | Priority | Risk |
| --- | --- | --- | --- | --- |
| The Postgres PaymentStore facade delegates operations, inputs and reductions, but directly implements consumer registration, bounded backfill, delivery listing and ACK | packages/payments-postgres/src/features/payment-custody/adapters/store.ts; existing PaymentOperationCustody, PaymentInputCustody, PaymentReductionCustody | Move the existing four delivery methods to one private PaymentDeliveryCustody using the same PaymentStoreContext and SQL calls; keep facade and public PaymentStore unchanged | P1 | Concurrency, ACK/replay |
| The same facade directly handles bounded subscription reclassification | store.ts processReclassification; records/guards and durable work | Move that method to one private PaymentReclassificationCustody, preserving locks and statements verbatim | P2 | Cross-input classification and progress |
| Existing source already has Feature Module Standard enforcement and named composition/public entrypoints | architecture/feature-module-standard.json; docs/feature-module-adoption.md | Reuse these boundaries, no new package/module-framework migration | Keep | Low |
| Large payment reducers, Paddle provider and recovery internals are sensitive and already have split ownership | core domain, provider/observations, recovery/state/evidence | Do not rewrite without a specific proved fault or responsibility violation | Excluded for now | High |
| Existing PRs #29/#30 are disposable negative tests and explicitly say do not merge; #18 is a separate dependency update | live GitHub PR metadata | Do not reuse their branches or integrate unrelated changes | Out of scope | High |

Neither file size nor number of classes proves legacy. Existing public re-export shims are supported package surfaces until proven otherwise; do not delete them merely because they look redundant.

## 3. Scope rules

**In scope (confirmed):**
1. Private adapter-local responsibility extraction, with one shared transaction/record/queue context.
2. Mechanical delegation from PaymentStore; no new public exports.
3. Tests that exercise existing delivery/backfill/ACK and reclassification guarantees, adding focused regression cases only for identified blind spots.
4. Review, exact-head hosted checks, packed consumers, PostgreSQL integration and E2E evidence tied to the PR head.
5. Fix material findings within the same private adapter boundary, pushing each coherent commit.

**Explicitly out of scope:**
- No changing core financial state machines, provider API, schema, migrations, serialized evidence, revisions, fingerprinting, grant IDs or retry policy.
- No renaming public packages, import subpaths, function signatures, environment requirements or capability contracts.
- No changes to Paddle interpretation, HTTP authentication, pricing/credits, external accounting or Get Modular adoption.
- No refactoring fixtures merely to inflate the diff; no cleanup of frozen evidence or accepted plans.
- No speculative DI container, repository base class, generic transaction DSL, event bus, feature flags or new dependencies.
- No changes to unrelated PRs and no production charges, credentials or live customer tests.

An adjacent issue enters scope only after it is reproduced or supported by source evidence, and must preserve its existing owner. If uncertain, **preserve it and record the doubt**.

## 4. Invariants (all must survive)

1. Lock order and transaction boundaries are unchanged: registration, backfill cursor, delivery lock, ACK and work obligation must commit under the original owner-local Postgres transaction.
2. Concurrent ACK cannot be reopened by an older backfill page; duplicate ACK reasserts complete without re-delivering an effect.
3. Backfill stays bounded, durable and resumable; no unbounded page or runtime-owned in-memory cursor.
4. Delivery proof uses messageId and bodyDigest; wrong digest and unknown target never acknowledge.
5. Recovery fence prevents delivery where the existing logic prevents it; no bypass during migration.
6. Reclassification preserves decisionRevision, source membership guard, working-set bound, cursor, publication work obligations and existing T2 isolation.
7. One external mutation per durable dispatch marker; uncertain outcomes do not get automatic retry.
8. No leakage of DB/provider DTOs to core public contracts; no cross-context transaction.
9. Public artifacts, package export maps and strict NodeNext/Bundler consumers remain unchanged.

## 5. Implementation sequencing and gates

### Phase 0 — inventory, plan and baseline
- Read contributor/central rules and accepted decisions; inspect package/source topology, existing CI, current open PRs, and relevant existing tests.
- Establish baseline SHA and record scope/risk; never use historical checks as new completion proof.
- Review this plan from financial-correctness, architecture/minimalism and verification perspectives before code.
- Push plan to isolated branch and open draft PR. No edit to main.

### Phase 1 — delivery custody extraction (P1)
- Create one private adapter PaymentDeliveryCustody that owns registerConsumer, backfillConsumer, listDeliveries and acknowledgeDelivery.
- Reuse PaymentStoreContext, canonical identity, and original SQL/locks/return values.
- Replace original methods in PostgresPaymentStore with exact typed delegations. Do not alter the PaymentStore interface.
- Verify extracted method bodies mechanically; no data migration or behavior change.
- Push a coherent commit. Check typecheck, FMS boundaries, real Postgres delivery/ACK tests and E2E.

### Phase 2 — reclassification extraction (P2)
- Create private adapter PaymentReclassificationCustody that owns processReclassification, keeping its existing transaction, lock ordering, bounded working set and work queues unchanged.
- Delegate unchanged PaymentStore API method and remove unused imports.
- Push coherent commit. Check existing reclassification/concurrency/selection fixtures and complete suite.

### Phase 3 — test gaps only if evidence requires
- Add explicit regression tests when existing suites do not cover late ACK versus backfill, duplicate ACK after restart, stale binding decisions, cursor continuation or recovery fence.
- Prefer real PostgreSQL and end-to-end acceptance; unit tests only for isolated pure-state hazards.
- Avoid extra test scaffolding unless an independently asserted outcome cannot otherwise be checked.

### Phase 4 — critical review and hardening
- Review exact PR diff from independent perspectives: architectural owner/boundaries, payment correctness/SQL concurrency, failure recovery, public compatibility and packaging.
- Request available independent external review; do not misrepresent one self-review as multiple models.
- Triage severity; fix only material scoped issues and push immediately. Repeat until no material findings remain.
- If reviewers identify a correctness problem requiring a public contract or schema migration, stop that **part** and document a separate scoped successor rather than silently expanding this refactor.

### Phase 5 — exact-head qualification, merge, post-merge
- Required: strict TS/Node toolchain, lint/FMS/quality checks, core/Paddle/Get Modular/Postgres suites, real Postgres 18 integration, complete E2E/consumer replay/recovery, packed NodeNext/Bundler consumers and release dry run.
- Verify GitHub Actions job conclusions on the exact final PR SHA and branch protection/review state. A queued or failed job is not a pass.
- Recheck package exports, lockfile/ABI unchanged and diff limited to accepted paths.
- Merge safely only after required checks and substantive review; use squash if permitted. Verify fresh main SHA and post-merge qualifying CI before declaring end-to-end completion.

## 6. Risk / test matrix

| Hazard | Existing witness to reuse | Required result |
| --- | --- | --- |
| ACK/backfill race | payments-postgres .../jobs.test.ts, test near concurrent backfill/ACK | ACK remains complete after replay |
| Wrong digest, repeated ACK, held evidence | .../durability.test.ts and consumer-protocol.test.ts | conflict / duplicate, no duplicate effects |
| Reclassification work under changing binding | payments-postgres .../reclassification.test.ts | stable decision, cursor and publication obligations |
| Postgres durability/locks/worker recovery | .../durability.test.ts, .../jobs.test.ts, tests/integration/recovery.test.ts | identical transactional and recovery outcomes |
| Full buyer purchase to independent T3 consumer | tests/e2e/full-system.test.ts, consumer-protocol.test.ts | no double grants, no contract change |
| Contract/packaging | tools/test/boundaries.test.ts, packed consumers | unchanged exports and strict compile |

## 7. Critical passes on this plan (not independent external-agent results)

- **Pass A — architecture/minimalism.** Initial idea to split every store method and to add a separate scan-custody abstraction was rejected: scanning is small and not a demonstrated debt. Scope reduced to delivery and reclassification responsibility, with existing PaymentStoreContext.
- **Pass B — finance/concurrency.** A generic CRUD repository or shared transaction helper would obscure lock sequencing and same-transaction ACK. Rejected. Require verbatim SQL/lock structure and existing concurrent Postgres tests.
- **Pass C — skeptical verification.** Source reshuffling alone does not prove safety; exact-head hosted Postgres 18, packed consumer and full-system E2E checks are mandatory. No claim of tests until logs confirm. The plan explicitly protects negatives PR #29/#30.
- **Pass D — compatibility.** Removing re-export surfaces, changing providers or financial contract vocabulary would multiply migration risk. Rejected; only internal classes and facade delegations.

These are structured local critical perspectives, **not** a claim that independently launched xhigh reviewers have executed. An actual independent review is still an acceptance gate.

## 8. Estimates, stop conditions and evidence

Expected implementation footprint: roughly 250–450 moved source lines, 20–70 lines of facades/imports and, only if test gaps exist, 80–250 lines of focused assertions. Net new complexity should be small; there is no justification to touch 10,000 lines merely to meet an arbitrary count. If the first slice surfaces broad behavior coupling, narrow the change rather than multiplying adapters.

Stop/revert a slice if it changes serialized payloads, lock order, transaction ownership, public API, or test semantics unexpectedly; if the broad suite fails with an unexplained regression; or if it requires a new architecture or dependency not approved by the existing owner. Preserve uncertain legacy, record candidate debt and avoid speculative deletion.

Evidence to record per commit: SHA, mechanically checked diff, scope review, exact test commands and CI run URLs/conclusions, findings and resolutions; final merged main SHA and post-merge checks. A draft PR remains draft while these gates are incomplete.
