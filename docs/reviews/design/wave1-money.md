# Wave 1 — monetary reliability review

**Verdict: request changes to the plan before implementation.** No P0 identified. The plan has the right local atomic boundaries and avoids the most serious provider-retry mistakes. Three P1 gaps remain in the evidence-delivery/recovery contract; three P2 clarifications prevent plausible implementations from violating the stated monetary intent. These are plan findings, not claims about nonexistent implementation defects.

Reviewed the complete immutable `wave1-plan.md`, SHA-256 `bf6902d8bbba502ce4b93492dc5646d0a1a704e575f0f98fabf012f61ccb6cce`, the full supplied attachment, Q 1.1.2, and the available reliability/reuse/Paddle-SDK research. No peer review was read. No implementation, provider account access, payment, or plan edit was performed. Line references below refer to that immutable plan. References to the supporting reports identify already retained research, rather than fresh provider qualification.

## P1 findings

### M1. T3 needs an explicit consumer revision fence, not only message receipts

**Location:** §5, `PaymentEvidenceChanged` and T3, lines 131–139; §7, lines 159–163.

The plan makes each aggregate revision a full snapshot and correctly says revision 4 can arrive before revision 3. But the prescribed consumer transaction only requires unique receipt/message key plus local effect. It never explicitly requires checking the aggregate revision **before** applying the product effect. Distinct message IDs defeat receipt deduplication in precisely the out-of-order case this design is intended to support.

**Failure trace:** revision 3 contains a completed purchase with no adjustment. Revision 4 contains the same completion plus an approved full refund. The consumer receives revision 4 first, records its receipt, and correctly withholds a grant. Later revision 3 arrives with a different, previously unseen message ID. Its receipt insert succeeds. A consumer following only the stated T3 steps can now create the first grant: no grant effect key exists yet. Stable grant uniqueness does not protect a grant that was previously withheld. A similar regression can restore access after an already processed chargeback.

**Minimal change:** make the consumer protocol normative: in the same transaction as receipt and effect, lock/CAS the consumer's evidence projection under `(producer namespace, transaction aggregate identity)`. Apply effect/correction decisions only for a strictly greater evidence revision. A lower revision may add receipt/provenance, but cannot regress evidence or drive an effect. Equal revision/equal digest is a duplicate; equal revision/different digest is a durable conflict and hold. Include this exact refund-newer-before-payment-older trace in P5. The existing supporting `reliability.md` §9 already supplies these missing steps. No broker ordering guarantee or additional infrastructure is needed.

### M2. Delivery uniqueness is keyed to a payment fact, while the delivery unit is an evidence revision

**Location:** §5, lines 129–139; §9, line 183.

The canonical completed fact has one stable identity per provider transaction, while its evidence aggregate has successive immutable revisions. Yet per-target delivery is stated as `(factId, consumerId)`. Those are different cardinalities. A canonical completion fact is not a sufficient identity for every later refund/status/binding evidence message. The plan does not define `factId` as a separate evidence-revision identity.

**Failure trace:** completed fact `F` produces evidence revision 1. Consumer `C` acknowledges delivery `(F,C)`. Later an approved refund produces revision 2 for the same completion `F`. If the specified unique delivery key is implemented literally, inserting its delivery target conflicts with the acknowledged row. The publisher or retention repair sees the target as delivered; revision 2 never reaches `C`. Its already granted credits remain untouched indefinitely. The same issue arises on an adjustment's status update if delivery is instead keyed only by adjustment identity.

**Minimal change:** distinguish and name three keys in one table: completed monetary fact key; immutable evidence-message key; consumer effect key. Delivery uniqueness must be `(consumerId, messageId)` or `(consumerId, aggregateId, evidenceRevision)` in a stable producer namespace. Every consumer-visible evidence change creates its own durable target even when it introduces no new completion. Acknowledging revision 1 cannot acknowledge revision 2. Retention repair must operate on these revision delivery intents. If `factId` was intended to mean the message/revision identity, rename or define it explicitly; do not leave two incompatible meanings for implementation to choose between.

