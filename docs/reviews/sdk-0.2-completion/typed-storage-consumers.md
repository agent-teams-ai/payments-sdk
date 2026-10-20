# Independent review: typed-lint storage, consumers and Get Modular delta

## Result and source binding

No new P0, P1 or P2 contradiction established in the assigned delta.

- Repository: `/workspace/scratch/9e36ca3bbd13/implementation/payments-delivery`.
- Review base: `de5324cb09259fe74514f3421f6e340672a74e31` (curly-only changes and typed-preset activation already present).
- Final reviewed head: `95e996ff0bbe8edb003fcd42ab66c6aa429a7253`.
- Relevant implementation commits: storage `10899c6`, adapter/GM `6fcfe4e`, fixtures/E2E `6769d12`, host/tool integration `bc463fc` and documentation `95e996f`.
- Final head and clean worktree were read back independently. The final GM test adjustment in `bc463fc` is included.
- Scope: PostgreSQL persistence/lifecycle implementation and tests; independent consumer fixtures and E2E/integration assertions; Get Modular runtime edits, tests and observation type probes. Core/provider business algorithms and the Foundation production policy were assigned to another reviewer and are not certified here.

This is an independent read-only source review. I did not author or modify maintained source, run an install/build, take a database lease, run database tests or rerun the owner's full gates. No runtime probe was needed to substantiate a concrete remaining defect. Successful builds/lint/typechecks reported by the task owner are not represented as independently executed evidence in this memo.

## Authority and review basis

Read the repository `AGENTS.md`, `docs/developer-stack.md`, relevant accepted-plan storage/consumer/observation sections, `docs/architecture.md`, and the PostgreSQL and Get Modular package guides. Read the retained Q source (`research/continuation/sources/q-5f1b5aef.md`) and current organization baseline (`research/continuation/sources/org-quality-5499550.md`), preserving local accepted ownership and qualification decisions.

The decisive contracts are owner-local T1/T2/T3, complete read-set validation, stable immutable evidence, durable held custody, no redispatch after an unknown marker/COMMIT, borrowed-pool lifetime, optional read-only hooks, and independent expected results. Sources: accepted plan sections 5 and 10; `docs/architecture.md:33-96,137-151`; `docs/developer-stack.md` Drizzle boundary and implementation obligations; PostgreSQL guide sections on repair, shutdown and recovery; Get Modular guide sections on capability facets and observation.

## Examined risks and counterevidence

### PostgreSQL record typing and SQL execution

`PaymentRecords.read/readMany` now return `StoredRecord<unknown>` instead of taking an unconstrained return-only type parameter. The caller assertions in `store.ts`, `recovery.ts` and `jobs.ts` retain the corresponding old generic body types; these assertions introduce no runtime decoder or changed transaction scope. The schema/query-builder implementation stays adapter-private. No Drizzle type becomes a core or public SDK contract. Sources: `packages/payments-postgres/src/records.ts:62-77`, `src/schema.ts`, `src/index.ts`, and the base-to-head diff of the named consumers.

The extracted lock comparator preserves the inbox-before-versionEvidence-before-other rank and canonical tuple tie-break. `keys.toSorted(...)` replaces sorting an existing copied array, leaving lock-name construction, deduplication, maximum bound and ordered advisory-lock SQL intact. Configuration row locks, T1 route/version lock phases, complete T2 expected-read-set loops, immutable-output checks, obligation transitions, backfill cursors and recovery scans remain in the same owner transactions. Sources: `records.ts:23-26,41-59,114-170`; `store.ts` admission, operation commit, reduction load/commit, backfill and checkpoint methods; `recovery.ts` uncertainty/backfill/verification methods.

The `JSON.stringify` temporary's type change retains the exact runtime string-or-undefined value, byte batching threshold and explicit jsonb parameter. `namespaces.at(0)` is equivalent to index zero on the dense array produced by `Set`. Sources: `records.ts:84-110`, `store.ts` reduction commit. Neither was treated as proof of PostgreSQL runtime behavior; the real integration gates remain necessary.

`database.ts` preserves the connection ownership protocol and COMMIT phase: an unconfirmed COMMIT still destroys its checkout and raises `commit_unknown`; it cannot authorize dispatch. The connection error listener extraction, `destroy` callback braces and multi-result row assertion preserve runtime calls. Sources: `packages/payments-postgres/src/database.ts:76-161,163-202`; `test/durability.test.ts` lost-COMMIT and blackholed-socket scenarios.

### Jobs, diagnostics and declaration augmentation

