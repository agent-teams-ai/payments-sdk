# Payments SDK

An embeddable TypeScript SDK for applications that need reliable payment operations and durable payment evidence. Paddle Billing is the first provider. Use it to prepare checkout, verify and reconcile provider observations, manage supported subscriptions, and deliver versioned evidence to your application's access and credit owners.

The SDK keeps payment state separate from commercial access, credit accounting and usage. Your application owns authentication, prices, quota sizes, entitlement rules, credit consumption and refund-to-credit policy. Checkout preparation does not confirm payment or grant a benefit.

## Supported profile

- **Subscriptions:** one monthly recurring price, quantity **1**, with no trial.
- **Top-ups:** separate one-time purchases, independent of the subscription.
- **Operations:** checkout, verified webhook intake, provider reads and reconciliation, cancellation, payment-method updates and authorized customer management links.
- **Recovery:** durable inbox and evidence delivery, replay protection, and explicit unknown outcomes. After a durable dispatch marker, an uncertain external mutation is never retried automatically.

Trials, mixed baskets/seats, plan-change/proration commands, pause/resume, manual invoices, off-session charging, provider usage billing and refund initiation are outside the supported command profile. Unsupported external changes remain observable and can hold fulfillment; they are not silently accepted. See [architecture and guarantees](docs/architecture.md).

## Choose your packages

| Package | Use it for |
| --- | --- |
| `@agent-teams/payments-core` | Provider-neutral operations, evidence and delivery contracts. Supply your own `PaymentProvider`, `PaymentStore` and `Catalog`; no database or framework is required by core. |
| `@agent-teams/payments-paddle` | Paddle Billing through the official Paddle Node SDK, including signature verification and evidence normalization. |
| `@agent-teams/payments-postgres` | Durable PostgreSQL storage, migrations, workers and recovery. Drizzle stays private to this adapter. |
| `@agent-teams/payments-get-modular` | Optional static Assembly composition, Resources lifecycle and capability facets. Its optional `/observation` entry supplies read projections. |

For Paddle with durable storage, choose core + Paddle + PostgreSQL. The PostgreSQL root requires neither `pg` nor `pg-boss`: select the optional `/node-postgres` driver wrapper and `/pg-boss` transport explicitly, or supply the adapter-owned database and transactional transport contracts. The driver wrapper can borrow an existing host pool, including one used by Drizzle. Get Modular is optional for every other package; observation hooks do not replace durable financial delivery.

All four packages currently declare **`0.4.0`** and emit ESM JavaScript and declarations. This version is **not published to npm**. Build this checkout, or use matching verified prerelease tarballs when available. The [release and installation guide](docs/releasing.md) covers checksums, package overrides and installation; the [0.4 migration guide](docs/migrations/0.4.md) explains the separate provider/storage contracts and Get Modular revision changes. Earlier changes remain in the [changelog](CHANGELOG.md).

