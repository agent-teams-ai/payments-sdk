# Wave 3 — independent monetary/consumer review

Reviewed immutable `research/reviews/wave3-plan.md`, SHA-256 `55a2828dadae96c92e23a3d137ee5b3c52b9b7210c5c1d0211c8cdb9d430bcd7`, in full, together with the complete supplied brief and Q 1.1.2. No other critic report or review journal was read. This is a design review; no implementation, payment-account action, or runtime qualification was performed.

**Result: no P0; one P1 contract gap and one P2 fixture-contract contradiction.** Both concern combinations of cases already admitted by this plan, rather than a demand for broader product policy. The consumer revision guard, separate decision redrive, basis-wide read-set/CAS, subscription feed, and durable publication of adverse quarantine flags are meaningful repairs. I have not repeated the earlier generic requests for those mechanisms.

## P1 — Initial recurring fulfillment has no declared guard across duplicate provider subscriptions/periods for one intent

**Targets:** §4, lines 125–127; §6, line 204; §12 fixture rows 337 and 344.

The plan explicitly permits an operator to authorize a new linked attempt while accepting the risk that the original external mutation happened. A late result remains a separate observation and may reveal a duplicate payment. It then promises that fulfillment of the original order remains once only. That is the correct invariant, but the concrete recurring grant key does not establish it: it contains a local subscription binding and the exact paid period, without an initial-intent fulfillment identity.

