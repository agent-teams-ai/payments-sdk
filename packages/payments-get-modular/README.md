# @agent-teams/payments-get-modular

Optional Get Modular composition for the provider-neutral payment runtime. The Host supplies the same `PaymentRuntimeOptions` accepted by `createPayments()` from `@agent-teams/payments-core`. This package imports only that core and the published Get Modular composition/resource APIs. It does not create provider connections, database pools, HTTP routes, background workers, or product grants.

## Supported composition profile

| Package | Qualified artifact | Role |
| --- | --- | --- |
| `@get-modular/core` | `0.6.0` | Host peer |
| `@get-modular/assembly` | `0.6.0` | Host peer; descriptors, entries, groups, preparation, runs |
| `@get-modular/resources` | `0.2.0` | Host peer; explicit resource custody and close reports |
| `@get-modular/conformance` | `0.4.0` | Development tests only |
| `@get-modular/observation` | `0.1.0` | Optional Host peer; required only by `./observation` |

Keep one physical Resources package identity and a compatible Core/Assembly peer set. `scoped` validates the run scope using package-local identity; an independent nested Resources copy is incompatible even if its version matches. The package manifest uses the workspace's exact catalog pins for qualification. The package is ESM and targets Linux Node `>=24.21.0 <25 || >=26.11.1 <27`. Maintained source and tests are ordinary `.ts`, checked with TypeScript `7.0.2`, strict options and `skipLibCheck:false`.

A framework-neutral application can use `payments-core` directly and omit this package and all Get Modular peers.

## Composition

The definitions are inert. Importing `paymentsModule` or preparing a template opens no connection and executes no payment command. Configuration is a declared per-run input; one prepared template can serve independent application/account/environment runs without global mutable configuration.

```ts
import type { PaymentRuntimeOptions } from '@agent-teams/payments-core';
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import {
  PaymentsConfiguration,
  paymentsConfiguration,
  paymentsGroup,
  paymentsModule,
  type PaymentsCapabilities,
} from '@agent-teams/payments-get-modular';

const preparation = await assemblyFor<PaymentsCapabilities>().prepare({
  profileId: 'my-host/payments',
  modules: [paymentsGroup],
  inputs: { configuration: paymentsConfiguration },
  roots: { payments: paymentsModule },
});
if (preparation.status !== 'prepared') {
  throw new Error(preparation.error.code);
}
const prepared = preparation.prepared;

export async function createPaymentHost(options: PaymentRuntimeOptions, signal?: AbortSignal) {
  // Create the attempt before awaiting run. Keep control in the Host.
  const attempt = createScope({ name: `payments-${options.scope.applicationId}` });
  const outcome = await prepared.run({
    signal,
    scope: attempt.resources,
    inputs: { configuration: { [PaymentsConfiguration.id]: options } },
  });
  if (outcome.status !== 'succeeded') {
    const report = await attempt.control.close();
    if (!report.complete) throw new Error('Payment startup cleanup remains incomplete');
    throw new Error(`Payment composition ${outcome.status}`);
  }
  return {
    payments: outcome.roots.payments,
    close: () => attempt.control.close(),
  };
}
```

`PaymentRuntimeOptions.scope` and provider scope come from trusted server configuration. Authentication, local buyer authorization, offer ownership and customer-wide portal authorization remain Host responsibilities. A capability facet segregates API surface; it is not a security sandbox.

A larger Host adds `paymentsGroup` to its one composition root and consumes only the descriptors it needs. `paymentsDeclaration` and `paymentsConfigurationDeclaration` are exported for namespace and independent wiring checks. `paymentsConfiguration` belongs in the preparation's `inputs`, not `modules`.

## Capability facets

| Descriptor | Value / root facet | Authority |
| --- | --- | --- |
| `Checkout` | `PaymentsCheckout` / `checkout` | `startPurchase` |
| `Read` | `PaymentsRead` / `read` | `readOperation`, `readPurchase`, `readObservedSubscription`, `readSubscriptionSelection` |
| `Management` | `PaymentsManagement` / `management` | Explicit cancellation, payment update, authorized management link |
| `Processing` | `PaymentsProcessing` / `processing` | Verified admission, inbox/publication processing, operation dispatch, refresh, audited unknown resolution, audited subscription stream selection and bounded repair |
| `Delivery` | `PaymentsDelivery` / `delivery` | Consumer registration, durable delivery reads and acknowledgement |