**Current qualification:** Linux Node **24.22.1 LTS** and **26.12.1** are the corrected runtime floors. The [0.4 source candidate](docs/qualification.md#sdk-04-source-candidate) has its own fresh qualification; [older hosted baselines](docs/qualification.md#reviewed-hosted-baselines) remain bound to their recorded sources. Each revision requires its own checks; deployment and Paddle-account gates remain separate. See [runtime admission status](docs/runtime-security-admission.md) and [qualification](docs/qualification.md) before production use.

**Governance rollout:** full FMS and native SDK checks are part of this source. Installation of the new central identity/admission workflows and organization-wide registration remain a separate [tracked activation](docs/governance-rollout.md); source integration does not claim that administrative deployment is complete.

## Start here

The following compilable host skeleton receives **host-built configuration**: trusted `scope` and `producerNamespace`, a provider, a store and a server-controlled catalog through `PaymentRuntimeOptions`. It is not a standalone demo. Construct it once per host lifetime; authenticate the buyer before calling `startCheckout`.

```ts
import { createPayments } from '@agent-teams/payments-core';
import type { PaymentRuntimeOptions } from '@agent-teams/payments-core';

export function createCheckoutHost(options: PaymentRuntimeOptions) {
  const payments = createPayments(options);

  return {
    payments,
    startCheckout(buyerId: string, offerId: string, requestKey: string) {
      return payments.startPurchase({ buyerId, offerId, requestKey });
    },
    async close() {
      payments.stop();
      await payments.drain();
    },
  };
}
```

Reuse the same `requestKey` for retries of one logical purchase. A `succeeded` result contains `value.intentId`, `value.transactionRef` and the provider's `value.checkout` descriptor (optional URL/token). It means checkout is prepared. Preserve the distinct `pending`, `outcome_unknown`, `rejected` and `unsupported` results instead of treating them as confirmation or starting another mutation.

A complete integration also needs verified webhook custody, background processing and delivery to independent consumers. [Getting started](docs/getting-started.md) walks through trusted identities, catalog snapshots, migrations, checkout, webhooks and consumer acknowledgement. Each consumer commits its receipt plus effect or durable held obligation in its own transaction before acknowledgement; the SDK exposes no shared payment-plus-credit transaction.

Use these maintained, typechecked examples for the host you are building:

| Example | What it composes |
| --- | --- |
| [`examples/node-http.ts`](examples/node-http.ts) | Plain core factory and bounded Node HTTP ingress; host authentication stays explicit. |
| [`examples/paddle-postgres.ts`](examples/paddle-postgres.ts) | Paddle, durable PostgreSQL, separate bootstrap, worker startup and shutdown; host supplies pools, authentication and consumers. |
| [`examples/fetch-modular.ts`](examples/fetch-modular.ts) | Fetch handler with the published Get Modular Assembly/Resources runtime. |

Stop HTTP ingress and other producers before shutdown. Keep borrowed pools open until workers and payment calls have physically drained; the complete durable example owns that ordering.

## Documentation

| Need | Guide |
| --- | --- |
| Build an integration | [Getting started](docs/getting-started.md), plus the [Paddle](packages/payments-paddle/README.md), [PostgreSQL](packages/payments-postgres/README.md) and [Get Modular](packages/payments-get-modular/README.md) package guides |
| Understand guarantees and boundaries | [Architecture](docs/architecture.md), [storage portability](docs/storage-portability.md) and [queue transports](docs/queue-transport.md) |
| Operate and recover | [Operations runbook](docs/operations.md) and [qualification/deployment gates](docs/qualification.md) |
| Verify dependencies or release artifacts | [Upstream qualification](docs/upstream-qualification.md), [security qualification](docs/security-qualification.md) and [releasing](docs/releasing.md) |
| Review implementation evidence | [Implementation status](docs/implementation-status.md) and the [review index](docs/reviews/README.md) |
| Complete central governance activation | [Source delivery and governance rollout](docs/governance-rollout.md) |

The [accepted implementation plan](docs/implementation-plan.md) records design decisions. Package public exports and the compiled examples own current API signatures; historical review records qualify their recorded source and artifacts.

## Examples and development

Use Linux Node **24.22.1** or **26.12.1**, pnpm **11.25.0**, TypeScript **7.0.2**, and PostgreSQL **18** for integration tests. Maintained runtime, test and tool sources are ordinary `.ts`; Engineering Foundation is development-only. Read [AGENTS.md](AGENTS.md) and the [developer stack](docs/developer-stack.md) before contributing.

The owner-selected [full Feature Module Standard adoption](docs/feature-module-adoption.md)
and [local profile](architecture/feature-module-standard.json) define the four
packages' module and feature boundaries. The
[proposed central bootstrap rollout](https://github.com/agent-teams-ai/.github/pull/381)
owns new-repository registration and enforcement; its pending activation is
separate from the native full-FMS checks. The
[delivery boundary](docs/governance-rollout.md) and original
[delivery plan](docs/reviews/full-fms-adoption/plan.md) distinguish source
implementation, hosted qualification, registration and remote enforcement.

```sh
pnpm install --frozen-lockfile
pnpm check:fast

# Full qualification: use a disposable PostgreSQL 18 database.
# Integration suites create schemas in this database.
DATABASE_URL=postgresql://postgres:test-only@127.0.0.1:5432/payments pnpm check
```

`check:fast` checks the toolchain, strict types, lint, Foundation and Get Modular adoption. `check` adds runtime security, behavior, real PostgreSQL/E2E, packed-consumer and release-archive gates. Fixture tests use the official Paddle SDK with network-disabled synthetic transport: **no live Paddle credentials or real charges are needed**. Their scope and remaining deployment checks are documented in [qualification](docs/qualification.md).

## License

[Apache-2.0](LICENSE).
