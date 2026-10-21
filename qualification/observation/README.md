# Published purchase observation consumer

This required qualification suite consumes `@agent-teams/payments-get-modular/observation` from the packed SDK archive. It installs the exact official registry releases Core/Assembly `0.7.0`, Resources `0.2.1`, Conformance `0.5.0` and Observation `0.2.0`. The [published artifact record](published-artifacts.json) binds official version metadata, SHA-512 integrity, SHA-256, archive sizes and packed peer/dependency contracts. The runner checks those official bytes and metadata before ordinary public-version installation.

The October 20 train and its equality with the original upstream candidates remain in the [historical published record](published-artifacts-2026-10-20.json). The original [candidate manifest](upstream-artifacts.json) and [prepublication review/evidence files](../../docs/reviews/observation) remain historical records. The current manifest binds the new official archives to release merge `7131d0d7a6bb5dd4c3e8906ccac065c0be0e0333` and its successful publication workflow. One maintained isolated consumer gate checks the delivered projection implementation.

## API and ownership

The public `createPurchaseProjection` owns one selected purchase view and its explicit view commands:

```ts
import { createPurchaseProjection } from '@agent-teams/payments-get-modular/observation';

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

The public observation subpath exports declared inputs, required slots, a projection module and a display module. Definitions are inert. One prepared template can be run with independent per-run inputs:

```ts
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import {
  PurchaseReader, ProjectionConfiguration, ProjectionRenderer,
  purchaseObservationGroup, purchaseProjectionModule, purchaseProjectionDisplayModule,
  purchaseReadInput, projectionConfigurationInput, projectionRendererInput,
  type PurchaseObservationCapabilities,
} from '@agent-teams/payments-get-modular/observation';

const preparation = await assemblyFor<PurchaseObservationCapabilities>().prepare({
  profileId: 'my-host/payments-observation',
  modules: [purchaseObservationGroup],
  roots: { projection: purchaseProjectionModule, display: purchaseProjectionDisplayModule },
  inputs: {
    read: purchaseReadInput,
    configuration: projectionConfigurationInput,
    renderer: projectionRendererInput,
  },
});
if (preparation.status !== 'prepared') throw new Error(preparation.error.code, {
  cause: { error: preparation.error, diagnostics: preparation.diagnostics },
});
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
// At shutdown, first close the dependent view and inspect its report.
const patientClose = attempt.control.close({ escalate: shutdownEscalation });
const viewClose = await patientClose;
if (!viewClose.complete) {
  // Retain hostOwner, the pool and attempt control when real cleanup failed.
  throw new Error('Purchase view cleanup remains incomplete', { cause: viewClose });
}
await hostOwner.control.close(); // Only after every dependent view has completed.
```

The projection root provides `{ view, commands }` to the authorized Host. Other modules can receive only the `ProjectionView` descriptor. The display receives that readonly facet and a render port, explicitly renders its initial snapshot and then registers `watch`. Its root exposes only `current()`, which directly reads the latest output state. A Host needing only the projection can select `purchaseProjectionModule` by itself and omit the renderer input/display module.

The shutdown fragment runs when that view ends, after stopping ingress or new work. Under the successor report-and-await contract, escalation reports `observation.load.still-running` to the named error sink while the patient close waits for the physical read and its finally cleanup. A Host needing a bounded response retains `patientClose` and the attempt control, and may separately await `close({ abandon })` for an unsettled snapshot. That snapshot never authorizes closing the borrowed runtime or pool. Wait for the retained close; do not retry cleanup or a financial mutation automatically. Genuine failed cleanup still requires explicit Host recovery before releasing borrowed dependencies.

The published successor passed the installed gate on Linux x64 Node `24.22.1` and `26.12.1` with PostgreSQL `18`, strict NodeNext/Bundler and identical four packed SDK archives. The [adoption record](../../docs/get-modular-adoption.md) retains the reviewed scope. Candidate archive tests remain historical evidence.

## Observation semantics

`watch` registers synchronously and returns `undefined`. It supplies no initial callback and no returned unsubscribe handle. Pass the actual snapshot obtained through the same facet; a change between read and registration catches up later. Notifications run in later tasks and can coalesce several commits. Render callbacks must be synchronous block bodies returning `undefined` and must not issue commands that mutate the watched projection. They need not see every transition.

`select` and `refresh` synchronously put the output into loading, and clearing puts it into idle, before returning. Consequently a direct read after switching buyer/intent cannot expose the previous buyer's ready value as the new selection. Rendered updates still follow Get Modular's documented later-task scheduling; an already rendered screen can show its prior state until delivery. `current()` reads the store directly when a current same-turn view is required. No view may authorize a financial effect.

The real `load` starts asynchronously using the newest request. It signals supersession, waits for physical read settlement and cleanup, serializes successors and drops stale results/errors. Loading explicitly removes the previous purchase value. Its callbacks write only the separate output store. All output values are replaceable read data, so dropping intermediate requests preserves their meaning.

Observation reports callback failures with source, subscription, revision and cause through the configured Host error sink. The sink must not throw. A failed render stays subscribed and receives later revisions; no durable retry or acknowledgement exists. Subscriber scope close detaches immediately. Source close reports `observation.source.closed`, detaches subscribers and aborts/drains loads; the readonly facet then rejects reads. Normal static dependency cleanup closes display consumers before their projection source.

## Qualification boundary

`pnpm test:observation` installs all four real payments archives and the five exact published Get Modular releases into a separate consumer, preserving one physical peer identity. Strict TS 7.0.2 NodeNext/Bundler checks use `skipLibCheck:false`. The suite uses real Assembly/Resources/Observation and public packed payment APIs with real PostgreSQL and test-process emulation of the official Paddle SDK transport. It exercises initial purchase, renewal, top-up, lost-ACK replay and independent credit/access delivery beside view refresh, listener failures, coalescing, stale-load suppression, retained cleanup, source/subscriber close and sibling isolation. Existing SDK suites retain their separate adverse-evidence/correction coverage.

`surface.types.ts` contains strict negative probes for readonly ownership, financial capability isolation, authentic snapshots, callback return types and future union narrowing. It is typechecked and never executed. Only tests import `@get-modular/observation/testing`; tests use its waits and explicit barriers, never fixed sleeps.

The runner's actual `.artifacts/observation-published-node-*.json` and `.log` files own the current pass/fail claim on both supported Node floors. It imports the public packed subpath for all projection/composition behavior; no source implementation or tests from inside the SDK package enter that archive. Test-only independently owned credit/access fixtures remain in this external consumer harness. A separate static packed consumer verifies that the main integration entry needs no Observation installation. This bounded consumer qualification does not establish live Paddle sandbox behavior or production runtime admission.
