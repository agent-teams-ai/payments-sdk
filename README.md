# Payments SDK

An embeddable TypeScript SDK for payment operations and durable payment evidence. Paddle Billing is the first provider. An optional PostgreSQL adapter supplies durable storage and background work; the core depends on its own storage contract. Get Modular composition is optional. The payment owner, commercial access, credit accounting and operational usage keep independent data and transaction boundaries.

**Prerelease deployment status, 2026-10-19:** integration and fixture qualification are available; production deployment remains blocked by an upstream Node runtime security issue. A bounded malformed-response probe terminates the tested Node processes through built-in `fetch`, including the latest published same-major releases. The development-only Undici correction does not patch production transport. The [security qualification record](docs/security-qualification.md#node-bundled-transport-scope) gives the evidence, its Paddle applicability limits and the admission requirements for a corrected official runtime.

The first supported commercial profile is **one no-trial monthly price, quantity one**, with **separate one-time top-ups**. Checkout preparation is not payment confirmation. Server-verified completed transactions, saved ownership and offer bindings, and versioned evidence support downstream decisions. Prices, quota sizes, access policy, credit consumption and refund-to-credit policy belong to the application.

## Packages

| Package | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `@agent-teams/payments-core` | Operations, evidence reduction, immutable delivery protocol, reconciliation contracts | Node built-ins; no Paddle, database or framework |
| `@agent-teams/payments-paddle` | Official Paddle SDK adapter, signature verification, normalized source-aware evidence | Core and `@paddle/paddle-node-sdk` 3.10.0 |
| `@agent-teams/payments-postgres` | Owner-local durable transactions, private Drizzle queries, migrations, bounded repair, pg-boss transport and recovery administration | Core, `pg`, `drizzle-orm`, `pg-boss` |
| `@agent-teams/payments-get-modular` | Static composition, optional purchase read projections, capability facets and explicit resource lifecycle | Core and qualified Get Modular peers |

The four packages currently declare version `0.2.0`; see the [migration notes](CHANGELOG.md). A version in a manifest does not establish npm publication or a GitHub release. Use the [release candidate artifacts and verification instructions](docs/releasing.md) for an existing matching tag, or build this checkout.

## Start here

- [Getting started](docs/getting-started.md): trusted configuration, catalog, checkout, webhook custody and consumer delivery.
- [Architecture and guarantees](docs/architecture.md): ownership, T1/T2/T3, uncertainty, identities and extension boundaries.
- [Operations and recovery runbook](docs/operations.md): migrations, concurrency, shutdown, reconciliation and independent restore.
- [Qualification and deployment gates](docs/qualification.md): what the automated suites prove and what needs a real deployment or Paddle sandbox.
- [Dependency and Node runtime security](docs/security-qualification.md): the qualified development dependency correction and the separate blocked production runtime admission.
- [Implementation and review status](docs/implementation-status.md): P0–P7 plan traceability, independent review reports and correction evidence.
- [Purchase observation](qualification/observation/README.md): optional public read projection, real Assembly/Resources/watch/load, and isolated packed qualification against the published registry train.
- [Current upstream qualification](docs/upstream-qualification.md): exact dependency pins, published Get Modular observation train and artifact identities, and the official browser declaration blocker.
- [Release process](docs/releasing.md): audited tarballs, checksums, exact-commit CI and GitHub prereleases.
- [Final SDK 0.2 evidence](docs/reviews/sdk-0.2-completion/README.md): complete two-floor qualification, independent tooling/source reviews and production logical code metrics.

Adapter-specific details stay in the [Paddle](packages/payments-paddle/README.md), [PostgreSQL](packages/payments-postgres/README.md) and [Get Modular](packages/payments-get-modular/README.md) package guides. The [accepted implementation plan](docs/implementation-plan.md) records design decisions and source provenance; current public signatures live in package exports and the compiled examples.

## Examples and development

The maintained `.ts` examples use the actual public APIs:

- [`examples/node-http.ts`](examples/node-http.ts): plain core factory and bounded Node HTTP ingress.
- [`examples/paddle-postgres.ts`](examples/paddle-postgres.ts): Paddle + durable PostgreSQL + explicit worker lifecycle, with host-supplied authentication and consumers.
- [`examples/fetch-modular.ts`](examples/fetch-modular.ts): Fetch handler using the real published static Assembly/Resources runtime.

Qualification targets Linux Node `24.21.0` and `26.11.1`, TypeScript `7.0.2`, pnpm `11.25.0` and PostgreSQL `18`. All maintained runtime, test and tool sources are `.ts`. Engineering Foundation `1.10.1` is a development dependency and must not enter a package's runtime closure.

```sh
pnpm install --frozen-lockfile
pnpm check:fast
# Use a disposable PostgreSQL 18 database; the integration suites create schemas.
DATABASE_URL=postgresql://postgres:test-only@127.0.0.1:5432/payments pnpm check
```

Fixture suites use the official Paddle SDK with network-disabled synthetic transport. They need no live Paddle credentials and make no real charges. [Qualification](docs/qualification.md) explains the scope and limits of that evidence.

License: [Apache-2.0](LICENSE).
