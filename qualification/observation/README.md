# Candidate purchase read projection

This is an implemented optional Get Modular hooks consumer qualified separately from the supported SDK package profile. It uses the five exact original candidate archives retained by upstream at `c5c314ab98c57d2c73448f0c3c9860424a993d8a`: Core/Assembly 0.6.0, Resources 0.2.0, Conformance 0.4.0 and Observation 0.1.0. Their source and checksums are recorded in `upstream-artifacts.json` and upstream's [release handoff](https://github.com/agent-teams-ai/get-modular/blob/c5c314ab98c57d2c73448f0c3c9860424a993d8a/research/releases/observation-0.1.0/release-intent.md).

These archives were still unpublished at the official registry read-back on 2026-10-20. Candidate qualification does not change the SDK's supported static Get Modular peers or establish a published hooks release. Accepted upstream ADR-0038 permits testing exact unpublished candidates. The accepted payments plan's published-release adoption gate remains in force.

## API and ownership

`projection.ts` owns one selected purchase view and its explicit view commands:

```ts
const projection = createPurchaseProjection({
  read: { readPurchase: payments.readPurchase },
  initialQuery: { buyerId: authorizedBuyerId, intentId: authorizedIntentId },
  reportError: (report) => { hostErrors.push(report); },
}, { resources: projectionScope.resources });

projection.commands.refresh(); // Explicitly re-read after a durable commit.
projection.commands.select({ buyerId: anotherAuthorizedBuyer, intentId: anotherAuthorizedIntent });
projection.commands.select(undefined); // Immediately clear the view.
```

The Host authorizes every initial or changed selection and provides a runtime already scoped to the trusted application/account/environment. A capability facet is not a security sandbox. The projection receives only `Pick<Payments, 'readPurchase'>`; it has no checkout, processing, management, grant or durable acknowledgement authority.

`view` is a real `ReadonlyStore<PurchaseProjectionRecord>` with one fixed `state` key. States are `idle`, `loading`, `ready` and `failed`. Ready carries the selected query and a purchase summary, which can be `undefined` when not found. The summary retains intent/buyer identity, the promised offer and creation time; each transaction retains its identity, local/evidence revisions, current/retained flags and pending adverse identities, completion fact identity/classification/total and current status/version. Recursive receipt sources and historical observation graphs stay with the payment owner. Failed carries the query and `{ code: 'purchase_read_failed' }`; database/provider error strings are not exposed. A later explicit refresh can recover a failed view. Query inputs and every retained nested summary value are copied before the store takes ownership and freezes them, so the Host's objects remain untouched.

There is one current request, one active query and at most one latest pending query. Refresh requests are replaceable state, not events or financial revisions. No timer, polling, automatic retry, global bus or history buffer is installed. An external writer's durable change becomes visible after explicit refresh or reconstruction; the view is not a continuously current authority for financial or authorization decisions.

The Host owns the existing `createPayments()` runtime, provider, storage adapter and pool. Register those before dependent projection scopes. The projection's load waits for the complete borrowed read promise, including that reader's physical cleanup. `readPurchase` has no cancellation contract: supersession does not pretend it stopped. Closing a projection drains it without stopping or disposing the borrowed runtime or pool. Retain borrowed infrastructure until dependent close reports are complete; abandonment or escalation does not prove physical settlement.

## Real Assembly composition

`composition.ts` exports declared inputs, required slots, a projection module and a display module. Definitions are inert. One prepared template can be run with independent per-run inputs:

