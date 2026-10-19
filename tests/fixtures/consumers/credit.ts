/** Symbolic Q/T policy for integration qualification only. This is not an AI usage ledger. */
import { exactTime } from '@agent-teams/payments-core';
import type { CompletionFact, PaymentEvidenceChanged } from '@agent-teams/payments-core';
import type { PoolClient } from 'pg';
import { ConsumerOwner, canonical, evidenceReadSet, hash } from './owner.ts';
import type { DeliveryResult, OwnerOptions, ReadSet, Source } from './owner.ts';

const QUOTA = 100n, TOP_UP = 25n;
const POLICY = 'fixture-credit-policy-v1';
type Contribution = Readonly<{ source: Source; message: Extract<PaymentEvidenceChanged, { kind: 'complete' }>; fact: CompletionFact; slot: string; period?: Readonly<{ startsAt: string; endsAt: string }> }>;
export type CreditDecision = Readonly<{ basisKey: string; buyerId: string; slot: string; period?: Readonly<{ startsAt: string; endsAt: string }>; bucket: 'included' | 'purchased'; amount: string; allocated: string; eligible: string; held: string; status: 'issued' | 'withheld' | 'held'; applied: 'never_issued' | 'issued' | 'reduced' | 'restored' | 'reassigned'; initialGuardKey?: string; initialGuardDigest?: string; originalGrant?: string; originalSource?: string; supportSource?: string; selectedStream?: string; selectedByResolution?: string; reviewedPartialDigest?: string; policyVersion: string; readSet: ReadSet }>;
export type HeldResolution = Readonly<{ basisKey: string; expectedDecisionRevision: number; expectedReadSet: ReadSet; selectedSource: string; actorId: string; approvalRef: string; policyVersion: string; reviewedPartialPolicy?: 'retain_full_symbolic_benefit' }>;
type InitialGuard = { guardKey: string; status: 'selected' | 'held'; selectedSource?: string; selectedPeriod?: string; selectedStream?: string; selectedByResolution?: string; originalGrant?: string; originalSource?: string; allocationOwner?: string; readSet: ReadSet };

