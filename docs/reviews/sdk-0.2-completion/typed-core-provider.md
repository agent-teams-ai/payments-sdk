# Strict Foundation adoption: independent core and Paddle delta review

Date: 2026-10-20. Reviewed repository: `/workspace/scratch/9e36ca3bbd13/implementation/payments-delivery`.

## Subject and result

Reviewed the committed core and Paddle runtime/test delta from `de5324c` to exact initial review head `6fcfe4e3dc77810d43f85000136a72c2e6cb5929`. The relevant runtime commits are `433ebc7` (core) and `6fcfe4e` (Paddle). After the delivery owner committed the final integration head `95e996ff0bbe8edb003fcd42ab66c6aa429a7253`, independently verified that `git diff 6fcfe4e 95e996f -- packages/payments-core packages/payments-paddle` is empty and the worktree is clean. This verdict therefore applies to these unchanged surfaces at that final head. The PostgreSQL/Get Modular changes and root tooling/fixture changes are outside this review's verdict.

**No P0, P1 or P2 finding in the reviewed core/Paddle delta.** I found no removed financial guard, newly authorized mutation retry, weakened saved ownership/binding check, changed causal identity, or changed canonical bytes for admitted JSON values. This is a bounded source-review conclusion, not a new full qualification or another production-provider qualification.

The earlier successful source `fb9baa1` and PR head `b6a4f61` remain historical evidence for their own inputs. This memo does not relabel those executions as checks of the typed-refactor candidate.

## Authority and inspection

Read repository `AGENTS.md`, `docs/developer-stack.md`, the relevant accepted implementation-plan sections (provider capabilities/substitutability, checkout/unknown outcomes, T1/T2/T3, subscription/credit identities, reconciliation and SDK custody), `docs/architecture.md`, and the Paddle adapter guide. Applied the retained exact Q source `research/continuation/sources/q-5f1b5aef.md` and organization baseline `research/continuation/sources/org-quality-3a203362.md`. Their relevant obligations are consumer-owned contracts, inward source dependencies, observable replacement semantics, real uncertainty, independent financial oracles and honest evidence scope.

Inspected complete diffs for the changed core runtime files (`values.ts`, `runtime.ts`, `reducer.ts`, `memory.ts`, `reconciliation.ts`), Paddle runtime files (`provider.ts`, `observations.ts`), and their changed tests/fixtures. Read surrounding settlement, dispatch, authority, SDK and pagination code where the changed expressions participate in a financial boundary. The Foundation configuration/strict-project adoption is owned by a separate reviewer.

## Material questions resolved

### Runtime validation survives literal TypeScript declarations

`payments-core/src/values.ts:17-22` now accepts `unknown` at the actual identifier/scope validator boundary. It still checks identifier type, emptiness, bounds and control characters, plus every scope identifier and the closed environment set. `Array.from(value)` iterates the string by the same code-point sequence as the previous spread; the length bound and control-character predicate retain their previous meaning. The new malformed-values test checks actual runtime inputs rather than relying on declared TypeScript shape (`payments-core/test/core.test.ts:50-55`).

`payments-core/src/runtime.ts:21-41` validates the successful result as an unknown non-array object before using its properties. It retains these checks before producing a transaction binding:

- bounded nonempty transaction reference;
- an object checkout-instructions record, rejecting null and arrays;
- optional URL/token values must remain nonempty strings within the existing bound;
- purchase intent and buyer must match saved authority;
- payment updates must match the saved originating intent, buyer and selected subscription membership, and have the exact `payment_method` or `recovery` purpose.

An empty checkout record `{}` is still admitted; the public `CheckoutReady` contract explicitly makes URL/token optional (`contracts.ts:40-41`). The refactor therefore does not silently strengthen a valid provider's checkout contract to require one transport instruction. Cancellation outcome checks still require scheduled/exact effective time or applied/nonempty observed status, without changing their accepted result forms.

The same helper remains used by SDK settlement and audited `bind_outcome`, so the administrative path cannot bypass those checks (`runtime.ts:70-84` and `resolveUnknownOperation`). The expanded existing test at `core.test.ts:635-657` independently checks null/array/missing result shapes, bad instruction values, wrong intent, unknown purpose and empty transaction reference; it also checks unchanged operation state, no invalid binding, and exactly one provider update. Expected financial values were not replaced with values computed by the implementation.

Required capabilities now require actual `true` (`runtime.ts:50-51`). This is observably stricter for a malformed JavaScript adapter advertising a truthy non-boolean. It is consistent with the existing `CapabilityProfile` literal-true contract (`contracts.ts:43`) and does not remove a supported adapter implementation. It should not be described as identical behavior for every malformed input.

### Dispatch, uncertainty, custody and owner boundaries remain intact

The single mutation call site still follows a confirmed `beginExternalDispatch` result and remains outside the store commit (`runtime.ts:121-160`). Failure or an unconfirmed dispatch marker does not authorize the provider call; provider invocation has no automatic retry wrapper. Settlement/mapping errors and local deadlines preserve `outcome_unknown`. Late attempt evidence remains recorded before CAS settlement, while the current-attempt test prevents stale success from replacing a newer attempt's operation result (`runtime.ts:70-84`). The catch-handler and timer callback edits do not change promise adoption or create a retry path.

String-presence and optional-boolean guards retain the supported contract's decision at authority, lane, intent, request-key, route and incomplete-working-set boundaries. The memory store's `status.incomplete` / `status.invalidVersion` record replaces captured mutable booleans without changing when recursive working-set inclusion sets either condition, the 128-entry bound, returned expected read set or precedence of the two held reasons (`memory.ts:116-167`). The held-commit typed records view still copies only revision/publication metadata for held aggregates; it does not merge their speculative financial state (`memory.ts:173-192`).

