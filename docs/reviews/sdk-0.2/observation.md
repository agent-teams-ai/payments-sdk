# Independent final review: published payment observation

## Verdict

No actionable P0, P1 or P2 finding in the reviewed observation and published-package integration scope at `be42c359c3051588412488f2f1812ee5d74b290e`, compared with `1080854be73fc9e61f7a2b3f634c79c661fd1a55`.

Observation architecture and contract subscore: **9.2/10**. The integration has a narrow read-only dependency, an optional package boundary, real published load/watch semantics, explicit resource ownership and independently stated financial outcomes. The score is scoped to this slice. It does not certify the entire payments implementation, production use, live Paddle behavior or completion of the parent agent's final two-runtime qualification.

## Instructions and review independence

Read repository `AGENTS.md`, `docs/developer-stack.md`, accepted implementation-plan and architecture guidance, the changed package README, and the observation qualification guide. Applied the complete Q source pinned at `5f1b5aefa96d64448d909ae9c04a823afe145ea8`, plus the retained organization Engineering Quality Standard at `3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0`. Those two source files are in `research/continuation/sources`; the parent reviewer reported a fresh official GitHub connector read on 2026-10-20 and confirmed that organization revision as current. This review's attempted generic web open was disabled, so it does not independently claim that web access succeeded.

The reviewer did not author the implementation, change repository source, install dependencies, access PostgreSQL, change Git state, push or write to external services. Only this review report was created. The worktree was clean when checked and HEAD remained `be42c359c3051588412488f2f1812ee5d74b290e`.

## Findings and reasoning

### Financial ownership and dependency direction

`packages/payments-get-modular/src/observation/projection.ts:5-6` accepts only the core-owned public `readPurchase` capability. The projection exposes a readonly store and selection/refresh commands; it cannot admit verified input, dispatch checkout, publish evidence, register a durable consumer or ACK delivery. No hook is installed into core or the provider/storage packages. Assembly composition in `composition.ts:46-79` wires read/configuration/render inputs and scoped ownership; it contains no financial policy.

`qualification/observation/financial.test.ts` exercises an initial paid purchase and independent credit/access T3 before any projection exists, lost-ACK replay against a reconstructed credit consumer, a top-up during failing view callbacks, and renewal after all projections close. Expected Q100/T25 amounts, grant counts, exact advanced access period and provider mutation counts are asserted explicitly. These are credible fixtures for financial independence, rather than a callback being treated as delivery. I inspected the scenario; I did not rerun its PostgreSQL-dependent execution.

### Actual latest-only load and watch behavior

Inspected the installed published `@get-modular/observation@0.1.0` JavaScript, particularly `dist/features/store/load.js`, `engine.js`, `store.js`, `admission.js` and `values.js`, and Resources `0.2.0` public contracts.

The load registration retains one active physical run and one newest pending job. It compares both the offered revision and the source's current revision before loader startup and again before later-task result/error publication. This closes the completion-before-next-flush race without a duplicate generation-counter mechanism in payments. Superseded jobs cannot publish even if their signal has not yet been delivered by another task. The payments loader awaits the borrowed read's complete promise and only then checks abortion (`projection.ts:103-112`), preserving physical settlement and temporary cleanup rather than racing the read against cancellation.

Display construction reads, renders its initial state, and passes that exact snapshot to `watch` (`composition.ts:68-75`). This respects the real no-initial-callback/read-watch-gap contract. Callback failures remain attributable to the published error sink; source/subscriber cleanup is governed by Resources rather than a fabricated unsubscribe API.

### Privacy, validation and ownership

`select` validates and copies the supplied buyer/intent before any state change, then synchronously writes loading/idle before replacing the request (`projection.ts:47-56,126-144`). A same-turn direct read after a successful switch does not expose the previous ready purchase. Errors use the fixed `purchase_read_failed` code; provider/database diagnostic text does not enter the view (`119-122`). Rendered changes remain later-task notifications, and the guide clearly states this limitation.

