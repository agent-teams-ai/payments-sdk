# Durable bounded reconciliation

`createPaymentReconciler` is a provider-neutral read use case. The host supplies one scoped
`PaymentStore`, a `ReconciliationSource`, scan identities and scheduling. The Paddle source
uses only the official SDK's public `events.list(...).next()` and
`adjustments.list(...).next()`. Every invocation constructs a fresh collection from the
application's durable pre-page cursor.

```ts
import { createPaymentReconciler } from '@agent-teams/payments-core';
import { createPaddleReconciliationSource } from '@agent-teams/payments-paddle';

const reconciler = createPaymentReconciler({
  scope,
  store,
  source: createPaddleReconciliationSource(provider),
});

await reconciler.beginScan({
  scanId: 'transactions-2026-10-01',
  epoch: 'deployment-retained-epoch-1',
  query: {
    kind: 'events',
    from: '2026-09-30T23:55:00Z',
    to: '2026-10-02T00:00:00Z',
    eventType: 'transaction.completed',
    perPage: 100,
    purpose: 'catch_up',
    queryVersion: 'paddle-events/1',
  },
});

// Each call performs at most one SDK page acquisition and one atomic page commit.
// A pg-boss scan callback can await reconciler.resumeScan(checkpoint).
await reconciler.resumeScan('transactions-2026-10-01');
```

`beginScan` persists the full immutable query and its fingerprint before acquisition. The
PostgreSQL store persists its scan obligation in the same transaction. Query fingerprinting
includes the exact payment scope and epoch. An existing scan identity cannot be rebound to
a different query or epoch. Pass the persisted checkpoint to `resumeScan` when an existing
worker claim must also reject a superseded checkpoint. Legacy checkpoints without a full
query require an explicit migration before this use case can resume them.

A successful page commit atomically admits every returned receipt, including unsupported
or incomplete observations, and saves the last acquired ID. The retained SDK-mapped
representation is preserved exactly and its digest is checked before admission. Query
acquisition and mapping run outside SQL transactions. Store CAS rejects stale concurrent
pages before they can admit any inputs. Inbox processing remains the ordinary payment
runtime's independently repairable responsibility.

An empty nonterminal page, nonprogressing ID, custody mismatch, SDK mapping failure,
read failure or 429 records a durable `gap` at the unchanged pre-page cursor. The checkpoint
retains the failure reason, time, SDK version when available, classified error code when
available, and failure count. A gap is visible and quarantined rather than automatically
spinning. After diagnosis or an appropriate host cooldown, `retryScan` explicitly returns
that same checkpoint to runnable work; the following `resumeScan` rereads the original
cursor. No partly mapped members are represented as acquired. A poison SDK member may
require a new SDK release or manual recovery before progress is possible.

Event `from` and `to` are exclusive registration-time boundaries. Schedule independently
required event types in separate scans. `nextReconciliationWindow` derives a fixed
next window with positive overlap; persist that window before reading it. Bounded catch-up
windows must be supplemented with periodic wider retention sweeps and per-transaction
adjustment scans for relevant completed transactions. An adjustment scan uses
`{ kind: 'adjustments', transactionRef, queryVersion }`; it has a durable independent cursor
and preserves adverse routing even if a returned member's financial shape is unsupported.
The host selects a bounded number of these scan obligations per scheduling pass.

`coverage` accepts a bounded set of required scan IDs, optional required event types and a
fixed requested window. It reports missing, running and gap scans, incomplete required-type
window coverage, and unretained history when the host supplies `historyAvailableFrom`.
Adjacent exclusive windows without overlap do not establish continuous coverage. A
`queries_exhausted` result means only that the selected queries were exhausted. The
result always has `historyComplete: false`: provider visibility has no assumed absolute
bound, Paddle event history is retained for a limited period, and entity refresh alone
cannot reconstruct missing historical refunds. Keep local financial history and recorded
coverage limitations independently of queue cleanup.

SDK 3.10.0 publicly forwards the additional `from`/`to` query parameters although its
published type omits them. Tests prove the exact SDK request serialization using synthetic
fixtures; they do not establish live API acceptance. If those filters are rejected, the
scan stays a visible gap. A host must qualify its API profile before enabling this path in
its own environment; this implementation does not secretly replace the public SDK with
a raw HTTP acquisition path.
