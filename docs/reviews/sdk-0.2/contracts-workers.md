# Independent final review: provider vocabulary and worker diagnostics

## Subject and outcome

Reviewed canonical provider vocabulary commit `5ea371a` (source `1bbc226`) and worker diagnostic commit `1e3befe` against their parents in `/workspace/scratch/9e36ca3bbd13/implementation/payments-observation-candidate`. The initial working branch advanced to `be42c359c3051588412488f2f1812ee5d74b290e` during review. The bounded remediation was independently rechecked at `5c0b4ac79e1a0e16a0d8a3b671da654a6dfe9977`; its production reducer, Paddle normalization and worker runtime files are unchanged from their reviewed subjects. Instruction-routing changes authored by this reviewer were explicitly excluded from review.

**One P2 finding was confirmed and fixed in `5c0b4ac79e1a0e16a0d8a3b671da654a6dfe9977`. No unresolved P0/P1/P2 finding remains in the reviewed scope. No material worker-diagnostic defect established.** This is a scoped source and pure-probe assessment, not independent full PostgreSQL/E2E qualification or an assessment of the entire SDK.

## P2, fixed: unknown foreign wire codes can collide with reserved canonical tokens

**Original location at `5ea371a`:** `tests/e2e/foreign-provider.test.ts:22-29`, especially the default `return code` at line 28; observation wrapping at line 43. The associated conservative-unknown claim in `docs/architecture.md` needs the same clarification.

The newly supplied foreign adapter recognizes `ORDER_CHECKOUT`, `PLAN_ACTIVATION`, `CYCLE_INVOICE` and `CARD_PROFILE_WRITE`. Its fallback returns every other raw code unchanged and wraps that value as known canonical origin. If an unrecognized raw code is exactly `api`, the core recognizes the resulting string as checkout. An otherwise valid saved one-time purchase becomes a commercial completion, even though this foreign adapter did not recognize the provider origin. An unknown raw `subscription_recurring` can likewise acquire canonical renewal meaning. The existing negative oracle uses only `UNRECOGNIZED_UPGRADE`, which does not collide with the reserved namespace.

A strictly typed pure reproduction constructed the same saved binding/offer/profile conditions, used the new adapter fallback, and compared two cases. `UNRECOGNIZED_UPGRADE` returned `{kind:'held',reason:'unsupported'}`. Unrecognized raw `api` returned `commercial` with classification `one_time`.

**Impact and scope:** This is a defect in the new foreign-provider fixture/example contract and its portability claim. It is not a newly introduced Paddle classification regression: the old and new reducers classify the existing canonical tokens identically. The core cannot distinguish deliberately mapped canonical `api` from an unsupported foreign raw `api` after this fallback has erased that distinction.

**Bounded correction, now implemented and independently verified:** Reserve canonical tokens for deliberate adapter mappings. For unknown foreign codes, return an unknown origin Field or an explicit unsupported interpretation while retaining the exact raw code in `retainedRepresentation`. Add independent negative oracles for raw `api` and `subscription_recurring`. Preserve Paddle's existing serialized DTOs, decoder version and reducer semantics. No new public interpretation abstraction or accepted ADR change is required.

## Remediation delta verification at 5c0b4ac

The fixed `foreignOrigin` now returns `Field<string>` and supplies known canonical tokens only in its four explicit recognized mappings. Its default returns `{presence:'unknown'}`; the exact raw origin remains in the retained receipt. The receipt constructor uses this Field directly rather than wrapping an uninterpreted raw string as known.

The PostgreSQL E2E source now exercises raw `api` on an existing saved checkout and raw `subscription_recurring` on an existing known subscription. Independent assertions reject a completion/binding for the unknown renewal, check unknown origin, retain the raw receipt, and preserve the literal expected three supported facts, three grants and total 225. Checkout assertions retain no completion and an incomplete hold. Contracts, architecture and interpreter comments now explicitly reserve canonical strings for deliberate adapter mapping. No observation DTO shape, historical Paddle token, decoder version, reducer execution or worker runtime changed in this fix.

For independent execution without PostgreSQL, this reviewer extracted the actual fixed `foreignOrigin` function verbatim from the committed fixture into the isolated strict probe. On both Node 24.21.0 and Node 26.11.1, all three unknown wire codes (`UNRECOGNIZED_UPGRADE`, `api`, `subscription_recurring`) returned unknown. Applying those fields to both saved purchase profiles produced held/incomplete classification with no completion. Applying them to an otherwise recognized subscription but unbound transaction produced neither a renewal binding nor a completion. All four deliberately supported mappings still matched independently specified literal canonical values. The 84-case pre-change/current classification and mutated-state comparison also remained identical.

The delta probe passes the same inherited full strict TypeScript 7.0.2 project. `git diff --check` passes. A source delta check confirms no changes to `reducer.ts`, Paddle `observations.ts`, worker `jobs.ts` or `job-transport.ts` in `5c0b4ac`. The original P2 is closed. The owner separately reports a fresh forced build, strict project and real-PG final foreign-provider test 1/1 passing on Node24; this reviewer did not independently run that database test.

## Evidence supporting backward compatibility

The production reducer change extracts the same historical token sets into a core-owned vocabulary. The interpretation preserves the checkout, initial, recurring, payment-maintenance and explicitly unsupported branches. The subscription status, scheduled cancellation and adjustment helper lists match their predecessor literals. The Paddle adapter's explicit origin switch maps each recognized wire value to the identical serialized string and retains unfamiliar strings without changing their casing or bytes. Its output property, source/receipt, decoder version and DTO shape are unchanged by this delta.