The root also exposes the configured payment `scope` and read-only `lifecycle()` diagnostics. It does not expose the resource control or the core runtime's `stop()`/`drain()` methods. Consumers receive frozen facet objects and the actual core operation results, including `unsupported`, `pending`, and `outcome_unknown`.

Start checkout with `host.payments.checkout.startPurchase(...)`. A successful checkout is an instruction to show checkout, not a confirmed purchase or a product grant. Admit verified input through `processing.ingestVerifiedInput(...)`; process it explicitly; deliver resulting immutable evidence through the durable delivery protocol. Neither module construction nor lifecycle cleanup dispatches a financial command.

For duplicate initial subscription streams, the authorized Host reads `read.readSubscriptionSelection(buyerId, bindingId, providerSubscriptionRef)` and submits its `expectedReadSet` to `processing.selectSubscriptionStream(...)` together with the operator, audit reference and reason. The core validates the complete read set and persists the technical stream selection audit. A stale selection is rejected. The read facet cannot authorize the mutation, and the managed runtime remains the composition's single payment runtime throughout recovery.

## Ownership, cancellation and shutdown

The Host owns provider connections, the storage adapter, shared pools, HTTP ingress and any worker. The module borrows those dependencies. Its `resources.setup()` registers cleanup before its setup promise resolves. Cleanup stops core command admission, waits for every already admitted facet call and then waits for physical core/provider settlement. Facet calls after resource close begins reject with the scope's close reason.

Register Host-owned borrowed infrastructure before dependent scopes. Create one child attempt scope per application/account/environment runtime. Register the Host worker after the payment module, so reverse cleanup stops new claims and producers before draining the payment runtime. On shutdown, stop HTTP ingress and new commands first. Stop the worker's claims/scheduling, await its actual handlers and cleanup, close the payment attempt, and close a shared pool only after every dependent sibling scope is complete. The module never invokes a borrowed pool's `end()` or a borrowed provider's disposer.

An SDK deadline, an abort signal, or a worker stop timeout does not terminate a physical SDK promise. `close({ abandon })` can return `complete:false, settled:false` with debt while cleanup continues. Retain borrowed dependencies and join `close()` again after the work settles. `escalate` asks cleanup to release sooner; it does not erase unresolved work. A forced process termination leaves recovery obligations with the core/store protocol.

Assembly returns ordinary promises and a construction journal; it does not roll back or dispose created products. After any failed or cancelled run the Host closes the attempt scope. A failed partial startup uses the same close path. Closing one child does not close a sibling or their shared infrastructure. An exception raised by an optional Host startup step must also lead to attempt cleanup.

## Optional purchase observation

The public `@agent-teams/payments-get-modular/observation` subpath supplies one replaceable purchase read projection and an optional Assembly display consumer. Install Observation `0.1.0` when using that subpath. The main package entry remains a static composition surface and can be installed, typechecked and imported without Observation. Its optional peer metadata preserves that boundary; all participating modules must still share one physical Resources identity.

```ts
import { createScope } from '@get-modular/resources';
import { createPurchaseProjection } from '@agent-teams/payments-get-modular/observation';

const projectionScope = createScope({ name: 'authorized-purchase-view' });
const projection = createPurchaseProjection({
  read: { readPurchase: payments.readPurchase },
  initialQuery: { buyerId: authorizedBuyerId, intentId: authorizedIntentId },
  reportError: (report) => { hostErrors.push(report); },
}, { resources: projectionScope.resources });

const snapshot = projection.view.read(['state']);
render(snapshot.values.state); // Initial rendering is explicit.
projection.view.watch(snapshot, {
  resources: projectionScope.resources,
  name: 'purchase-screen',
  onChange: ({ values }) => { render(values.state); },
});
projection.commands.refresh(); // Explicitly re-read after a durable commit.
projection.commands.select(undefined); // Synchronously clear the current view.
await projectionScope.control.close();
```