### M3. Repair after queue retention covers outbox, but not admitted inbox or unresolved operations

**Location:** §9, lines 179–189; §5 T1/T2.

The plan recognizes three durable work classes and the queue's finite pending retention. However, its concrete repair pass only reconciles unacknowledged delivery intents with missing/failed jobs. This protects work **after** a fact/outbox exists. It does not specify how already acknowledged ingress or an unknown operation regains runnable work when its queue row disappears.

**Failure trace:** T1 commits a completed-payment inbox record and job, then returns 200. The applicable worker remains unavailable while queue maintenance removes the pending job after the selected retention limit. No T2 has run, so there is no fact and no delivery intent for the specified repair pass to inspect. Restarting the publisher cannot discover the missing grant. An API catch-up scan can encounter the same event ID, but source deduplication is not specified to recreate work for an existing unprocessed receipt. A lost unknown-operation reconciliation job similarly leaves the operation permanently unresolved despite durable command evidence.

**Minimal change:** explicitly cover **all** durable work sources in bounded repair: eligible unprocessed inbox, prepared commands, dispatch-started/unknown read-only resolution, unfinished scan checkpoints, and unacknowledged evidence deliveries. An existing unprocessed input must ensure runnable work when re-admitted. Missing/terminal queue rows must lead to re-created work or a visible durable review state, not an implicit success. Unknown monetary dispatch remains read-only resolution, never a new send. Require an adapter test that removes jobs for an unprocessed inbox and an unknown command, then verifies recovery from payment-owned records alone. This is payments-specific recovery, not a second generic queue engine.

## P2 findings

### M4. Name a local benefit slot so provider line identity cannot accidentally enter the grant key

**Location:** §4, paragraph after step 7; §5 line 129; §6 line 153.

The plan correctly keeps two paid transactions as two monetary facts while promising one fulfillment per intent. But the one-time grant basis is described as order/intent plus “stable item,” immediately after provider item identity was defined as `details.line_items[].id`. For recurring benefits it says stable “benefit/item.” A provider transaction line and a logical purchased benefit are different identities.

**Failure trace:** two completed Paddle transactions `T1` and `T2` belong to one intent `I`, each containing the same offer. Their provider line IDs are `L1` and `L2`. A consumer using the only fully specified item identity builds `(I,L1)` and `(I,L2)`: both unique inserts succeed, violating one fulfillment for `I`. Adding the period does not repair the corresponding duplicate-renewal case. The prohibition in prose is correct, but the proposed key vocabulary still permits the wrong implementation.

**Minimal change:** add immutable `benefitSlotId`/`offerLineKey` from the local catalog snapshot and map provider lines to it. Specify one-time effect key as scoped beneficiary + intent + local benefit slot; recurring effect key as scoped beneficiary + stable local subscription binding + local benefit slot + exact original paid period. Provider transaction/line IDs are evidence/allocation references, not components that distinguish otherwise identical benefit effects. Keep policy version as pinned metadata, as the plan already requires. Include the duplicate-charge trace with different provider line IDs in the consumer test.

### M5. State the precise cutoff protected by the adverse-evidence barrier

**Location:** §5 lines 127–135; §7 line 163.

The T1 revision increment and T2 CAS correctly prevent a prepared reducer from omitting a refund already admitted before its successful commit. They cannot make “known before grant” atomic across the payment owner and independent consumer. The paragraph only explicitly discusses eventual correction for a refund arising **after** grant, leaving the intervening interval unstated.

**Failure trace:** completion T2 commits eligible snapshot revision 1 into outbox. Before delivery, refund T1 commits its pending barrier. The old immutable revision 1 remains deliverable; refund T2/revision 2 is delayed. Consumer T3 commits a grant from revision 1 after the refund was already durably admitted. Even M1's monotone consumer check cannot prevent this if revision 1 arrives first. A publisher freshness check still races a later refund T1 between that check and consumer commit.