function basis(contribution: Contribution): string {
  const { fact, slot, period } = contribution;
  if (fact.classification === 'one_time') return canonical(['purchase', fact.scope.applicationId, fact.buyerId, fact.intentId, slot]);
  if (!period) throw new Error('Recurring contribution requires an exact paid period');
  const instant = (value: string) => { const { seconds, fraction } = exactTime(value); return { seconds, fraction }; };
  // Identity follows instants, not provider spelling. All guard/allocation/effect references use
  // this same basis; the original timestamp strings remain in the immutable source and decision.
  return canonical(['period', fact.scope.applicationId, fact.buyerId, fact.subscriptionBasisId, slot, { startsAt: instant(period.startsAt), endsAt: instant(period.endsAt) }]);
}
function initialGuardKey(contribution: Contribution): string { return canonical(['initial', contribution.fact.scope.applicationId, contribution.fact.buyerId, contribution.fact.intentId, contribution.slot]); }
function contributions(sources: readonly Source[]): Contribution[] {
  return sources.flatMap(source => {
    const body = source.held ? source.lastKnown : source.body;
    if (body?.kind !== 'complete' || !body.completion || !['initial', 'renewal', 'recovery', 'one_time'].includes(body.completion.classification)) return [];
    const fact = body.completion;
    return fact.lines.map(line => ({ source, message: body, fact, slot: line.benefitSlotId, ...(line.period ? { period: line.period } : {}) }));
  });
}
type Condition = 'paid' | 'adverse' | 'held';
function reviewablePartial(contribution: Contribution): boolean { return !contribution.source.held && !contribution.message.flags.length && contribution.message.adjustments.length === 1 && contribution.message.adjustments.every(item => item.action === 'refund' && item.type === 'partial' && item.status === 'approved'); }
function condition(contribution: Contribution): Condition {
  const { source, message, fact } = contribution;
  if (source.held || message.flags.some(flag => !['duplicate_payment', 'duplicate_initial_purchase'].includes(flag))) return 'held';
  const adjustments = message.adjustments;
  if (!adjustments.length) return 'paid';
  if (adjustments.some(item => !['refund', 'credit', 'chargeback', 'refund_reverse', 'credit_reverse', 'chargeback_reverse'].includes(item.action))) return 'held';
  const originals = adjustments.filter(adjustment => ['refund', 'credit', 'chargeback'].includes(adjustment.action));
  if (!originals.length) return 'held';
  if (originals.some(original => original.type !== 'full' || original.amount.currency !== fact.total.currency || BigInt(original.amount.minorUnits) !== BigInt(fact.total.minorUnits) || original.allocations.length !== 1 || original.allocations.some(allocation => allocation.type !== 'full' || allocation.providerLineRef !== fact.lines[0]?.providerLineRef || allocation.amount.currency !== fact.total.currency || allocation.amount.minorUnits !== fact.total.minorUnits))) return 'held';
  if (originals.some(original => !['approved', 'reversed'].includes(original.status))) return 'held';
  if (originals.some(original => original.status === 'approved')) return 'adverse';
  for (const original of originals) {
    const expectedAction = `${original.action}_reverse`;
    const reversals = adjustments.filter(item => item.action === expectedAction && item.status === 'approved' && item.transactionRef === original.transactionRef && item.amount.currency === original.amount.currency && BigInt(item.amount.minorUnits) === -BigInt(original.amount.minorUnits) && canonical(item.allocations.map(allocation => [allocation.providerLineRef, allocation.amount.minorUnits]).sort()) === canonical(original.allocations.map(allocation => [allocation.providerLineRef, (-BigInt(allocation.amount.minorUnits)).toString()]).sort()));
    if (reversals.length !== 1 || originals.length !== 1) return 'held';
  }
  return 'paid';
}

