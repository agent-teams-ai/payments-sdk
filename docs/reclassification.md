# Durable classification changes

Completion facts describe settled provider transactions. Their identity, commercial purpose,
original paid period, originating intent, and offer remain immutable. A later discovery of
another initial purchase, or an audited choice of subscription stream, changes whether an
already observed renewal is eligible for automatic support. It does not create a new payment
or rewrite the original completion.

## Subscription decisions and dependent work

`SubscriptionBinding.classificationDecision` records the core-owned decision revision and
whether duplicate initial purchase evidence has been established. Older bindings without the
field have revision zero and no recorded duplicate decision. The duplicate knowledge remains
true after a stream is selected; selection resolves support for the selected stream without
removing the two initial monetary facts or their duplicate flags.

When duplicate initial knowledge first becomes true, core increments the decision revision
and writes a `SubscriptionReclassification` obligation in the same reduction commit as the
binding change. Every accepted `selectSubscriptionStream` command likewise increments the
revision and replaces the obligation with an unfinished traversal starting at the beginning.
The command validates its complete expected read set, including the binding and obligation;
a stale selection cannot overwrite a newer decision.

The obligation is keyed by subscription binding and includes the decision revision, an
optional `afterTransactionRef` cursor, and a completion marker. It is durable owner state,
independent of inbox processing state, delivery acknowledgement, or queue retention.
Acknowledging the original renewal delivery therefore cannot suppress a later correction.

`PaymentStore.processReclassification(scope, bindingId, limit)` is a storage traversal port.
It reads the current binding and obligation, verifies their decision revisions agree, and
marks at most `limit` transaction aggregates structurally bound to the originating intent for
publication. It advances the transaction reference cursor atomically with those publication
obligations. The supported limit is 1–100. Membership, binding changes, transaction changes,
and cursor advancement must be serialized using the store's owner-local guards and record
locks. The adapter traverses structural relationships; it does not implement origin,
commercial purpose, duplicate, stream-selection, or paid-period policy in SQL.

Ordinary `flushPublication` loads a bounded current read set and reuses `reduceObservation`
and `classifyCompletion` for the saved transaction observations. The current binding decides
which renewal is held. The immutable completion remains intact and the ordinary evidence
revision and delivery path publishes any correction. Both initially held renewals and
previously acknowledged unheld renewals take this same path.

A dependent inserted or rebound after a traversal cursor has passed its reference must
classify against the current binding as part of its ordinary reduction or durable publication
work. Its binding read set prevents a stale reduction from committing across a decision
change. This avoids retaining a scope-wide history snapshot or restarting an otherwise
complete traversal for every new renewal. A newer decision always resets the traversal,
including decisions made while an earlier page is still outstanding.

The public runtime exposes `processReclassification(bindingId, limit = 25)` for worker
composition. `repair(limit)` discovers durable unfinished obligations through
`listWork('reclassification', limit)`, processes bounded pages before ordinary publication,
and reports the number of obligations processed as `reclassifications`. Repeated repair calls
finish larger fanouts. Queue jobs are wakeups for this durable state; repair must be able to
reconstruct them after deletion. No synthetic provider receipt or replay of an acknowledged
inbox record is required.

## Exact-version adjustment parent contradictions

An adjustment's exact-version certification retains its original projection independently
of the current adjustment watermark. If another receipt claims the same adjustment identity
and exact version under a different transaction parent, both transaction aggregates are
affected. Neither the incoming parent alone nor the latest watermark is sufficient.

The core helper `objectVersionDependentRoutes(observation, evidence)` returns the incoming
route and, for a certified adjustment projection, its retained original parent. This is at
most two transaction parents. Storage adapters load both parents, their bindings, and the
necessary bounded classification read sets before reduction. A concurrent change to either
parent invalidates the prepared commit.

Core marks both aggregates conflicted and publishes both corrections atomically with the
conflicted certification. The original certified projection is retained with `conflict: true`;
the contradictory incoming adjustment is not installed under the new parent. A newer valid
adjustment watermark on the original parent remains intact. Acknowledgement, runtime restart,
receipt replay, and explicit later publication do not clear the conflict.

## Verification

Focused core scenarios cover an acknowledged renewal before late duplicate discovery,
restartable bounded cursor progress, selection and reselection, stale selection and reduction
read sets, a new dependent behind the cursor, and an exact-version parent contradiction after
watermark advancement. They assert correction revisions and immutable completion facts, and
verify that replay of already processed custody does not create another delivery.