The Host authorizes every initial or changed buyer/intent selection and lends an already scoped `readPurchase` port. The projection has no checkout, management, processing, grant or delivery authority. Its single readonly `state` is `idle`, `loading`, `ready` or `failed`. A ready value contains a finite copied purchase summary or `undefined` when absent. Source receipts, provider payloads and historical observation graphs remain with the payment owner. Failures expose only `{ code: 'purchase_read_failed' }`; an explicit refresh may recover them. The projection copies query inputs and nested summary data before Observation freezes its owned values, leaving borrowed public read results unchanged.

`select` and `refresh` synchronously invalidate the old ready view before returning. A direct read after switching buyer/intent cannot return the previous ready purchase under the new selection. Rendered notifications follow the later-task scheduling contract. There is one active physical read and at most one latest pending query; superseded results cannot publish. The borrowed reader's promise must include all physical work and cleanup. Cancellation does not prove that an uncancellable database read has stopped, and closing the projection waits for its real settlement. Keep the runtime and pool alive until the dependent scope is complete.

`watch` registers synchronously, returns `undefined`, supplies no initial callback and has no returned unsubscribe handle. Pass its actual source snapshot to catch up changes between read and registration. Callbacks run synchronously in later tasks, must return `undefined` and can receive coalesced current state. Subscriber scope close detaches the subscription. `load` retains one active run and one newest pending input, signals supersession and waits for physical settlement and cleanup before the successor starts. Intermediate states and requests may be dropped.

For Assembly composition, the subpath exports declared read/configuration/renderer inputs, `purchaseProjectionModule`, `purchaseProjectionDisplayModule`, `purchaseObservationGroup`, role descriptors and `PurchaseObservationCapabilities`. One prepared template supports independent per-run inputs. A Host can select only the projection root and omit the display module and renderer. The [complete composition and qualification guide](../../qualification/observation/README.md) shows the public API.

Checkout, charge, refund, granting or consuming rights/credits and durable evidence publication remain explicit financial commands and delivery protocols. A hook is a display/diagnostic projection, with no durable acknowledgement, replay or retry. Financial processing works when observation is absent, failing or already closed. No lifecycle event bus or provider retry is installed.

The coordinated official registry release is Core/Assembly `0.6.0`, Resources `0.2.0`, Conformance `0.4.0` and Observation `0.1.0`. [Registry identities](../../qualification/observation/published-artifacts.json) include SHA-512 integrity, SHA-256, publication timestamps and peers. Every published archive is byte-identical to the original retained upstream candidate; the [historical manifest](../../qualification/observation/upstream-artifacts.json) and earlier evidence remain unchanged. The [upstream qualification record](../../docs/upstream-qualification.md) distinguishes this published adoption from those historical prepublication results.

## Verification

The package tests exercise the real published Assembly, Resources and Conformance runtimes: a hand-written wiring/namespace oracle, module isolation, smoke success/failure/abort injection, two independent runs from one template, sibling ownership, provider promises held past command timeout, admitted storage reads during close, downstream startup failure, cancelled late resource acquisition and invalid configuration. An explicit checkout → verified input → processed fact → durable delivery → acknowledgement scenario verifies that financial processing needs no hook. A public Assembly run also preserves both duplicate initial payments, reads the selection basis, persists an audited support-stream choice, rejects a stale read set and releases only the selected stream's renewal hold. Strict compile-time probes prevent read facets from acquiring checkout or selection mutation methods.

Run the repository's `build`, `typecheck`, `lint`, `foundation:check`, `test:modular` and `test:observation` gates. The observation gate installs all four packed payments packages and exact public Get Modular versions into an isolated consumer, checks strict NodeNext/Bundler resolution, and runs real PostgreSQL read/lifecycle and independent T1/T2/T3 scenarios. Packed NodeNext and Bundler consumers remain repository release gates; installing this package should preserve exactly one qualified Get Modular peer identity.