export class CreditFixture {
  readonly owner: ConsumerOwner;
  constructor(options: OwnerOptions) { this.owner = new ConsumerOwner(options); }
  async migrate(): Promise<void> {
    await this.owner.migrate();
    await this.owner.options.pool.query(`CREATE TABLE ${this.owner.sql}.initial_guards(guard_key text PRIMARY KEY,revision bigint NOT NULL,body jsonb NOT NULL)`);
  }
  receive(message: unknown, faults: Readonly<{ beforeCommit?: () => void }> = {}): Promise<DeliveryResult> { return this.owner.receive(message, (client, sources) => this.recompute(client, sources), faults); }
  private async recompute(client: PoolClient, sources: readonly Source[], resolution?: HeldResolution): Promise<void> {
    const all = contributions(sources), groups = Map.groupBy(all, basis);
    const guardGroups = Map.groupBy(all.filter(item => item.fact.classification === 'initial'), initialGuardKey);
    const guards = new Map<string, InitialGuard>();
    const previousGuards = new Map<string, Readonly<{ revision: number; body: InitialGuard }>>();
    const selectedStreams = new Map<string, string>();
    // The initial-intent guard is ADDITIONAL to the recurring period identity. Every writer
    // already holds the same buyer membership guard, including new sources and local resolution.
    for (const [guardKey, items] of guardGroups) {
      const result = await client.query<{ revision: string; body: InitialGuard }>(`SELECT revision,body FROM ${this.owner.sql}.initial_guards WHERE guard_key=$1`, [guardKey]);
      const row = result.rows[0], old = row?.body;
      if (row) previousGuards.set(guardKey, { revision: Number(row.revision), body: row.body });
      const resolvedInitial = resolution ? items.find(item => basis(item) === resolution.basisKey && item.source.sourceKey === resolution.selectedSource) : undefined;
      const selectedByResolution = resolvedInitial?.source.sourceKey ?? old?.selectedByResolution;
      const chosen = selectedByResolution ? items.find(item => item.source.sourceKey === selectedByResolution) : items.length === 1 ? items[0] : undefined;
      const selectedDecision = chosen ? await this.owner.decision<CreditDecision>(client, basis(chosen)) : undefined;
      const reviewedPartial = chosen && reviewablePartial(chosen) && ((resolvedInitial && resolution?.reviewedPartialPolicy) || selectedDecision?.body.reviewedPartialDigest === chosen.source.digest);
      const status = chosen && (condition(chosen) !== 'held' || reviewedPartial) ? 'selected' : 'held';
      const guard: InitialGuard = { guardKey, status, ...(chosen ? { selectedSource: chosen.source.sourceKey, selectedPeriod: basis(chosen) } : {}), ...(chosen?.fact.providerSubscriptionRef ? { selectedStream: chosen.fact.providerSubscriptionRef } : {}), ...(selectedByResolution ? { selectedByResolution } : {}), ...(old?.originalGrant ? { originalGrant: old.originalGrant } : {}), ...(old?.originalSource ? { originalSource: old.originalSource } : {}), ...(old?.allocationOwner ? { allocationOwner: old.allocationOwner } : {}), readSet: evidenceReadSet(sources) };
      guards.set(guardKey, guard);
      if (status === 'selected' && chosen?.fact.subscriptionBasisId && chosen.fact.providerSubscriptionRef) selectedStreams.set(chosen.fact.subscriptionBasisId, chosen.fact.providerSubscriptionRef);
    }
    const selectedInitialPeriods = new Set([...guards.values()].filter(guard => guard.status === 'selected').map(guard => guard.selectedPeriod));
    const entries = [...groups.entries()].sort(([a], [b]) => Number(!selectedInitialPeriods.has(a)) - Number(!selectedInitialPeriods.has(b)) || a.localeCompare(b));
    for (const [basisKey, items] of entries) {
      const first = items[0]; if (!first) continue;
      const stored = await this.owner.decision<CreditDecision>(client, basisKey), old = stored?.body;
      const initial = items.find(item => item.fact.classification === 'initial');
      const guard = initial ? guards.get(initialGuardKey(initial)) : undefined;
      // Include the additional decision read in this period's revision. A resolution of another
      // candidate period must invalidate a stale operator command even when this period stays held.
      const initialGuardDigest = guard ? hash([guard.guardKey, guard.status, guard.selectedSource ?? null, guard.selectedPeriod ?? null, guard.selectedStream ?? null, guard.selectedByResolution ?? null]) : undefined;
      const selected = resolution?.basisKey === basisKey ? resolution.selectedSource : old?.selectedByResolution;
      const chosen = selected ? items.find(item => item.source.sourceKey === selected) : items.length === 1 ? first : undefined;
      let reason: string | undefined = !chosen ? 'duplicate_payment_review' : undefined;
      if (guard && (guard.status !== 'selected' || guard.selectedPeriod !== basisKey)) reason = 'initial_intent_review';
      if (chosen && chosen.fact.classification !== 'one_time') {
        const stream = chosen.fact.subscriptionBasisId ? selectedStreams.get(chosen.fact.subscriptionBasisId) : undefined;
        if (!stream || stream !== chosen.fact.providerSubscriptionRef) reason ??= 'unselected_subscription_stream';
      }
      const reviewedPartialDigest = resolution?.basisKey === basisKey && resolution.reviewedPartialPolicy && chosen ? chosen.source.digest : old?.reviewedPartialDigest;
      const chosenCondition = chosen && reviewedPartialDigest === chosen.source.digest && reviewablePartial(chosen) ? 'paid' : chosen ? condition(chosen) : 'held';
      if (chosenCondition === 'held') reason ??= 'pending_policy';
      const quantity = first.fact.classification === 'one_time' ? TOP_UP : QUOTA;
      let allocated = BigInt(old?.allocated ?? '0'), applied = old?.applied ?? 'never_issued';
      let originalGrant = old?.originalGrant, originalSource = old?.originalSource;
      let transferred = false;
      // Selecting a competing initial in a different period may move an already issued symbolic
      // allocation. Preserve its original issuance and audit a policy transfer, never a refund.
      if (!reason && chosenCondition === 'paid' && guard?.originalGrant && !originalGrant && guard.allocationOwner !== basisKey) {
        const previous = guard.allocationOwner ? await this.owner.decision<CreditDecision>(client, guard.allocationOwner) : undefined;
        if (previous && BigInt(previous.body.allocated) > 0n) {
          const amount = BigInt(previous.body.allocated);
          await this.owner.effect(client, { effectKey: hash(['support-transfer-out', guard.originalGrant, previous.body.basisKey, basisKey]), basisKey: previous.body.basisKey, kind: 'support_transfer_out', amount: (-amount).toString(), causeEffectKey: guard.originalGrant, policyVersion: previous.body.policyVersion });
          await this.owner.putDecision(client, previous.body.basisKey, previous.revision + 1, { ...previous.body, allocated: '0', eligible: '0', held: '0', status: 'held', applied: 'reassigned', readSet: evidenceReadSet(sources) } satisfies CreditDecision);
          transferred = true;
        }
        originalGrant = guard.originalGrant; originalSource = guard.originalSource; guard.allocationOwner = basisKey;
      }
      const supportSource = chosen?.source.sourceKey ?? old?.supportSource;
      // A policy hold never pretends to be a provider reversal. Correct only the causal support.
      const causal = items.find(item => item.source.sourceKey === (old?.supportSource ?? old?.originalSource));
      if (allocated > 0n && ((causal && condition(causal) === 'adverse' && (!chosen || causal.source.sourceKey === chosen.source.sourceKey)) || (!reason && chosenCondition === 'adverse'))) {
        const cause = (causal ?? chosen)?.message.adjustments.find(item => item.status === 'approved' && ['refund', 'credit', 'chargeback'].includes(item.action));
        const causalSource = (causal ?? chosen)?.source.sourceKey;
        await this.owner.effect(client, { effectKey: hash(['correction', originalGrant, cause?.adjustmentRef, cause?.version]), basisKey, kind: 'correction', amount: (-allocated).toString(), ...(causalSource ? { sourceKey: causalSource } : {}), ...(originalGrant ? { causeEffectKey: originalGrant } : {}), policyVersion: old?.policyVersion ?? POLICY });
        allocated = 0n; applied = 'reduced';
      }
      if (!reason && chosenCondition === 'paid' && allocated === 0n && chosen) {
        if (!originalGrant) {
          originalGrant = hash(['original-grant', basisKey]); originalSource = chosen.source.sourceKey;
          await this.owner.effect(client, { effectKey: originalGrant, basisKey, kind: 'grant', amount: quantity.toString(), sourceKey: originalSource, policyVersion: POLICY });
          applied = 'issued';
        } else {
          await this.owner.effect(client, { effectKey: hash([transferred ? 'support-transfer-in' : 'restoration', originalGrant, chosen.source.sourceKey, chosen.source.revision, resolution?.approvalRef ?? null]), basisKey, kind: transferred ? 'support_transfer_in' : 'restoration', amount: quantity.toString(), sourceKey: chosen.source.sourceKey, causeEffectKey: originalGrant, policyVersion: old?.policyVersion ?? POLICY });
          applied = 'restored';
        }
        allocated = quantity;
      }
      const status = reason ? 'held' : chosenCondition === 'adverse' ? 'withheld' : 'issued';
      const decision: CreditDecision = { basisKey, buyerId: first.fact.buyerId, slot: first.slot, ...(first.period ? { period: first.period } : {}), bucket: first.fact.classification === 'one_time' ? 'purchased' : 'included', amount: quantity.toString(), allocated: allocated.toString(), eligible: status === 'issued' ? allocated.toString() : '0', held: status === 'held' ? allocated.toString() : '0', status, applied, ...(guard && initialGuardDigest ? { initialGuardKey: guard.guardKey, initialGuardDigest } : {}), ...(originalGrant ? { originalGrant } : {}), ...(originalSource ? { originalSource } : {}), ...(supportSource ? { supportSource } : {}), ...(selected ? { selectedByResolution: selected } : {}), ...(reviewedPartialDigest ? { reviewedPartialDigest } : {}), ...(chosen?.fact.providerSubscriptionRef ? { selectedStream: chosen.fact.providerSubscriptionRef } : {}), policyVersion: old?.policyVersion ?? POLICY, readSet: evidenceReadSet(sources) };
      if (canonical(old ?? null) !== canonical(decision)) await this.owner.putDecision(client, basisKey, (stored?.revision ?? 0) + 1, decision);
      await this.owner.obligation(client, hash(['credit-decision', basisKey]), basisKey, reason ?? 'none', sources, reason ? 'pending' : 'resolved');
      if (guard && originalGrant && !guard.originalGrant) { guard.originalGrant = originalGrant; if (originalSource) guard.originalSource = originalSource; guard.allocationOwner = basisKey; }
    }
    for (const [guardKey, guard] of guards) {
      const previous = previousGuards.get(guardKey);
      if (canonical(previous?.body ?? null) !== canonical(guard)) {
        const revision = (previous?.revision ?? 0) + 1;
        await client.query(`INSERT INTO ${this.owner.sql}.initial_guards VALUES($1,$2,$3) ON CONFLICT(guard_key) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body`, [guardKey, revision, guard]);
        await client.query(`INSERT INTO ${this.owner.sql}.outbox VALUES($1,$2)`, [hash(['initial-guard', guardKey, revision]), { guardKey, revision, body: guard }]);
      }
      await this.owner.obligation(client, hash(['initial-guard', guardKey]), guard.selectedPeriod ?? null, guard.status === 'held' ? 'initial_intent_review' : 'none', sources, guard.status === 'held' ? 'pending' : 'resolved');
    }
  }
  async resolveHeldDecision(command: HeldResolution): Promise<'resolved' | 'duplicate' | 'conflict' | 'rejected'> {
    if (!command.actorId || !command.approvalRef || command.policyVersion !== POLICY) return 'rejected';
    return this.owner.atomic(async client => {
      const buyerId = (JSON.parse(command.basisKey) as unknown[])[2];
      if (typeof buyerId !== 'string') return 'rejected';
      await this.owner.lockBuyer(client, buyerId);
      const audits = await client.query<{ body: HeldResolution }>(`SELECT body FROM ${this.owner.sql}.audits WHERE audit_id=$1`, [command.approvalRef]);
      if (audits.rows[0]) return canonical(audits.rows[0].body) === canonical(command) ? 'duplicate' : 'conflict';
      const current = await this.owner.decision<CreditDecision>(client, command.basisKey), sources = await this.owner.sources(client, buyerId);
      if (!current || current.revision !== command.expectedDecisionRevision || canonical(command.expectedReadSet) !== canonical(evidenceReadSet(sources))) return 'conflict';
      if (!contributions(sources).some(item => basis(item) === command.basisKey && item.source.sourceKey === command.selectedSource && (condition(item) === 'paid' || (command.reviewedPartialPolicy === 'retain_full_symbolic_benefit' && reviewablePartial(item))))) return 'rejected';
      await client.query(`INSERT INTO ${this.owner.sql}.audits VALUES($1,$2)`, [command.approvalRef, command]);
      await this.recompute(client, sources, command);
      return 'resolved';
    });
  }
  async decisions(): Promise<Readonly<{ basis_key: string; revision: string; body: CreditDecision }>[]> { return this.owner.inspect('decisions'); }
  async initialGuards(): Promise<Readonly<{ guard_key: string; revision: string; body: InitialGuard }>[]> { return (await this.owner.options.pool.query(`SELECT * FROM ${this.owner.sql}.initial_guards ORDER BY guard_key`)).rows as Readonly<{ guard_key: string; revision: string; body: InitialGuard }>[]; }
}
