# @agent-teams/payments-get-modular

Optional Get Modular composition for the provider-neutral payment runtime. The Host supplies the same `PaymentRuntimeOptions` accepted by `createPayments()` from `@agent-teams/payments-core`. This package imports only that core and the published Get Modular composition/resource APIs. It does not create provider connections, database pools, HTTP routes, background workers, or product grants.

## Supported composition profile

| Package | Qualified artifact | Role |
| --- | --- | --- |
| `@get-modular/core` | `0.5.0` | Host peer |
| `@get-modular/assembly` | `0.5.0` | Host peer; descriptors, entries, groups, preparation, runs |
| `@get-modular/resources` | `0.1.0` | Host peer; explicit resource custody and close reports |
| `@get-modular/conformance` | `0.3.0` | Development tests only |

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
| `Read` | `PaymentsRead` / `read` | `readOperation`, `readPurchase`, `readObservedSubscription` |
| `Management` | `PaymentsManagement` / `management` | Explicit cancellation, payment update, authorized management link |
| `Processing` | `PaymentsProcessing` / `processing` | Verified admission, inbox/publication processing, operation dispatch, refresh, audited unknown resolution and bounded repair |
| `Delivery` | `PaymentsDelivery` / `delivery` | Consumer registration, durable delivery reads and acknowledgement |

The root also exposes the configured payment `scope` and read-only `lifecycle()` diagnostics. It does not expose the resource control or the core runtime's `stop()`/`drain()` methods. Consumers receive frozen facet objects and the actual core operation results, including `unsupported`, `pending`, and `outcome_unknown`.

Start checkout with `host.payments.checkout.startPurchase(...)`. A successful checkout is an instruction to show checkout, not a confirmed purchase or a product grant. Admit verified input through `processing.ingestVerifiedInput(...)`; process it explicitly; deliver resulting immutable evidence through the durable delivery protocol. Neither module construction nor lifecycle cleanup dispatches a financial command.

## Ownership, cancellation and shutdown

The Host owns provider connections, the storage adapter, shared pools, HTTP ingress and any worker. The module borrows those dependencies. Its `resources.setup()` registers cleanup before its setup promise resolves. Cleanup stops core command admission, waits for every already admitted facet call and then waits for physical core/provider settlement. Facet calls after resource close begins reject with the scope's close reason.

Register Host-owned borrowed infrastructure before dependent scopes. Create one child attempt scope per application/account/environment runtime. Register the Host worker after the payment module, so reverse cleanup stops new claims and producers before draining the payment runtime. On shutdown, stop HTTP ingress and new commands first. Stop the worker's claims/scheduling, await its actual handlers and cleanup, close the payment attempt, and close a shared pool only after every dependent sibling scope is complete. The module never invokes a borrowed pool's `end()` or a borrowed provider's disposer.

An SDK deadline, an abort signal, or a worker stop timeout does not terminate a physical SDK promise. `close({ abandon })` can return `complete:false, settled:false` with debt while cleanup continues. Retain borrowed dependencies and join `close()` again after the work settles. `escalate` asks cleanup to release sooner; it does not erase unresolved work. A forced process termination leaves recovery obligations with the core/store protocol.

Assembly returns ordinary promises and a construction journal; it does not roll back or dispose created products. After any failed or cancelled run the Host closes the attempt scope. A failed partial startup uses the same close path. Closing one child does not close a sibling or their shared infrastructure. An exception raised by an optional Host startup step must also lead to attempt cleanup.

## Observation hooks: explicit release gate

This published static profile has **no Get Modular observation package**. No `onInit`, `onStart`, `onStop`, `onPaymentCompleted`, watch replacement, or local event bus is shipped here. Required composition and the durable financial path work with observation completely absent.

The reviewed future contract is retained upstream PR [#195 at `3f5f3b303e99e4b8f919486d91d954f7f78e204d`](https://github.com/agent-teams-ai/get-modular/pull/195), with [public types](https://github.com/agent-teams-ai/get-modular/blob/3f5f3b303e99e4b8f919486d91d954f7f78e204d/packages/observation/src/features/store/types.ts), [watch implementation](https://github.com/agent-teams-ai/get-modular/blob/3f5f3b303e99e4b8f919486d91d954f7f78e204d/packages/observation/src/features/store/watch.ts), [load implementation](https://github.com/agent-teams-ai/get-modular/blob/3f5f3b303e99e4b8f919486d91d954f7f78e204d/packages/observation/src/features/store/load.ts), and [README](https://github.com/agent-teams-ai/get-modular/blob/3f5f3b303e99e4b8f919486d91d954f7f78e204d/packages/observation/README.md). These are a source-pinned pending design, not the current package API or a compatibility promise.

Before optional hooks can ship, qualify an actual released coherent train: the candidate names Core/Assembly `0.6.0`, Resources `0.2.0`, Conformance `0.4.0` and Observation `0.1.0`. Read back exact registry artifacts and peer identities, upstream acceptance and current source, then run strict packed consumers. Merged TypeScript prerequisite PR #197 is not publication or observation admission. Do not install one new observation package over the qualified `0.5/0.1` peers.

For the reviewed pending contract, the owner updates a read projection after durable commit or reconstructs it from persistent authority. The subscriber explicitly reads and renders its initial snapshot, then synchronously registers `facet.watch(snapshot, { resources, name, onChange })`. `watch` returns `undefined`, supplies no initial callback, and uses the source snapshot to catch up a change between read and registration. Callbacks are synchronous, return `undefined`, execute in a later task and can coalesce several commits into the newest state. Subscriber child-scope close releases the registration; there is no returned unsubscribe handle. There is no durable acknowledgement, replay or retry contract.

The pending `load` also registers synchronously and returns `undefined`. It allows at most one active run and one latest pending input. A newer input aborts the older run but waits for its actual promise settlement and cleanup before starting another run. A superseded result cannot publish. Each run releases temporary resources before its promise settles; it must not return an open resource that might be discarded. `onLoading` does not prove physical cancellation, and callback failure is not a durable retry.

Only replaceable read projections or diagnostics belong in these hooks. Checkout, charge, refund, granting rights/credits, consuming credits and publishing durable evidence remain explicit command/delivery operations. Store revisions do not replace provider versions or durable evidence revisions. Before adoption, test read/watch catch-up, deferred coalescing, subscriber/source close, callback error attribution, held-cleanup supersession, no stale publication and no leaked subscriptions against the real released observation runtime and its testing waits. This package's static tests make no observation qualification claim.

## Verification

The package tests exercise the real published Assembly, Resources and Conformance runtimes: a hand-written wiring/namespace oracle, module isolation, smoke success/failure/abort injection, two independent runs from one template, sibling ownership, provider promises held past command timeout, admitted storage reads during close, downstream startup failure, cancelled late resource acquisition and invalid configuration. An explicit checkout → verified input → processed fact → durable delivery → acknowledgement scenario verifies that financial processing needs no hook. Strict compile-time probes prevent read facets from acquiring checkout or processing methods.

Run the repository's `build`, `typecheck`, `lint`, `foundation:check` and `test:modular` gates. Packed NodeNext and Bundler consumers remain repository release gates; installing this package should preserve exactly one qualified Get Modular peer identity.
