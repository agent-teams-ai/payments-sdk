# Independent critic 4 — observation architecture and admission

Date: 2026-10-20 UTC. Role: independent architecture critic, not implementation author.

## Exact review subject

- Candidate code: `340641f26e0cd71b049c14cdd8b57a012b7387f3`.
- Candidate documentation: `1ae8f89f2d6e8f810d7d2edc5be86630a8e46d8b`.
- Worktree: `/workspace/scratch/9e36ca3bbd13/implementation/payments-observation-candidate`.
- Exact retained upstream source: `c5c314ab98c57d2c73448f0c3c9860424a993d8a`, inspected from `/workspace/scratch/9e36ca3bbd13/research/continuation/get-modular-source` with that HEAD verified.
- During the final read-back the candidate advanced cleanly to `66011e3c3eb99d65ea30d9c4c02a79ff046ecbbe`. I separately inspected its entire five-line test diff: it replaces the previous `newAction`-only renewal assertion with assertions for `newAction`, exact `paidUntil` and exact `knownLastPeriod.endsAt`. It changes no architecture/runtime/admission code. This review covers that narrow follow-up as source inspection; it does not claim a fresh execution of its assertions.

## Disposition

**No new actionable material findings. GO for the bounded unpublished-candidate architecture and its admission wording, subject to normal successful checks and independent review on the final exact commit.**

The candidate applies the actual Get Modular features appropriate to this responsibility: declared composition inputs, required slots, capability segregation, per-run scopes, an owned store with readonly facets, authentic snapshots, watch/load scheduling and physical cleanup, and real Conformance smoke scenarios. It does not need another abstraction or optional feature to justify the user's request for full use of Get Modular.

This is not a production admission or npm-publication decision. The supported static SDK package remains on its previously qualified public train. The optional consumer is an implemented separate candidate profile using exact retained upstream archives.

## Scope and method

Read-only inspection covered `AGENTS.md`, candidate README, `projection.ts`, `composition.ts`, `surface.types.ts`, all four scenario files and their fixtures, the runner and archive manifest, CI insertion, active root/integration/upstream guides and the dated continuation record. I compared load/watch/store behavior to the exact upstream source, with particular attention to synchronous selection invalidation, completion before delivery flush, source/subscriber cleanup and borrowed read lifetime.

I did not run full tests, install packages, modify implementation, migrate a database, change accepted ADRs or operate any remote resource. Existing per-node JSON reports and actual scenario logs were read, and the log/manifest SHA-256 relationships were independently recomputed. This is evidence inspection, not a new test run.

## Architecture checks

### 1. Real composition and capability boundaries

`composition.ts` uses actual `declareModule`, `defineContract`, `input`, `required`, `implement`, `group` and `scoped`. Reader, projection configuration and renderer are explicit per-run inputs. The projection requires only the reader/configuration slots; display requires only readonly view/renderer slots. The display is not given projection commands, checkout, management, processing or durable delivery authority. A Host may compose the projection alone without adding a renderer.

`PurchaseReadPort` is `Pick<Payments, 'readPurchase'>`. The candidate imports public packed payment Core/Paddle/Postgres packages in qualification; its projection/composition code itself has no PostgreSQL client, ORM or Paddle DTO dependency. The baseline-to-candidate diff under `packages`, workspace catalog, lockfile and Foundation boundary configuration contains only the two package README edits, so no public core contract or supported dependency graph has been changed by candidate adoption.

### 2. Owned finite read state

The projection owns request and output stores. It shares only a real `ReadonlyStore` plus separate authorized view-selection commands. The finite purchase summary retains useful intent/offer/transaction/fact/status information and omits recursive receipt/provider-source/history graphs. `structuredClone` detaches every retained nested value before Observation freezes its graph. Query copies likewise avoid freezing Host input objects. This is compatible with upstream ownership transfer rules.

The view is a replaceable read projection, explicitly refreshed after durable changes or reconstructed. It is not described as continuously current financial authority, and Host selection authorization is explicit. The exported states distinguish idle, loading, ready-with-possibly-missing-purchase, and sanitized failure. No raw database/provider diagnostic is retained in the view.

### 3. Latest-only correctness

`select` and `refresh` invalidate the output synchronously; clearing removes the previous ready value before returning. Load callbacks update a separate output store rather than write feedback into the watched request store.

A potential completion-before-flush race was checked against exact upstream `packages/observation/src/features/store/load.ts`. Upstream `#isCurrent` compares the job revision both with the last offered revision and with `engine.latest(keys)`. It checks this at loader completion and again in later publication. Therefore a newer request committed synchronously suppresses the obsolete result/error even before that request's delivery flush. No additional userland generation counter is needed.