The provider-specific premise is narrow and primary-sourced: Paddle documents that completing an automatically collected transaction with recurring items creates the associated subscription. Consequently two distinct initial recurring transactions can have distinct associated subscription IDs. See [Paddle transaction.completed](https://developer.paddle.com/webhooks/transactions/transaction-completed/), accessed 2026-10-19, processing description. The following trace and assessment are my own contract reasoning, not a claim that Paddle automatically charges a newly created draft transaction or that a normal retry necessarily produces two paid checkouts.

### Counterexample

1. Initial monthly intent `I` fixes buyer `U`, benefit slot `S`, and offer version `V`.
2. Attempt `a` becomes unknown. An authorized resolution permits linked attempt `b`, explicitly accepting duplicate risk. Eventually there is authenticated evidence of two completed initial transactions `TA` and `TB` for `I`. The plan already requires this anomaly to remain representable; it cannot be dismissed because ordinary automatic retry is prohibited.
3. `TA` relates to provider subscription `PA`; `TB` relates to provider subscription `PB`. Their initial paid periods can also differ, since exact start/end boundaries belong to the two provider subscriptions.
4. An implementation following the declared keys creates local subscription bindings `LA` and `LB`, or chooses one local binding but preserves the two distinct exact provider periods. Neither construction is excluded by the proposed binding contract.
5. The consumer sees two different recurring keys: `(U, LA, S, periodA)` and `(U, LB, S, periodB)`, or two period keys under one binding. The basis lock and unique constraint work correctly for each key. Nevertheless each key can receive an original Q grant. The duplicate-payment detector described in §5 only groups multiple payments **for one basis**, so it need not discover this cross-basis duplicate initial fulfillment.

This breaks §4's once-only fulfillment promise while preserving every stated per-source revision and per-basis CAS rule. The issue survives serial delivery; it is not fixed by stronger row locking. Recording two provider payments is necessary, but two initial provider subscriptions cannot silently manufacture two independently eligible commercial purchases from one local intent.

**Effect.** A duplicate external initial subscription can become two initial quota allocations and potentially two independently followed renewal streams. The plan says operator risk acceptance concerns a duplicate external mutation; it does not authorize duplicate local commercial fulfillment. A single-subscription-per-buyer product rule would mask some examples, but the correctness requirement here is only **one originating purchase intent**, and does not depend on that unapproved product-wide cardinality rule.

### Minimal sufficient correction

Declare the initial recurring purchase's commercial identity before dispatch and carry it through every linked attempt. Add an initial-fulfillment guard keyed by application/beneficiary + originating intent + benefit slot, or an equivalent explicit invariant in the consumer decision aggregate. Reserve a stable local commercial subscription basis from that intent; identify provider subscriptions as candidate supports for it, rather than independently eligible commercial bindings just because their external IDs differ.

For initial purchase evidence, both the original-intent guard and any period decision must commit atomically inside the consumer owner's transaction. Competing provider subscriptions or differing initial periods for that intent produce a held anomaly requiring explicit selection. Preserve both monetary facts and all candidate periods. Once selected, ordinary renewal keys can continue to use the stable local subscription basis + benefit slot + exact period. An intentionally purchased second subscription remains possible through a separate legitimate intent and the product's own policy.

It is acceptable instead to state an equally strong rejection/hold invariant at binding admission, provided the duplicate transaction still appears in monetary history and cannot escape through a newly minted local binding. A sentence saying “deduplicate by basis” is insufficient unless the contract also defines how these two initial transactions are forced under one commercial decision.

### Future test

Use recorded/synthetic trusted provider evidence; real duplicate charges are unnecessary. One intent has two linked attempts, two completed initial transaction IDs, two subscription IDs, two line IDs, and different exact initial paid periods. Deliver both orders, concurrently, and across restart. Before explicit resolution assert two financial completions, one duplicate-initial-purchase obligation, and at most one eligible original allocation for `I/S`. Then deliver a renewal from each provider subscription: the unselected stream must not quietly become a second supported commercial subscription. A separate second intent must still be capable of representing a legitimate additional purchase when the fixture explicitly allows it. This is a design fix to make now, with its storage implementation later qualified in P3/P5.

## P2 — The fixture's delivery-permutation convergence promise conflicts with its unresolved duplicate-payment policy

**Targets:** §5, lines 184–186; §12, lines 333–347.

The explicit fixture has deliberately narrow policy: a qualified full adverse state before first issuance withholds the original grant; duplicate payments cause review; existing grants retain their causal source; substitution requires authorized resolution. These are individually defensible choices. However, the blanket assertion that delivery permutations give the same final result under the same policy/resolution is not established for their combination. The fixture does not define what duplicate hold does to an already-issued allocation, or whether an earlier withheld source may be replaced before an operator decision. Those omitted semantics change the amount, not merely the historical ordering of audit rows.

### Counterexample with identical final evidence

Take two completed payments `A` and `B` for one already unambiguous basis. The latest full snapshot of `A` includes a qualified full approved refund; the latest snapshot of `B` has no adverse input. There is no consumption and no operator resolution. Both snapshots are independently valid and source revisions are handled correctly.

| Delivery order | Result admitted by the currently written policy |
| --- | --- |
| `A(refunded)` then `B(paid)` | A arrives before any issuance, so allocation is 0 with a withheld decision. B reveals the duplicate. Automatic replacement of the selected support is prohibited; the case stays held at 0. |
| `B(paid)` then `A(refunded)` | B first produces Q with causal support B. A then reveals a duplicate, but its refund is not a refund of B. Preserving the existing causal source and holding further decisions leaves Q already issued, with a duplicate-review obligation. |

The plan also permits another implementation to reduce both outcomes to zero immediately on duplicate hold. That might be a perfectly suitable fixture policy. It is precisely the missing rule: the current “duplicate-payment hold” row does not say this, and the consumer protocol alone cannot select it. Source revision checks, source-independent basis locks, and redrive recovery prevent stale writes but cannot make an unspecified state transition deterministic.

**Effect.** P5 can produce incompatible expected outcomes while each implementation follows the stated isolated rows. A test that asserts only “at most one original grant” will pass both 0 and Q and miss the stronger amount-convergence claim. A test that uses the reducer itself to choose the expected result will hide the gap. This is P2 because the architecture already has sufficient state and resolution machinery; it needs a precise qualification contract rather than a new component.

### Minimal sufficient correction

Choose and state the fixture's spendability/allocation rule while a duplicate-payment obligation is unresolved. For example, in this no-consumption fixture, duplicate ambiguity could set eligible allocation to zero with one explicit correction against any existing grant, preserve its original source, and require resolution before restoration or support substitution. This would make both orders converge to zero without inventing a refund of B. The correction must be described as a fixture policy response to duplicate ambiguity, rather than a second economic refund.

Alternatively retain history-dependent allocations until resolution, but narrow line 347: convergence of the final allocation is promised after the same explicit support-selection decision has been applied to the same evidence. Before that point, assert the durable duplicate hold, causal audit trail, and prohibition on a second original grant, and explicitly allow the prior applied outcome to differ. Neither alternative is a universal product requirement; selecting one merely makes the already requested fixture reviewable.

### Future test

Run the two orders above using independently specified expected eligible amount, held amount, support identity, original-effect count, and correction/restoration identities. Include a restart between deliveries. Resolve both states by choosing B after all evidence is present and assert the same final allocation, one original grant maximum, and no second compensation for A's refund. Then repeat the same resolution to prove idempotence, and race it with a newer adverse snapshot of B to exercise the full expected read set already designed in §5. No AI-consumption or partial-refund policy needs to be added.

## Checks that remain gates, not additional findings

The plan correctly labels API-only positive recovery, SQL concurrency/held-row timing, real pg-boss DDL-free startup and deletion repair, packed consumption, and SDK promise shutdown behavior as future qualification. Their lack of execution during research is not a defect. Likewise, late collection, partial refund after consumption, price choice, and customer-wide identity policy are deliberately unresolved product decisions; I have not treated those as failures.

The recommended corrections preserve Q's ownership boundaries: payment facts stay with payment core; the initial-fulfillment and duplicate-allocation decisions stay with their consumer owner; no shared SQL/UoW, credit balance in the payment producer, second real provider, or new runtime service is needed. Immutable producer revision remains an ingestion identity, while local consumer decision revision remains the identity of subsequent authorized reconsideration.

Source verification after writing: the reviewed plan's SHA-256 is unchanged. The findings above are adversarial deductions from that snapshot; they do not claim a defect in implemented code.
