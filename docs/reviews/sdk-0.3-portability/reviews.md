# Additional independent review record

All four reviewers used **GPT-6.1-sol** with **xhigh** reasoning and read the
applicable repository instructions and maintained organization Engineering
Quality Standard through the GitHub plugin. They made no production edits,
commits or remote writes. The first three reviews were separate scoped
examinations; the final integration critic examined the shared contract and
migration boundary and rechecked the resulting documentation correction.

## 1. Connection mechanics and durability

Reviewer: `portability_review_driver`.
Frozen local subject: `55cea23a78dc8ce306b281c930bdd81aa01c8c32`, compared with
`2524d88`. API-equivalent source:
[`7e292a9ba189a431749593529e2bbcceba0fd4f9`](https://github.com/agent-teams-ai/payments-sdk/commit/7e292a9ba189a431749593529e2bbcceba0fd4f9).

Inspected the owned database/connection/rows contracts, wrapper, transaction and
SQL executor, store/migration/recovery/job option changes, Drizzle compiler
guard, generic declaration closure and focused regression scenarios.

Independent real PostgreSQL checks passed:

| Runtime | Scope | Result |
| --- | --- | --- |
| Node 24.21.0 | Driver, Drizzle and durability | 13/13 |
| Node 24.21.0 | Jobs and integration recovery | 13/13 |
| Node 26.11.1 | Driver and durability | 10/10 |

These checks included physical destroy and listener lifetime, late checkout,
blackholed socket, lock deadline, lost actual COMMIT reply, session restoration,
cold one-connection enqueue, retained pool/sibling usability and restore fences.
The reviewer found **no P0/P1/P2 regression** in this delta.

An independent configuration probe showed that `binary:true` and host-overridden
int8/JSONB parsers do not preserve the promised decoded rows. The previous
direct-pool implementation inherited the same settings. No silent financial
corruption was established; the concrete default/text-mode qualification
precondition was added to the storage and package guides. Another driver is not
qualified merely by implementing the TypeScript interface.

## 2. Package isolation and queue substitution

Reviewer: `portability_review_packages`.
Same frozen `55cea23` scope, in its own detached review worktree.

Independently built the package and ran ordinary production npm generic-root
installation, runtime import and strict NodeNext/Bundler compilation with
`skipLibCheck:false`, while pg, @types/pg and pg-boss were absent. Also verified
an ordinary packed pnpm generic-root consumer without pg or pg-boss under both
strict resolutions.

The production npm custom queue consumer had no pg-boss and passed all four
existing substitution E2Es: atomic rollback, durable restart/repair, independent
T3/exact ACK, fairness, unknown COMMIT and physical drain. Explicitly adding the
qualified pg-boss peer then passed its packed public bootstrap/dispatch/drain
scenario. Foundation produced zero diagnostics and all ten rejecting boundary
fixtures passed. No weakened governed root or declaration leak was found.

Result: **no material P0/P1/P2**. Limits: bounded Node 24 review, not a replacement
for all-runtime complete qualification or live provider behavior. The reviewer
dropped its isolated database after verification.

## 3. Paddle and subscription/credit semantics

Reviewer: `portability_review_paddle`.
Frozen subject: `b6fd1a673d9f0d6a160a0938c159c2a0db410419`, compared with
`55cea23` (only the new connected stories, helper and matrix).

Inspected all three additions, actual installed official SDK 3.10.0 client,
resources, errors and entity constructors, primary Paddle documentation,
production normalization/core behavior, independent credit/access fixtures and
earlier connected scenarios cited by the matrix. Verified the three recorded
SDK source hashes and `git diff --check`; did not duplicate the full runtime run.

The reviewer traced independent symbolic amounts and exact period identities,
API/raw receipt order, stale observations, original fact/grant stability,
restricted-state top-ups, refund/chargeback causality, recovery purpose and
mutation-capable GET count, local-clock cutoff, buyer checks before dispatch,
503 preservation and rejecting zero/incomplete/foreign-account completions.

Result: **no P0/P1/P2** and no material false coverage claim. The review explicitly
preserved unsupported pause and live scheduling, production accounting,
consumption/debt, arbitrary overlap, rollover and partial-refund limitations.

## 4. Integration, migration and gate reachability

Reviewer: `portability_review_integration`.
Frozen subject: `b6fd1a6`, compared with `2524d88`.

Inspected all changed public runtime APIs/manifests, generic/subpath import and
declaration graphs, active guides and executable examples, strict projects,
Foundation policy, packed consumer orchestration, CI dependencies and the new
connected stories. Confirmed that E2E discovery and all three npm profiles run in
the required scenario matrix. Core remains unchanged; PostgreSQL-specific SQL
transport and remote-broker limits remain explicit.

### P2: active recovery guide still passed the removed pool option

`docs/recovery.md` constructed `createPostgresPaymentRecovery({ pool, ... })`
after `PaymentRecoveryOptions` changed to `database`. The reviewer reproduced
`TypeError: Cannot read properties of undefined (reading 'acquire')` without
database IO; the same snippet fails strict compilation. This was an active
operational migration defect, not a historical plan observation.

**Disposition: fixed and independently rechecked.** Local commit
`de82003b8d994136c4693fd84b156d54826f41cb` imports the explicit driver factory,
wraps the host pool and passes `database`. It also documents the preserved host
codec configuration and qualified default/text-mode precondition. Only the
three expected documentation files changed.

The reviewer extracted the corrected complete first TypeScript block, supplied
declared `Pool` and `PaymentScope` inputs and compiled against current public
exports. Strict NodeNext with `exactOptionalPropertyTypes:true`,
`noUncheckedIndexedAccess:true` and `skipLibCheck:false` passed. Temporary probe
files were removed. **P2 resolved; no further material findings.**

The integration review did not duplicate both full runs or qualify a live Paddle
account, browser wrapper, alternate driver, database engine or remote broker.