Core still imports no provider SDK, PostgreSQL, ORM, Get Modular or Foundation runtime. No public contract or evidence vocabulary changed. There is no new cross-owner commit, consumer effect, initial grant identity, hook-driven financial delivery or external custody claim in this delta.

### Canonicalization, ordering and arrays

`values.ts:4-12` extracts the previous canonical visitor and changes sorting of the fresh `Object.entries(...).filter(...)` array to `toSorted` with the identical code-unit comparator. Null is returned before the object branch, finite-number handling is unchanged, arrays still use the same recursive map, undefined object fields are still omitted, and invalid canonical values still throw. This does not change admitted canonical bytes, digests, scope keys or evidence identities.

The other reviewed `sort` to `toSorted` replacements likewise operate on newly produced arrays, or previously spread copies, with the same comparators. The reducer's compatibility helper retains its canonical/provider-line comparator and matching order (`reducer.ts:40-51`). It does not reorder persisted provider lines as a side effect. Adjustment publication retains the same comparator and ordering (`reducer.ts:435`). Stream-selection expected read sets retain their existing canonical tuple/`localeCompare` comparison (`runtime.ts:338`). This review does not promote those existing locale-based comparisons into a new cross-locale serialization promise.

`Partial<Pick<SubscriptionObservation, 'collection' | 'items'>>` retains the deliberate missing-field checks in subscription reduction (`reducer.ts:243-258`). It does not redefine all required observations as known, carry forward a newer unknown field from `lastKnown`, or permit an unknown profile to grant completion. Quantity checks in both core and Paddle remain actual runtime comparisons against one rather than being erased as impossible literal-type branches.

### Paddle SDK behavior and result semantics

The observation diff only renames shadowed callback parameters. Mapping fields, monetary values/signs, provenance, decoder/API profile versions, provider identifiers and raw/mapped custody remain unchanged.

`provider.ts:27-30` preserves the previous truthiness decision for `result.checkout?.url`: every original falsy value produces `{}`, and every truthy value still passes through the same string/HTTPS/no-userinfo validator. Create and payment-update mutations still use this rule after their SDK response checks (`provider.ts:75-85`, `133-142`). No missing-URL case is reinterpreted as payment completion.

Configuration and offer quantity use the existing object validator to inspect unknown-valued fields (`provider.ts:52-57`, `66-72`). Cancellation timing is checked explicitly and the same timing determines both the SDK `effectiveFrom` value and the accepted observed result (`provider.ts:116-130`). Period-end never becomes immediate cancellation, and a response that fails the requested outcome still returns uncertainty. The public SDK, unchanged no-retry behavior, payment-method GET mutation classification and host-owned customer-wide management authorization remain in place.

Test edits removing repeated `if (...) throw` checks retain the immediately preceding `assert.equal`/`assert.ok` runtime assertions, which throw before any narrowed access. Former conditional assertion bodies become unconditional blocks only after their discriminant assertion. Monetary amount, classification, revision, custody, adverse-barrier, duplicate-initial and noncommercial-maintenance expected assertions remain present. Fixture optional booleans now use exact-true checks; valid fixture values and expected financial results are unchanged.

## Portability limit retained honestly

Reconciliation still requires lexicographically increasing string IDs, including a cursor that describes every returned input (`payments-core/src/reconciliation.ts:45-56`). Paddle requests `id[ASC]` and independently checks increasing Paddle event/adjustment identifiers (`payments-paddle/src/provider.ts:193-209`, `217-230`). This restriction predates the typed refactor. A provider with opaque/non-string cursors, non-lexical native ordering or a fundamentally different pagination protocol cannot be called production-interchangeable merely because it satisfies a method signature. Its adapter/source profile must satisfy these observable paging guarantees or be explicitly evolved and qualified by the owning contract process.

That is an existing supported-profile limit, not an introduced P2 or a reason to rewrite cursor contracts during this lint adoption. The accepted plan itself avoids promising replacement by an unqualified real provider (`implementation-plan.md:103`), while the foreign-provider fixture establishes a narrower mapping/consumer-contract claim (`architecture.md`, provider observation vocabulary section). This review preserves that distinction.

## Executions and limits

This reviewer ran read-only git/source inspection and `git diff --check de5324c 95e996f -- packages/payments-core packages/payments-paddle`, which exited successfully. Inspected emitted dist for the reviewed changed helpers; no build or emitted test suite was run by this reviewer. The ambient `node` is 24.19.0, below this repository's accepted Node24 floor, so it was not used to claim runtime qualification.

No install, full build, lint, PostgreSQL, packed-consumer qualification, remote operation, login, live Paddle request or charge was performed. The root reviewer reported a fresh force build of all four runtime packages and an actual emitted-core test result under Node 24.21.0: 49/49 passed, zero failures/cancellations/skips/todos, 938.9 ms. These are root-reported supporting evidence, not this reviewer's independently observed executions. No separate Paddle suite was duplicated because the owner was starting applicable final-head qualification. Current-candidate final required gates and source/evidence binding remain with the delivery owner. Prior runtime security, sandbox-account, HA/restore and production-provider admission limits remain owned by their existing qualification records.

Recommendation: no core/Paddle correctness fix is required from this bounded delta review. Complete and report the applicable current-candidate gates; do not use this memo or historical logs as a substitute for them.
