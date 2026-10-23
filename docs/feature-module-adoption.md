# Payments feature ownership

## Decision

The owner explicitly adopts the organization Feature Module Standard v1.1 for
all production source in the four Payments SDK packages. This succeeds the
previous decision to defer FMS topology. The
[profile](../architecture/feature-module-standard.json) pins the immutable
standard and owns the concrete topology, public surfaces and deterministic
commands. No package or production directory is exempt.

The [standard index](https://github.com/agent-teams-ai/.github/blob/main/docs/architecture/feature-module-standard/README.md)
owns version discovery. The selected v1.1 content is SHA-256
`cfa088ef7396139554fe5e3bcc839271b23299c6b60c569a3a7f1cd7c9f0bc6c`.
No sub-feature is introduced. The optional Get Modular descriptors are explicit
composition contracts; their visibility and dependency rules apply.

## Semantic owners

| Package | Role | Feature owner |
| --- | --- | --- |
| payments-core | SDK | Payment evidence: provider-neutral observations, immutable facts, durable-operation coordination and narrow inbound/outbound ports |
| payments-paddle | integration | Paddle integration: authenticated acquisition, verification, mapping and provider-specific recovery |
| payments-postgres | platform | Payment custody: payment-local transactions, record/CAS persistence, recovery, schema and durable work |
| payments-get-modular | integration | Payment runtime composition and optional purchase observation |

The PostgreSQL store, recovery and transactional work share one payment-custody
feature. They protect the same local records and transaction boundary. Job
transport remains replaceable through the store owner's narrow enqueue port;
it does not own payment policy. This grouping does not combine payment T1/T2
with a consumer's independent T3.

Core application input and output models are transport independent. Their
public application API is distinct from the Published Language, provider port,
store port and testing surface. Provider and database records do not become
public client DTOs. Outer package facades are curated named exports. Private
feature files are inaccessible through package export maps.

Public reads map custody records to detached, explicitly owned readonly
snapshots. Aggregate publication work and internal classification decisions
remain private; neutral observations, financial facts and audited outcomes
remain useful read diagnostics. Audited stream selection exchanges a target-
bound opaque version instead of storage read-set tuples. The application checks
the version against the complete current working set and retains the store's
complete CAS at commit. Version possession never supplies operator or buyer
authorization. The migration guide records the public contract change.

Get Modular is used only in its composition feature files and tests. Its real
published layout checker validates declarations, entries, groups and mirrored
feature tests. Observation loading and watching belong to composition; query
validation and finite read-value mapping belong to the application owner.
Preparation remains inert. The Host retains resource, startup and shutdown
authority; no container or generic workflow framework is introduced.

## Enforcement

`pnpm architecture:features:check` observes source through Foundation's public
graph and runs the published FMS kernel. The checker adds only repository-owned
facts the kernel intentionally cannot infer: the exact package census and
manifest targets, curated module facades, empty directories, mapped test roots
and the prohibition on infrastructure or ambient effects in inner code.
Shared FMS fixtures exercise the adopted kernel, including dependency cycles.
Disposable repository mutations prove rejection of unowned behavior, deep
imports, illegal layers, empty ceremonial layers and unknown modules.

Foundation's `quality.source-coverage` independently compares its repository
census with this topology, source ownership, strict production compiler
projects and the pinned typed linter's actual file selection. Suppression
governance records only the finite intentional cases below. Full lint retains correctness and maintainability
rules; command-route checks reject missing or masked gates.

```sh
pnpm architecture:features:check
pnpm quality:coverage:scope
pnpm lint
pnpm foundation:check
pnpm test:boundaries
pnpm check
```

Structural conformance is evidence about the declared architecture. Financial
semantics, provider substitution, PostgreSQL concurrency and recovery, physical
shutdown, dependency isolation and packed-consumer declarations still require
their existing scenarios and independent review. A passing topology checker is
not a receipt for those guarantees.

New modules and features require a real behavior, named owner, curated surface,
explicit graph edge and first meaningful test. `pnpm architecture:features:plan`
prints a reviewable plan from a caller-authored source file; it creates no empty
layers and applies no writes. The normal repository review accepts any profile
change before the new module enters the required gates.

## Negative contract tests

The strict compiler fixtures intentionally assign incompatible capabilities,
stronger preconditions, mutable observation values or unauthorized facets. Their
exact `@ts-expect-error` lines remain executable rejection witnesses: the compiler
fails if an expected rejection disappears. The suppression policy records each
path and line, its intent, owner and expiry. These test records grant no runtime
source exception and do not replace contravariance tests with an inferred type
that could miss the rejected assignment.

## Typed SQL row contracts

Four production line directives already existed on the adapter's bounded generic
`query<Row>` ports and forwarding implementations. The caller selects the row
shape from its SQL statement, so `Row` occurs only in the result type. Erasing it
would weaken the public port; a phantom input would misrepresent its semantics.
The PostgreSQL owner explicitly retains those exact
`typescript/no-unnecessary-type-parameters` exceptions, plus the same forwarding
case in its driver test, under finite suppression records. No maintainability,
security or feature-boundary rule is waived.

Their evidence is the strict NodeNext/Bundler driver declarations, real database
driver-port and unknown-COMMIT scenarios, and the existing query deadline and
checkout-discard tests. Review the records when the port, driver, compiler or
lint rule changes, or before expiry. Production SQL exceptions cannot expand by
adding a comment: unknown directives and stale records fail the shared gate.

## Reusable testing surfaces

The provider's synthetic response builders are used by its official-SDK tests,
root E2E scenarios and installed-consumer qualification. PostgreSQL's disposable
schema fixture and wire-fault proxy are used by its persistence tests and root
recovery/queue scenarios. Each owner publishes a curated `/testing` surface
behind its feature's testing role, without a self-executing test registration.
The generic PostgreSQL root does not import that surface or its optional driver.
Callers that select the PostgreSQL testkit explicitly install its existing
optional `pg` peer and supply a disposable qualification database. Fixture
factories own only the schemas and connections they create.
