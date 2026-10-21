# Independent review — SDK 0.3 public delivery

## Reviewed source and disposition

- Repository: `/workspace/scratch/9e36ca3bbd13/implementation/payments-sdk`.
- Reviewed HEAD: `28ab08829d3c90094a2b2a846da05daa09c108c2`.
- Diff baseline: `58441742d2f3743e4681f4bb02b2ff013023d652`.
- Working tree was clean when checked after declaration inspection.
- Scope: integrated 0.3 public contracts, package exports/manifests, emitted public declaration boundary, strict-source configuration, packed consumers, CI reachability, migration and qualification claims.
- Disposition: **no material/blocking finding** in this lane. One low-priority documentation routing correction is recorded below.

This was a read-only source/artifact review. I did not edit the repository, install dependencies, build, run database commands, execute the full suite, or perform remote operations. The only write is this requested memo. The root agent owns the current full Node-floor qualification. I inspected the newly regenerated `dist` declarations after the root agent reported its forced build passed; this memo does not independently claim a passing build/test/CI/PR/merge/release.

## Applicable instructions

Read the repository `AGENTS.md`, `docs/developer-stack.md`, the relevant accepted implementation-plan and current architecture sections, the PostgreSQL package guide, the queue migration guide and hardening plan. Read the explicitly retained organization Engineering Quality Standard at `/workspace/scratch/9e36ca3bbd13/research/org-current/docs/engineering-quality-standard.md` as supplied by the parent. No current remote policy read-back was attempted in this constrained review.

Applied the ownership rules: core owns provider-neutral policy/contracts; PostgreSQL owns technical transaction/transport capabilities; vendor clients and ORM declarations stay private; outer composition selects the implementation. Breaking 0.x contract changes require deliberate minor-version migration instructions, and persisted/in-flight state must remain safe.

## Finding

### P3 — Qualification table assigns the alternate transport scenario to the wrong command

**Location:** `docs/qualification.md:51`.

The `test:postgres` row says it exercises the “alternate transactional transport with the same runner.” That fixture is `tests/e2e/queue-transport.test.ts`, as correctly identified in `docs/queue-transport.md:108–114`. `tools/run-tests.ts:9–10` assigns `test:postgres` only `packages/payments-postgres/test/**/*.test.ts` and `tests/integration/**/*.test.ts`; `tests/e2e/**/*.test.ts` belongs to `test:e2e`.

**Impact:** A maintainer reading the gate table may run `pnpm test:postgres` and believe they exercised the transport-substitution scenario. This does not omit the scenario from the full check or CI, because both groups remain required. It is a documentation correction, not a release-blocking behavioral defect.

**Read-only reproduction:** Compare `docs/qualification.md:51` with the `groups` mapping in `tools/run-tests.ts` and the path `tests/e2e/queue-transport.test.ts`. No database or test execution is needed to establish the mismatch.

**Suggested correction:** Put the alternate-transport claim in the `test:e2e` row, or add a dedicated row explicitly saying it is within `test:e2e`.

## Verified contract and packaging evidence

### Public transport boundary

`packages/payments-postgres/src/work-transport.ts` owns the useful infrastructure seam: the work identity, namespace, same-transaction enqueuer, trusted parameterized pending-work expression, callback lifecycle and stop contract. The transaction remains a PostgreSQL adapter technical API. Nothing adds SQL or transport dependencies to core.

`store.ts` accepts `PaymentJobEnqueuer`, validates its schema/scope, and calls its enqueue method with the current bounded transaction. `jobs.ts` accepts an explicit `PaymentJobTransport`, uses its pending predicate before the repair LIMIT, retains claim/settlement/receipt and lifecycle responsibilities, and returns the narrow queue capability. Its source imports no pg-boss or Drizzle implementation.

`job-transport.ts` retains the concrete pg-boss implementation. `makePaymentBoss`, standalone bootstrap and qualification helpers are private. The public factory has an explicit `PgBossPaymentTransport` return type; it exposes a bootstrap operation and plain diagnostic data without returning a mutable vendor client. The existing host example selects this factory explicitly.

### Regenerated public declaration closure

I recursively read relative imports/reexports starting from every manifest `exports[*].types` target. The resulting SDK-local declaration closure and external imports were:

| Public export | SDK-local declaration files | External declaration imports |
| --- | ---: | --- |
| `@agent-teams/payments-core` | 7 | None |
| `@agent-teams/payments-core/testing` | 2 | None |
| `@agent-teams/payments-paddle` | 3 | `@agent-teams/payments-core` |
| `@agent-teams/payments-postgres` | 8 | `@agent-teams/payments-core`, `pg` |
| `@agent-teams/payments-get-modular` | 3 | `@agent-teams/payments-core`, `@get-modular/assembly` |
| `@agent-teams/payments-get-modular/observation` | 3 | `@agent-teams/payments-core`, `@get-modular/assembly`, `@get-modular/observation`, `@get-modular/resources` |

The PostgreSQL public closure is `index`, `database`, `migrations`, `store`, `recovery`, `jobs`, `job-transport`, and `work-transport`. It does not reach `records`, `schema`, `pg-boss-declarations`, Drizzle, or pg-boss. The regenerated `jobs.d.ts` returns `Readonly<PaymentJobEnqueuer>`; `store.d.ts` takes that capability; `job-transport.d.ts` imports only its local transport contract.

`tsconfig.checks.json:8` explicitly includes the emitted private pg-boss augmentation for repository checks. The base config still uses `skipLibCheck:false`; checks still cover tools, tests and examples. This does not reintroduce that augmentation into the public entrypoint. Source package compilation includes its own augmentation through the package's existing `src/**/*.ts` include.

### Packed consumer coverage and dependency closure

All four delivery package manifests are `0.3.0`; no fifth package or new runtime dependency was introduced. Core remains dependency-free. Engineering Foundation and node-or-bun remain development tooling.

`tools/packed-consumers.ts:12–18` derives public entrypoints from the packed manifest rather than a maintained export list. The pnpm branch intentionally excludes only optional `/observation`, tests plain core separately, and tests five exports together without Observation installed. It uses strict NodeNext and Bundler configurations with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `skipLibCheck:false`, plus runtime import checks and plain-core optional-dependency rejection.

The npm branch passes the complete derived list to `tools/packed-npm.ts`, which imports all six public exports, uses a production-only strict-peer installation with scripts disabled, validates exact archive identities, rejects source/workspace links and development dependency closure, checks unpatched official Drizzle bytes, and compiles both NodeNext and Bundler with `skipLibCheck:false`. Its compiler file list explicitly rejects Drizzle/MySQL declarations and verifies the actual all-export entry file is in the graph. Those commands are required by the existing scenario jobs on both Node floors. This review inspected the mechanisms; the root agent's current executions own passing-run evidence.

## CI and migration honesty

The existing Checks workflow still builds once, uploads compiled packages, shares them with independent quality/scenario jobs, uses pnpm caching, tests both admitted Node floors, cancels obsolete runs, and requires the aggregate gate. The new adoption test is reached through the existing `tools/test/*.test.ts` boundary glob in CI and directly through `check:fast`; it did not create a redundant CI build lane or remove any gate.

The scoped Get Modular guard uses the existing Foundation inventory and pinned TypeScript AST, checks known authored declarations and reviewed artifact pins, includes rejecting drift fixtures, and explicitly disclaims full semantic CMS/application-wide FMS enforcement. Those limitations match what the code checks.

`CHANGELOG.md` and `docs/queue-transport.md:61–102` explain the 0.2 to 0.3 break: explicit transport construction, adapter-owned bootstrap, narrow runner queue, no raw boss/name, separate warning/options shape, and removal of the public vendor augmentation. The guide keeps existing payment/job schemas, namespace binding metadata, payloads, obligations, evidence identities and in-flight work. It requires retaining namespaces for the bundled adapter and does not imply an automatic live transport handoff. No SQL schema or payment identity migration was introduced by the reviewed diff.

The hardening plan and qualification/releasing documentation distinguish source versions, fixture evidence, exact-head qualification and remote delivery. They do not assert that this local source is published, merged, admitted by hosted CI or production-ready. The existing production/runtime and live-provider gates remain explicit.

## Review commands and limits

The review used `git rev-parse`, `git status --short`, diff/stat/name inspection from the exact baseline, targeted `cat`/`sed`/`nl`/`rg` source reads, and a short read-only Python traversal of relative declaration imports from all six manifest type targets. No new build, compiler, package install, test runner or external service request was launched by this reviewer.

This lane does not replace the independent queue behavior, lifecycle, Paddle custody or full qualification reviews. No passing remote checks, PR creation, merge or publication is asserted.