**Minimal change:** explicitly scope the guarantee: each evidence revision includes adverse inputs admitted before that revision's T2 commit; adverse inputs admitted afterward produce durable eventual correction, including those admitted before the eventual T3 grant. Require a race test covering this interval and correct idempotent correction/pending-policy state. Do not promise that a simple recheck establishes a distributed issuance barrier. This clarification preserves the existing ownership split; it does not justify a cross-context transaction. Product policy must decide whether its acceptable exposure requires an additional provisional-grant/spendability rule in the credit owner.

### M6. A finite overlap scan is not an unconditional completeness proof

**Location:** §9, lines 185–189.

The page admission/checkpoint algorithm is sound against local crashes. The remaining coverage rule uses bounded overlaps plus refresh of known **unfinished** entities, while treating an exhausted window as advancement of the high-watermark. The retained reliability research explicitly distinguishes pagination exhaustion from a provider snapshot/visibility guarantee (`reliability.md` §10). A completed purchase can still acquire a previously unknown adjustment, so “unfinished” refresh is not enough for adverse facts.

**Failure trace, conditional on delayed event visibility:** an approved-refund webhook is missed. Its event belongs to an already scanned interval but was absent from the scan response. It becomes list-visible after that interval has fallen outside the finite overlap. The original transaction is completed, and the adjustment ID is unknown, so neither is selected by the unfinished-entity refresh. Subsequent scans all succeed; no cursor error or 90-day outage is required. The consumer retains its paid-only evidence indefinitely. The current plan does not cite a provider consistency bound that rules out this trace.

**Minimal change:** label high-watermark as last exhausted query interval, not proof that every historical fact is present. Add a periodic wider/full-retention event sweep and/or an independently bounded adjustment sweep covering relevant completed transactions; preserve explicit coverage/gap status. State the remaining provider visibility assumption. The research already recommends wider retained-window rescans. Keep the existing honest limitation after retention expires; do not infer completeness merely from successful pages or from refreshing a current subscription.

## Owner split and decisions that should survive revision

The money/credit split is substantially clean. Payment core owns binding, trusted financial observations, immutable monetary history, operational uncertainty, and reliable evidence delivery. The storage adapter enforces the core's concurrency contract rather than owning commercial arithmetic. Commercial Access owns product rights; the future credit owner owns grants, buckets, corrections, consumption and debt. Platform's ban on shared UoW is respected. No production credit-ledger ownership is invented. M1/M4 belong in the consumer-facing evidence contract and reference consumer, not in an AI-credit balance inside payment core.

The strongest existing choices should remain: durable dispatch-start before SDK invocation; no automatic resend after uncertain mutation; retaining late evidence despite an expired local fence; stable account/environment namespaces; exact integer money and timestamps; keeping late immutable completion separate from mutable projection order; preserving adjustment identities/signs rather than inventing universal compensation; atomic T1/T2 and independent receipt+effect T3; immutable full evidence snapshots; and ordinary pg-boss workers around external I/O. These establish meaningful Q boundaries without proliferating services.

## Residual risks / qualification targets

After the findings are closed, the plan still needs implementation evidence for real PostgreSQL competing writers, claim expiration, and all rollback boundaries; source inspection is not qualification. Also make operation-specific conflict handling explicit when a second command targets an entity whose earlier mutation remains unknown: a new request key must not bypass that uncertainty. A supported cancellation can otherwise race an older still-running cancellation with another timing. External portal actions remain a separate concurrency source even with local serialization.

Renewals also need an owner-approved rule selecting the effective offer/policy version for a particular period; immutable metadata is useful only once that selection is deterministic. Until late-collection/refund/reversal policies exist, pending-policy/review must be durable and visible rather than interpreted as successful spendable issuance. These are concrete production gates; they do not block continued plan refinement or pure-core work. No P0 or need for a shared payment/credit database transaction was found.