The loader awaits the real borrowed read promise and then checks abortion. It does not race against an abort signal or claim the underlying PostgreSQL read was cancelled. Successors serialize behind physical promise settlement, including wrapper cleanup. Repeated refreshes remain replaceable requests, not lossless events or evidence revisions.

### 4. Watch and lifetime semantics

Display explicitly reads/renders an authentic initial snapshot, then synchronously registers watch with that snapshot. This preserves upstream catch-up behavior without inventing an initial callback, unsubscribe return value or synchronous delivery promise. Render callbacks use synchronous block bodies returning undefined. Later callback failure is reported through the Host sink while the subscription remains active; initial render failure is ordinary construction failure requiring Host cleanup.

Projection stores/load registration belong to Resources. Host ownership of payment runtime/provider/store/pool remains separate and documented, including retaining borrowed dependencies until dependent close reports complete. Candidate scenarios use real scopes to exercise held read cleanup, source/subscriber close and sibling independence. No closing projection stops a borrowed payment owner or closes its pool.

### 5. Financial separation and proportionate qualification

The candidate's financial scenario exercises the existing public T1/T2/T3 and delivery/ACK path while hooks are absent, failing and closed. It reuses independent credit/access fixture owners rather than adding a new ledger or an on-paid callback authority. The follow-up `66011e3` strengthens access renewal proof by requiring the exact advanced paid-period end after all projections have closed. Existing adverse-evidence suites remain separately attributed in the README.

The candidate's narrow reader and readonly view shape are compatible with provider-neutral core contracts. This does not establish a second payment provider or a second durable storage engine; the real financial scenario deliberately qualifies the existing Paddle/PostgreSQL profile. No inspected text falsely claims those additional implementations.

## Runner and admission assessment

The runner verifies the exact five retained archive identities, versions, sizes, SHA-256 values, licenses, exports and packed dependency/peer maps before isolated install. It uses full upstream commit identity, strict peers/engines, ignored lifecycle scripts and exact file overrides. The physical identity test checks Assembly→Core, Observation→Resources and Conformance→Core/Assembly/Resources against the Host's resolved paths.

The candidate graph deliberately excludes the old `@agent-teams/payments-get-modular` package and Engineering Foundation. This prevents treating widened old peers as a new supported integration. The candidate modules are the separately compiled consumer under test, rather than a claim that the supported static adapter already adopted the next train.

Both strict NodeNext and Bundler consumers compile with TypeScript 7.0.2 and `skipLibCheck:false` before native tests. Conformance smoke uses the actual candidate public runtime for successful, failed and cancelled construction. CI adds the candidate gate to both existing Node/PostgreSQL scenario lanes without weakening normal gates.

The October 20 dated record and active guides distinguish merged source/retained archives from official registry publication. Historical sections are explicitly marked superseded for current PR status. The current manifest says `unpublished-upstream-candidate`; reports retain `npmPublicationProven:false` and `productionAdmission:false`. Actual published bytes and a coherent reviewed SDK dependency change remain required for supported adoption. No production runtime repair, live Paddle account qualification, release replacement or npm publication is asserted.

## Inspected execution evidence

Both existing JSON reports identify upstream `c5c314ab98c57d2c73448f0c3c9860424a993d8a` and manifest SHA-256:

`c2e12d8bf5b6ecf9d92764cc37e23eecc9c01b1e117e8731cdc4cacb8064459c`.

| Runtime | Actual retained scenario log | Reported result | Independently verified log SHA-256 |
| --- | --- | --- | --- |
| Node 24.21.0 | `.artifacts/observation-candidate-node-24.21.0.log` | 4 passed, zero failed/cancelled/skipped/todo; both strict resolver checks passed | `732bd070d930e6dfcd9a4220abf9235fd5c369fa469a08a0ca7a970940aba62d` |
| Node 26.11.1 | `.artifacts/observation-candidate-node-26.11.1.log` | 4 passed, zero failed/cancelled/skipped/todo; both strict resolver checks passed | `8fbd7439366ea93fe0b6b1549112666ad7e76c75b1d23c13067420d17c7a81f6` |

The report's manifest hashes also match the committed manifest bytes. These logs were inspected before any new final-source gate; they are not represented as fresh execution evidence for the added `66011e3` assertions. The final exact-commit CI run remains authoritative for that subject.

## Limitations, not new findings

- This candidate establishes no npm publication or supported next-train adoption. Registry-byte requalification remains pending.
- Optional read state requires explicit refresh and may coalesce intermediate changes. Rendered state can remain from the prior selection until later-task delivery; direct reads are invalidated synchronously. The README explains both behaviors.
- The existing Node production-runtime and strict Paddle.js declaration blockers are unaffected.
- No full test suite was rerun by this reviewer during the root owner's active gates. No architecture finding requires a new feature, refactor, migration or approval flow.