The diagnostic type view aliases the same events object and invokes `sink.onError(error)` as a method, preserving its receiver. Both synchronous exceptions and rejected/throwing thenables remain contained through `try` plus `Promise.resolve(report).catch(...)`. The shutdown wrapper now consistently supplies an `Error` when a rejection is a non-Error. Sources: `job-transport.ts:17-25`; `jobs.ts:282-300`; unchanged retry/quarantine assertions in `test/jobs.test.ts`.

The new `isStopRequested()` function reads the existing mutable closure after awaited startup/repair. It does not snapshot the flag, move the stop check or replace the active-call/debt owner. Admission tracking, startup terminality and physical core drain remain intact. Sources: `jobs.ts:229-300` and `drain()`; partial-startup and physical-SDK-debt tests.

Changing the augmentation edge from a side-effect import to `export *` continues to evaluate/include `pg-boss-declarations.js`. That module contains an import type and module augmentation with no exported runtime API, so this does not forward vendor internals into the SDK. Sources: `src/index.ts:12`, `src/pg-boss-declarations.ts`; packed strict-consumer qualification remains a separate owner gate.

### Consumer fixture custody and policy boundaries

Envelope decoding now establishes object/primitive guards on unknown records before the local envelope assertion. Producer/scope, digest and derived identity checks still precede accepted custody. Unsupported payload schemas and undecodable known payloads still become held envelopes, preserving the source revision fence independently of buyer routing. Sources: `tests/fixtures/consumers/owner.ts:29-70,125-170`.

The observable tightening for a present `completion` equal to `null`, `false` or `0` is deliberate and consistent with malformed-payload held custody. Such values no longer pass as absent completion. A held update retains prior `lastKnown`, routes recomputation through the previous beneficiary, advances source knowledge and cannot reopen a previous eligible contribution. Unknown/untrusted control envelopes remain unacknowledged. This is not a new commercial-grant path. Sources: `owner.ts:43-48,132-164`; `tests/e2e/consumer-protocol.test.ts` malformed-payload, unrouted held/unknown-schema, conflict and restart cases.

`ConsumerOwner<Decision>` binds read and write typing to the owner instance, improving the previous per-read generic assertion without merging credit and access ownership. All consumer SQL remains in its existing independent schema/transaction. Causal effect identities, source fences, initial-intent guards and whole-read-set resolution logic remain in their respective fixture owners. Sources: `owner.ts:74-119`; `credit.ts:45-46` and decision/resolution methods; `access.ts:12-14`.

The access-period nonmutating sort is correctly assigned to `orderedPeriods`; both `knownLastPeriod` and `paidUntil` read that ordered result. Explicit optional-string/boolean tests preserve the admitted string/boolean contracts. Sources: `access.ts:49-65`; base-to-head fixture diffs.

### E2E oracles, GM lifecycle and type probes

Removed duplicate discriminant guards follow retained throwing `node:assert/strict` equality assertions; they do not turn failures into success or skip assertions. Removed optional chaining follows assertions that already establish the value. `void test(...)` does not change the node test runner's registration. Request-body checks now require the actual SDK serialized body to be a string before parsing it. Sources: changed PostgreSQL/GM tests, `tests/e2e/*.test.ts`, `tests/integration/reconciliation.test.ts` and observation qualification tests.

The foreign-provider tuple comparator preserves native default sorting by comma-joined string, and sorts both actual and expected rows with that comparator. The observation bucket normalization still compares against the literal independent expected rows. No expected financial result was replaced with a call to production decision logic. Sources: `tests/e2e/foreign-provider.test.ts:94-98,179-182`; `qualification/observation/financial.test.ts:123`; consumer fixture canonicalizer diff.

The GM runtime changes are equivalent empty catch callbacks and `return undefined` to bare `return` in an async loader. The physical read is still awaited before signal checking/publication, so cancellation remains distinct from physical settlement. Watch/load timing, no initial watch callback, scope detachment and stale-result suppression assertions are retained. Sources: `packages/payments-get-modular/src/module.ts:29-34`; `src/observation/projection.ts:100-123`; observation lifecycle and projection-lifecycle tests.

The negative capability probes continue to reject forbidden members through `@ts-expect-error` plus a `satisfies keyof ...` expression. They now directly test key absence even if a future forbidden method has an unrelated signature. Separate async/void watch-callback, forged snapshot, branded error, readonly value and future-union rejection probes remain. Sources: `packages/payments-get-modular/test/surface.types.ts:3-20`; `qualification/observation/surface.types.ts:22-54`.

## Required remaining qualification

No minimal source fix is requested from this review. The absence of new material source findings does not replace required real PostgreSQL concurrency/durability/recovery, whole-system E2E, observation, packed NodeNext/Bundler/npm, Drizzle admission or release gates. Their execution and exact final-SHA evidence remain with the main task owner. This conclusion applies only to the reviewed base-to-head delta and assigned scope.