```ts
const preparation = await assemblyFor<ObservationCandidateCapabilities>().prepare({
  profileId: 'my-host/payments-observation-candidate',
  modules: [observationCandidateGroup],
  roots: { projection: purchaseProjectionModule, display: purchaseProjectionDisplayModule },
  inputs: {
    read: purchaseReadInput,
    configuration: projectionConfigurationInput,
    renderer: projectionRendererInput,
  },
});
if (preparation.status !== 'prepared') throw new Error(preparation.error.code);
const hostOwner = createScope({ name: 'payment-host' });
// Register Host-owned shared infrastructure before this existing runtime.
hostOwner.resources.use({ [Symbol.asyncDispose]: async () => {
  payments.stop();
  await payments.drain();
} }, 'payments-runtime');
const attempt = hostOwner.resources.child({ name: 'purchase-view-attempt' });
const outcome = await preparation.prepared.run({
  scope: attempt.resources,
  inputs: {
    read: { [PurchaseReader.id]: { readPurchase: payments.readPurchase } },
    configuration: { [ProjectionConfiguration.id]: { initialQuery, reportError } },
    renderer: { [ProjectionRenderer.id]: { render: (state) => { screen.show(state); } } },
  },
});
// The Host closes attempt.control after failed startup or when the view ends.
// At Host shutdown, hostOwner.control.close() drains the child before the runtime.
```

The projection root provides `{ view, commands }` to the authorized Host. Other modules can receive only the `ProjectionView` descriptor. The display receives that readonly facet and a render port, explicitly renders its initial snapshot and then registers `watch`. Its root exposes only `current()`, which directly reads the latest output state. A Host needing only the projection can select `purchaseProjectionModule` by itself and omit the renderer input/display module.

## Observation semantics

`watch` registers synchronously and returns `undefined`. It supplies no initial callback and no returned unsubscribe handle. Pass the actual snapshot obtained through the same facet; a change between read and registration catches up later. Notifications run in later tasks and can coalesce several commits. Render callbacks must be synchronous block bodies returning `undefined` and must not issue commands that mutate the watched projection. They need not see every transition.

`select` and `refresh` synchronously put the output into loading, and clearing puts it into idle, before returning. Consequently a direct read after switching buyer/intent cannot expose the previous buyer's ready value as the new selection. Rendered updates still follow Get Modular's documented later-task scheduling; an already rendered screen can show its prior state until delivery. `current()` reads the store directly when a current same-turn view is required. No view may authorize a financial effect.

The real `load` starts asynchronously using the newest request. It signals supersession, waits for physical read settlement and cleanup, serializes successors and drops stale results/errors. Loading explicitly removes the previous purchase value. Its callbacks write only the separate output store. All output values are replaceable read data, so dropping intermediate requests preserves their meaning.

Observation reports callback failures with source, subscription, revision and cause through the configured Host error sink. The sink must not throw. A failed render stays subscribed and receives later revisions; no durable retry or acknowledgement exists. Subscriber scope close detaches immediately. Source close reports `observation.source.closed`, detaches subscribers and aborts/drains loads; the readonly facet then rejects reads. Normal static dependency cleanup closes display consumers before their projection source.

## Qualification boundary

The maintained candidate runner installs real payments archives and the five verified GM archives into a separate consumer, preserving one physical peer identity. Strict TS 7.0.2 NodeNext/Bundler checks use `skipLibCheck:false`. The suite uses real Assembly/Resources/Observation and public packed payment APIs with real PostgreSQL and test-process emulation of the official Paddle SDK transport. It exercises initial purchase, renewal, top-up, lost-ACK replay and independent credit/access delivery beside view refresh, listener failures, coalescing, stale-load suppression, retained cleanup, source/subscriber close and sibling isolation. Existing SDK suites retain their separate adverse-evidence/correction coverage.

`surface.types.ts` contains strict negative probes for readonly ownership, financial capability isolation, authentic snapshots, callback return types and future union narrowing. It is typechecked and never executed. Only tests import `@get-modular/observation/testing`; tests use its waits and explicit barriers, never fixed sleeps.

The runner's actual evidence owns the pass/fail claim. Final supported adoption still requires downloading the exact published registry bytes, checking all five archive identities and peers, rerunning the consumer on those bytes and making a coherent SDK dependency adoption change. These files do not perform npm publication, tag promotion or an accepted ADR change.