For a substantive differential check, this reviewer compiled both the current core source and the pre-`5ea371a` reducer into isolated temporary outputs with actual TypeScript 7.0.2 and the repository's inherited full strict profile. Across 84 origin/profile/purpose cases, classification output and mutated payment state were identical after canonical JSON serialization. Cases covered all ten historical canonical origins, unfamiliar values, casing/whitespace variants, both profiles and commercial/payment-method/recovery purposes. This supports the absence of token/classification drift; it does not replace full replay or PostgreSQL suites.

The foreign-provider positive oracle uses wire values unrelated to Paddle. Expected classifications, totals, effect counts and grant totals are literal independent assertions, rather than outputs recomputed through the classifier under test. It checks completion, renewal, maintenance without a grant, retained receipt digest, sender ACK replay and durable credit-consumer duplicate receipts. These are useful contract tests. They qualify a disposable provider fixture, not a second production provider. Their original canonical-collision negative gap is closed by the remediation above.

## Worker diagnostic assessment

`packages/payments-postgres/src/jobs.ts:212-225` retains the previous handler-to-logical-issue mapping. Unexpected exceptions still settle as `handler_failed`; known `WorkIssue` paths preserve their existing retry/quarantine behavior. `PaymentJobHandlerError` is constructed only for unexpected run failures and retains the original cause, copied/frozen bounded work kind/identity and logical attempt. It does not attach the evidence message or write the exception into persisted state.

The diagnostic is emitted from the settlement `finally` block. Thus settlement is attempted before reporting; if settlement fails, its rejection still propagates to the queue callback while the original handler cause remains available through the diagnostic. A successful T3/ACK is not manufactured by logging, and the settlement update still fences its state/attempt/revision to avoid reopening completed work or overriding a later claimant. This change does not introduce external mutation retries.

`reportPaymentJobError` catches synchronous sink throws and attaches a rejection handler to returned promises. It neither awaits the observer nor recursively reports observer failure. The pg-boss error listener and stop-error observation use that helper. The stop operation itself retains its original rejection/status behavior. The unchanged optional custom warning-listener behavior is outside the new error-listener guarantee.

The exported `PaymentJobHandlerError` is an infrastructure diagnostic API; it does not expose provider DTOs or acquire financial authority. Its original cause may contain host-sensitive diagnostic data, appropriately left to the documented private host logging/redaction policy. The wrapper itself carries only the work identifier and attempt context.

Pure probes exercised the actual diagnostic helper and public exported error class on Node 24.21.0 and Node 26.11.1. They verified original cause identity, copied/frozen work metadata, synchronous-throwing, promise-rejecting and successful observers, and zero observed unhandled rejections. These probes were strictly typechecked with the actual public PostgreSQL entry point, including its required pg-boss declaration augmentation.

## Actual validation and limits

Temporary probe root: `/tmp/payments-final-review-contracts-workers`.

- Current core and pre-change reducer isolated compilation under inherited strict TypeScript 7.0.2: passed.
- Strict probe project: passed after using the package's public entry point for the worker diagnostic type.
- Differential 84-case classification/state check: passed on both Node floors.
- Canonical-collision defect reproduction: reproduced on both Node floors.
- Actual diagnostic helper/class probes: passed on both Node floors, zero unhandled rejections.
- `git diff --check`: passed at the review checkpoint.
- An initial isolated compiler attempt lacked the temporary root's Node type-library resolution; linking the actual workspace dependency root fixed that harness setup without weakening compiler options.
- An initial direct private worker-module import omitted the package's pg-boss declaration augmentation and failed typechecking. The corrected probe imports the real public entry point, and the full profile passes. That initial harness failure was not treated as a product failure or a successful check.
- No PostgreSQL instance or queue was used by this reviewer, to avoid interfering with the owner's concurrent qualification. The owner separately reported seven real-PG worker tests passing at `be42c35`; that is attributed owner evidence, not this reviewer's independent execution.
- The collision-fix commit received the independent source and pure delta verification recorded above. Full foreign-provider PostgreSQL E2E and final packed artifacts remain outside this reviewer's independent execution evidence; the owner's real-PG run is separately attributed.

## Clean Architecture and SOLID assessment

Core owns interpreted protocol meanings, while provider adapters translate wire language and preserve original receipt evidence. Extracting the vocabulary introduces no provider dependency into core, no dependency bag and no speculative extension framework. Historical token spelling remains a durable contract. This is a reasonable minimal boundary, provided adapters do not confuse unknown raw codes with reserved canonical tokens.

Worker diagnostics remain at the PostgreSQL/queue edge, outside financial decision and consumer ownership. The helper has one responsibility: isolate diagnostic-sink failure from work settlement. The error class adds useful host context without moving retry policy into the observer. Existing T1/T2/T3 ownership and inward package dependencies are preserved in this delta.

## Scores for the reviewed surfaces

Scores are engineering judgement on this limited delta, not a repository-wide certification or mechanically derived metric.

| Surface | Code/correctness | Architecture/SOLID | Reason |
| --- | ---: | ---: | --- |
| Canonical vocabulary and foreign fixture | 9.1/10 | 9.2/10 | Existing behavior remains equivalent; the confirmed unknown-token collision is fixed and independently checked on both Node floors, with independent negative and positive oracles |
| Worker diagnostics | 9.0/10 | 9.2/10 | Cause and settlement semantics are preserved with a small host-only API; pure observer-failure checks passed, while full PG qualification was deliberately left to the owner |
| Combined reviewed delta | 9.0/10 | 9.2/10 | The bounded P2 is closed; no unresolved finding remains in scope, with full PostgreSQL/artifact qualification still owned and reported separately |
