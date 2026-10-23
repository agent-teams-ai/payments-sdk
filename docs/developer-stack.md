# Developer stack and adapter boundaries

## Read order and authority

Before planning, implementing or reviewing, read the maintained
[organization Engineering Quality Standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md),
then this repository's [agent instructions](../AGENTS.md),
[accepted implementation plan](implementation-plan.md),
[architecture](architecture.md) and the changed package's guide.
Use the owning qualification record for a dependency or runtime claim.

The organization baseline owns common engineering practices. Product contracts,
technology choices and local adoption remain with this repository. A current
upstream link supplies navigation; changing a content pin or accepted decision
requires its owning adoption process. Keep stricter local rules. An upstream
proposal is evidence to assess, not an automatically adopted requirement.

## Approved local stack

| Concern | Choice and scope |
| --- | --- |
| Maintained runtime, tests and tools | Ordinary TypeScript `.ts`, compiler/parser **7.0.2 or newer**, owning strict projects and `skipLibCheck:false`; distribute ESM JavaScript and declarations |
| Product runtime and database | The Linux Node and PostgreSQL profile in [qualification](qualification.md); broader compatibility requires evidence |
| Payment provider | Official Paddle Node SDK inside `payments-paddle`; follow its [adapter guide](../packages/payments-paddle/README.md) and separate browser admission gate |
| Persistence query/schema toolkit | **Drizzle inside `payments-postgres`**, approved by the owner on 2026-10-20; private typed query compilation, with PostgreSQL transaction/recovery guarantees owned by the adapter |
| PostgreSQL connection mechanism | Adapter-owned `PaymentPostgresDatabase` / `PaymentPostgresConnection`; optional `/node-postgres` wrapper borrows the host's existing pool, including a pool used by Drizzle |
| Durable PostgreSQL work | Infrastructure-owned transactional enqueue/worker transport contracts; optional `/pg-boss` implementation with atomic enqueue through the existing bounded payment transaction |
| Optional composition | Get Modular inside `payments-get-modular`; use the coherent published peer profile and explicit observation release gate in its [guide](../packages/payments-get-modular/README.md) |
| Captured development commands | Exact `node-or-bun` Node adapter inside the existing tooling helper; see [scope, artifact and process guarantees](node-or-bun-adoption.md); no SDK runtime or Bun admission |
| Development architecture tooling | Engineering Foundation's [selected complete profile](foundation-adoption.md): shared strict compiler/type-aware lint presets, registry lifecycle and repository-owned [source](../architecture/foundation/source-dependencies.yaml)/[dependency](../architecture/foundation/dependency-declarations.yaml) policies; development-only, full FMS for all production packages |

Exact admitted dependency versions belong to the workspace catalog, package
manifests and frozen lockfile. Check [upstream qualification](upstream-qualification.md)
and [qualification](qualification.md) before treating a version or proposal as
supported. A technology choice does not itself qualify an artifact or behavior.

## Drizzle boundary and implementation obligations

Use Drizzle for adapter-owned typed schema/query work. Keep ORM imports, schema
objects, inferred persistence records, query builders and transaction objects
private to the infrastructure adapter. Core, its public `PaymentStore` contract,
provider-neutral evidence and consumer contracts remain ORM-free. The PostgreSQL
adapter's generic public API depends on its own exclusive-session contract,
without `pg`, pg-boss or Drizzle types. Select concrete driver and queue
implementations at explicit package subpaths; their optional peers must not enter
a generic-root consumer's installation or declaration graph. Plain-core consumers
must continue to install, compile and run without Drizzle, PostgreSQL, Paddle or
Get Modular. See [storage portability](storage-portability.md) for the difference
between changing a driver, changing an ORM and changing the database engine.

Keep payment-local T1/T2, independent consumer T3, immutable facts, evidence
revisions, complete read-set validation, CAS/locking, unknown-COMMIT handling,
deadlines and borrowed-pool ownership. A query-toolkit change must not replace
these contracts with an assumed generic transaction guarantee. Retain explicit
SQL where PostgreSQL concurrency or recovery requires it; a typed query builder
does not establish semantic equivalence. No cross-owner SQL or Unit of Work.

The supplied node-postgres wrapper owns checkout, query timeout, result
normalization and physical discard mechanics. The generic PostgreSQL adapter
owns transaction phases, acquisition/absolute deadlines, session durability and
unknown-COMMIT classification. Drizzle's public `pg-proxy` entry is used only to
compile typed queries with `.toSQL()`; its execution callback rejects accidental
execution. This does not adopt proxy transactions or qualify another driver.

Select an exact artifact after checking its current stable release, provenance,
Node/driver compatibility and actual strict TypeScript 7.0.2-or-newer declarations.
For Drizzle, the owner's 2026-10-20 direction selects the newest published
release line, including prereleases. Check the registry's release channels and
publication history, record the chosen exact artifact, and never use a moving
dist tag as the dependency specifier. Prerelease selection does not waive any
compiler, adapter or packed-consumer guarantee.
Confine runtime dependencies and Foundation allowlist changes to the owning
adapter; qualify packed NodeNext and Bundler consumers with `skipLibCheck:false`
and preserve dependency rejection probes. Use real PostgreSQL integration for
atomicity, concurrency and failure recovery. Record actual results and limits.

Runtime Drizzle adoption does not itself select Drizzle Kit or regenerate
migrations. Any migration-tool change needs an explicit owner, baseline/history,
and safe treatment of persisted state and in-flight work. Preserve accepted
architecture documents; record a successor only if a real contract changes.
The accepted plan's core ORM prohibition and prohibition on escaping ORM
transactions are consistent with this adapter-local choice.

## Organization source read-back

The organization default branch was read at
[`3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0`](https://github.com/agent-teams-ai/.github/commit/3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0)
on 2026-10-20. Its
[agent route](https://github.com/agent-teams-ai/.github/blob/3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0/AGENTS.md),
[quality baseline](https://github.com/agent-teams-ai/.github/blob/3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0/docs/engineering-quality-standard.md#scope-and-authority)
and [governance boundaries](https://github.com/agent-teams-ai/.github/blob/3a203362c25c5ebbe6e44b745ba3f8a5eecbaad0/GOVERNANCE.md#feature-module-standard-ownership)
require explicit consumer navigation and preserve product-owned technology
choices. That inspected revision does not mandate Drizzle. The Drizzle decision
above records this owner's approval for payments, rather than attributing a
technology mandate to the central baseline.

Organization [PR #368](https://github.com/agent-teams-ai/.github/pull/368),
inspected while open at
[`328815e3522d9183db61516284c890d5429c4a6d`](https://github.com/agent-teams-ai/.github/blob/328815e3522d9183db61516284c890d5429c4a6d/docs/engineering-quality-standard.md#typescript-for-javascript-runtimes),
proposes ordinary `.ts`, TypeScript >=7.0.2 and strict source coverage. The local
requirements already apply independently in this repository; this read-back is
not a claim that the proposal merged or a pin to its mutable branch.

The local [Q source](https://github.com/777genius/agent-rules/blob/5f1b5aefa96d64448d909ae9c04a823afe145ea8/skills/q/SKILL.md)
remains applicable: protect policy with consumer-owned contracts, depend inward,
introduce the minimum useful boundary and verify real adapter behavior.