The explicit finite projection omits provider sources, receipts and observation history. It structured-clones its retained intent, offer, transaction flags, money and status shape before the Observation store freezes it (`59-78`). Borrowed core read results and Host query objects remain outside ownership transfer. The port remains Host-authorized and already scoped; the package does not pretend a capability facet establishes tenant authorization.

### Cancellation and close debt

The published load's child resource drains the actual active promise, and detachment aborts logical publication and removes pending work. Parent/sibling infrastructure is borrowed. No pool, provider or payments-runtime disposer is invoked by the projection. Commands reject after resource closure begins. The documented obligation to retain the borrowed runtime/pool until the dependent scope completes is accurate.

The independent probe below confirmed that an abandoned close reports incomplete/unsettled debt while the read remains active, that a joined close still waits during temporary cleanup, and that completion produces `{ complete: true, settled: true, debts: [] }`. Cancellation does not erase physical work.

### Optional package and exact registry qualification

The main package entry exports only static contracts/module composition. `./observation` is a distinct export, and its Observation peer is optional in `packages/payments-get-modular/package.json`. `tools/packed-consumers.ts` separately compiles/imports the static packed package without Observation and checks its absence, so the optional claim is stronger than an import-graph comment.

`tools/qualify-observation.ts:48-66` binds each of five official registry package names and versions to canonical metadata/tarball URLs, dependency and peer maps, archive length, SHA-256 and SHA-512 integrity. It installs ordinary exact registry versions alongside all four packed payments archives into an isolated strict-peer consumer, compiles NodeNext and Bundler with strict declarations, and runs the public packed subpath scenarios (`69-118`). It hashes the SDK tarballs and manifest into the report. This is coherent release admission; historical prepublication reports are kept explicitly historical.

The local manifest comparison independently confirmed that all five published version/length/SHA-256/dependency/peer records equal their retained candidates. A local published-package resolver probe confirmed Assembly→Core and Observation→Resources share the integration's physical identities. The isolated qualification identity test also checks Conformance and every public integration peer. Fresh official downloads and final packed-consumer execution are owned by the parent agent's pending full qualification; this review did not substitute local inspection for those runs.

## Independently executed checks

Ran two read-only/no-database probes using `/tmp/agent-teams-node-26.11.1/node` (`v26.11.1`) against the freshly built integration and its installed published packages.

1. Lifecycle/copy/privacy/validation/debt probe: passed. It loaded a detached finite purchase, mutated borrowed nested offer/intent data and confirmed the ready value stayed frozen and unchanged; selected a blocked read, superseded it twice, then committed a final selection immediately upon releasing the old read; and confirmed only `initial` and `final` reached ready. Physical read peak was one. An invalid buyer identifier threw without changing the existing view. Closing during a held read returned three incomplete/unsettled debts to an abandoning caller; rejoining close waited through both read settlement and cleanup; final close was complete/settled with zero debts, zero live subscriptions and zero listener reports. Commands rejected during close and reads rejected after source cleanup. Construction using an already closed scope threw without dispatching a read.
2. Retained candidate/peer identity probe: passed for all five archive records and the installed Assembly→Core and Observation→Resources relationships. Confirmed the built main entry does not import Observation.

These probes used explicit promises and the real Observation `delivered`/`settled` waits. No fixed sleep was used as a correctness oracle.

## Limits and release disposition

No code change is requested from this review. Complete the parent agent's force-build-bound full suites and published observation/packed qualification on both admitted Node floors before using this report as part of release approval. I did not rerun PostgreSQL tests, fresh registry downloads, npm/pnpm isolated installs, live Paddle sandbox calls, production startup or remote CI. Host authorization, truthful complete borrowed-reader promises and retention of borrowed infrastructure remain explicit consumer obligations, not hidden SDK guarantees.
