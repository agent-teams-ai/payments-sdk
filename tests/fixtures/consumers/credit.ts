/** Symbolic Q/T policy for integration qualification only. This is not an AI usage ledger. */
import type { CompletionFact, PaymentEvidenceChanged } from '@agent-teams/payments-core';
import type { PoolClient } from 'pg';
import { ConsumerOwner, canonical, evidenceReadSet, hash } from './owner.ts';
import type { DeliveryResult, OwnerOptions, ReadSet, Source } from './owner.ts';

const QUOTA = 100n, TOP_UP = 25n;
const POLICY = 'fixture-credit-policy-v1';
type Contribution = Readonly<{ source: Source; message: Extract<PaymentEvidenceChanged, { kind: 'complete' }>; fact: CompletionFact; slot: string; period?: Readonly<{ startsAt: string; endsAt: string }> }>;
export type CreditDecision = Readonly<{ basisKey: string; buyerId: string; slot: string; bucket: 'included' | 'purchased'; amount: string; allocated: string; eligible: string; held: string; status: 'issued' | 'withheld' | 'held'; applied: 'never_issued' | 'issued' | 'reduced' | 'restored'; originalGrant?: string; originalSource?: string; supportSource?: string; selectedStream?: string; selectedByResolution?: string; reviewedPartialDigest?: string; policyVersion: string; readSet: ReadSet }>;
export type HeldResolution = Readonly<{ basisKey: string; expectedDecisionRevision: number; expectedReadSet: ReadSet; selectedSource: string; actorId: string; approvalRef: string; policyVersion: string; reviewedPartialPolicy?: 'retain_full_symbolic_benefit' }>;

function basis(contribution: Contribution): string {
  const { fact, slot, period } = contribution;
  if (fact.classification === 'initial') return canonical(['initial', fact.scope.applicationId, fact.buyerId, fact.intentId, slot]);
  if (fact.classification === 'one_time') return canonical(['purchase', fact.scope.applicationId, fact.buyerId, fact.intentId, slot]);
  return canonical(['period', fact.scope.applicationId, fact.buyerId, fact.subscriptionBasisId, slot, period]);
}
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
  migrate(): Promise<void> { return this.owner.migrate(); }
  receive(message: unknown, faults: Readonly<{ beforeCommit?: () => void }> = {}): Promise<DeliveryResult> { return this.owner.receive(message, (client, sources) => this.recompute(client, sources), faults); }
  private async recompute(client: PoolClient, sources: readonly Source[], resolution?: HeldResolution): Promise<void> {
    const groups = Map.groupBy(contributions(sources), basis);
    // Initial guards must settle before stream-dependent renewals, under the SAME owner lock.
    const entries = [...groups.entries()].sort(([a], [b]) => Number(!a.startsWith('["initial"')) - Number(!b.startsWith('["initial"')) || a.localeCompare(b));
    const selectedStreams = new Map<string, string>();
    for (const [basisKey, items] of entries) {
      const first = items[0]; if (!first) continue;
      const stored = await this.owner.decision<CreditDecision>(client, basisKey), old = stored?.body;
      const selected = resolution?.basisKey === basisKey ? resolution.selectedSource : old?.selectedByResolution;
      const chosen = selected ? items.find(item => item.source.sourceKey === selected) : items.length === 1 ? first : undefined;
      let reason: string | undefined = !chosen ? 'duplicate_payment_review' : undefined;
      if (chosen && chosen.fact.classification !== 'initial' && chosen.fact.classification !== 'one_time') {
        const stream = chosen.fact.subscriptionBasisId ? selectedStreams.get(chosen.fact.subscriptionBasisId) : undefined;
        if (!stream || stream !== chosen.fact.providerSubscriptionRef) reason = 'unselected_subscription_stream';
      }
      const reviewedPartialDigest = resolution?.basisKey === basisKey && resolution.reviewedPartialPolicy && chosen ? chosen.source.digest : old?.reviewedPartialDigest;
      const chosenCondition = chosen && reviewedPartialDigest === chosen.source.digest && reviewablePartial(chosen) ? 'paid' : chosen ? condition(chosen) : 'held';
      if (chosenCondition === 'held') reason ??= 'pending_policy';
      const quantity = first.fact.classification === 'one_time' ? TOP_UP : QUOTA;
      let allocated = BigInt(old?.allocated ?? '0'), applied = old?.applied ?? 'never_issued';
      let originalGrant = old?.originalGrant, originalSource = old?.originalSource;
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
          await this.owner.effect(client, { effectKey: hash(['restoration', originalGrant, chosen.source.sourceKey, chosen.source.revision, resolution?.approvalRef ?? null]), basisKey, kind: 'restoration', amount: quantity.toString(), sourceKey: chosen.source.sourceKey, causeEffectKey: originalGrant, policyVersion: old?.policyVersion ?? POLICY });
          applied = 'restored';
        }
        allocated = quantity;
      }
      const status = reason ? 'held' : chosenCondition === 'adverse' ? 'withheld' : 'issued';
      const decision: CreditDecision = { basisKey, buyerId: first.fact.buyerId, slot: first.slot, bucket: first.fact.classification === 'one_time' ? 'purchased' : 'included', amount: quantity.toString(), allocated: allocated.toString(), eligible: status === 'issued' ? allocated.toString() : '0', held: status === 'held' ? allocated.toString() : '0', status, applied, ...(originalGrant ? { originalGrant } : {}), ...(originalSource ? { originalSource } : {}), ...(supportSource ? { supportSource } : {}), ...(selected ? { selectedByResolution: selected } : {}), ...(reviewedPartialDigest ? { reviewedPartialDigest } : {}), ...(chosen?.fact.providerSubscriptionRef ? { selectedStream: chosen.fact.providerSubscriptionRef } : {}), policyVersion: old?.policyVersion ?? POLICY, readSet: evidenceReadSet(sources) };
      if (canonical(old ?? null) !== canonical(decision)) await this.owner.putDecision(client, basisKey, (stored?.revision ?? 0) + 1, decision);
      await this.owner.obligation(client, hash(['credit-decision', basisKey]), basisKey, reason ?? 'none', sources, reason ? 'pending' : 'resolved');
      if (first.fact.classification === 'initial' && chosen && !reason && chosen.fact.subscriptionBasisId && chosen.fact.providerSubscriptionRef) selectedStreams.set(chosen.fact.subscriptionBasisId, chosen.fact.providerSubscriptionRef);
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
}
