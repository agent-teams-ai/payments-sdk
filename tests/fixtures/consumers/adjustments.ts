/** Shared nonproduction evidence qualification only; each owner retains its own policy and T3. */
import type { AdjustmentObservation, CompletionFact } from '@agent-teams/payments-core';

export type FullAdjustmentQualification = 'unadjusted' | 'full_adverse' | 'qualified_reversal' | 'held';

/** Qualify the WHOLE snapshot under the fixture's exact single-line/single-original policy. */
export function qualifyFullAdjustmentSnapshot(fact: CompletionFact, adjustments: readonly AdjustmentObservation[]): FullAdjustmentQualification {
  if (adjustments.length === 0) return 'unadjusted';
  const originals = adjustments.filter(item => ['refund', 'credit', 'chargeback'].includes(item.action));
  const original = originals[0], line = fact.lines[0];
  if (originals.length !== 1 || !original || fact.lines.length !== 1 || !line) return 'held';
  const allocation = original.allocations[0];
  if (original.type !== 'full' || original.transactionRef !== fact.transactionRef || original.amount.currency !== fact.total.currency || BigInt(original.amount.minorUnits) !== BigInt(fact.total.minorUnits) || original.allocations.length !== 1 || !allocation || allocation.type !== 'full' || allocation.providerLineRef !== line.providerLineRef || allocation.amount.currency !== fact.total.currency || BigInt(allocation.amount.minorUnits) !== BigInt(fact.total.minorUnits)) return 'held';
  if (original.status === 'approved') return adjustments.length === 1 ? 'full_adverse' : 'held';
  if (original.status !== 'reversed' || adjustments.length !== 2) return 'held';
  const reverse = adjustments.find(item => item !== original), reverseAllocation = reverse?.allocations[0];
  if (!reverse || reverse.action !== `${original.action}_reverse` || reverse.type !== 'full' || reverse.status !== 'approved' || reverse.transactionRef !== original.transactionRef || reverse.amount.currency !== original.amount.currency || BigInt(reverse.amount.minorUnits) !== -BigInt(original.amount.minorUnits) || reverse.allocations.length !== 1 || !reverseAllocation || reverseAllocation.type !== 'full' || reverseAllocation.providerLineRef !== allocation.providerLineRef || reverseAllocation.amount.currency !== allocation.amount.currency || BigInt(reverseAllocation.amount.minorUnits) !== -BigInt(allocation.amount.minorUnits)) return 'held';
  return 'qualified_reversal';
}
