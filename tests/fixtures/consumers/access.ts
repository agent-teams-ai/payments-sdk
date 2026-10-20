/** Independent Commercial Access style qualification owner. No production Platform package. */
import type { PoolClient } from 'pg';
import { ConsumerOwner, canonical, evidenceReadSet, hash } from './owner.ts';
import { qualifyFullAdjustmentSnapshot } from './adjustments.ts';
import type { DeliveryResult, OwnerOptions, ReadSet, Source } from './owner.ts';

const POLICY = 'fixture-access-no-grace-v1';
export type AccessDecision = Readonly<{ buyerId: string; bindingId: string; status: string; scheduledChange: Readonly<{ action: string; effectiveAt: string }> | null; latestSubscriptionRevision?: number; paidUntil?: string; knownLastPeriod?: Readonly<{ startsAt: string; endsAt: string }>; validUntil: string; newAction: boolean; expand: boolean; read: true; export: true; cancel: true; restrictions: readonly string[]; policyVersion: string; readSet: ReadSet }>;
type SecurityRestriction = Readonly<{ buyerId: string; restricted: boolean; actorId: string; approvalRef: string }>;

export class AccessFixture {
  readonly owner: ConsumerOwner;
  readonly now: () => string;
  constructor(options: OwnerOptions & Readonly<{ now: () => string }>) { this.owner = new ConsumerOwner(options); this.now = options.now; }
  migrate(): Promise<void> { return this.owner.migrate(); }
  receive(message: unknown, faults: Readonly<{ beforeCommit?: () => void }> = {}): Promise<DeliveryResult> { return this.owner.receive(message, (client, sources) => this.recompute(client, sources), faults); }
  private async recompute(client: PoolClient, sources: readonly Source[]): Promise<void> {
    const bindings = new Map<string, string>();
    for (const source of sources) {
      const body = source.held ? source.lastKnown : source.body;
      if (body?.kind === 'complete' && body.completion?.subscriptionBasisId) {bindings.set(body.completion.subscriptionBasisId, body.completion.buyerId);}
      if (body?.kind === 'subscription_complete') {bindings.set(body.binding.bindingId, body.binding.buyerId);}
    }
    for (const [bindingId, buyerId] of bindings) {
      const key = canonical(['commercial-access', buyerId, bindingId]);
      const old = await this.owner.decision<AccessDecision>(client, key);
      const restrictions = new Set<string>();
      const restrictionRows = await client.query<{ body: SecurityRestriction }>(`SELECT body FROM ${this.owner.sql}.audits WHERE body->>'buyerId'=$1 AND body->>'kind'='security_restriction' ORDER BY body->>'sequence' DESC LIMIT 1`, [buyerId]);
      if (restrictionRows.rows[0]?.body.restricted) {restrictions.add('security');}
      let lifecycle: Source | undefined;
      let status = 'unknown', scheduledChange: AccessDecision['scheduledChange'] = null;
      const periods: Readonly<{ startsAt: string; endsAt: string }>[] = [];
      for (const source of sources) {
        const body = source.held ? source.lastKnown : source.body;
        if (body?.kind === 'subscription_complete' && body.binding.bindingId === bindingId) {
          if (lifecycle) {restrictions.add('competing_subscription_streams');}
          lifecycle = source;
          if (source.held || body.flags.length || body.observation.status.presence !== 'known' || body.observation.scheduledChange.presence !== 'known') {restrictions.add('incomplete_lifecycle');}
          else { status = body.observation.status.value; scheduledChange = body.observation.scheduledChange.value; }
        }
        if (body?.kind !== 'complete' || body.completion?.subscriptionBasisId !== bindingId) {continue;}
        if (source.held || body.flags.length) {restrictions.add('pending_payment_evidence');}
        const adjustment = qualifyFullAdjustmentSnapshot(body.completion, body.adjustments);
        if (adjustment === 'full_adverse') { restrictions.add('full_adverse'); continue; }
        if (adjustment === 'held') {restrictions.add('pending_adjustment_policy');}
        for (const line of body.completion.lines) {if (line.period) {periods.push(line.period);}}
      }
      // Financial history is retained even when current lifecycle no longer supplies a period.
      periods.sort((a, b) => a.endsAt.localeCompare(b.endsAt));
      const knownLastPeriod = periods.at(-1) ?? old?.body.knownLastPeriod;
      const paidUntil = periods.at(-1)?.endsAt;
      const now = this.now();
      if (!lifecycle) {restrictions.add('lifecycle_not_observed');}
      if (status !== 'active') {restrictions.add(`lifecycle_${status}`);}
      if (!paidUntil || Date.parse(now) >= Date.parse(paidUntil)) {restrictions.add('paid_period_expired');}
      if (scheduledChange && Date.parse(now) >= Date.parse(scheduledChange.effectiveAt)) {restrictions.add('scheduled_change_effective');}
      const validUntil = new Date(Math.min(Date.parse(now) + 60_000, paidUntil ? Date.parse(paidUntil) : Date.parse(now), scheduledChange ? Date.parse(scheduledChange.effectiveAt) : Infinity)).toISOString();
      const allowed = restrictions.size === 0;
      const decision: AccessDecision = { buyerId, bindingId, status, scheduledChange, ...(lifecycle ? { latestSubscriptionRevision: lifecycle.revision } : {}), ...(paidUntil ? { paidUntil } : {}), ...(knownLastPeriod ? { knownLastPeriod } : {}), validUntil, newAction: allowed, expand: allowed, read: true, export: true, cancel: true, restrictions: [...restrictions].sort(), policyVersion: POLICY, readSet: evidenceReadSet(sources) };
      if (canonical(old?.body ?? null) !== canonical(decision)) {
        const revision = (old?.revision ?? 0) + 1;
        await this.owner.putDecision(client, key, revision, decision);
        await this.owner.effect(client, { effectKey: hash(['access-decision', key, revision]), basisKey: key, kind: allowed ? 'enable_new_actions' : 'restrict_new_actions', amount: '0', policyVersion: POLICY });
      }
      await this.owner.obligation(client, hash(['access-policy', key]), key, restrictions.size ? [...restrictions].sort().join(',') : 'none', sources, allowed ? 'resolved' : 'pending');
    }
  }
  /** Security remains separately owned policy even while commercial evidence permits access. */
  async restrict(command: SecurityRestriction): Promise<void> {
    if (!command.actorId || !command.approvalRef) {throw new TypeError('Authorized restriction audit required');}
    await this.owner.atomic(async client => {
      await this.owner.lockBuyer(client, command.buyerId);
      const sequence = (await client.query<{ count: string }>(`SELECT count(*) FROM ${this.owner.sql}.audits`)).rows[0]?.count ?? '0';
      await client.query(`INSERT INTO ${this.owner.sql}.audits VALUES($1,$2) ON CONFLICT(audit_id) DO NOTHING`, [command.approvalRef, { ...command, kind: 'security_restriction', sequence: String(Number(sequence) + 1).padStart(12, '0') }]);
      await this.recompute(client, await this.owner.sources(client, command.buyerId));
    });
  }
  /** Explicit local refresh owns expiry; replaying old producer receipts is not a clock. */
  async refresh(buyerId: string): Promise<void> { await this.owner.atomic(async client => { await this.owner.lockBuyer(client, buyerId); await this.recompute(client, await this.owner.sources(client, buyerId)); }); }
  async decisions(): Promise<Readonly<{ basis_key: string; revision: string; body: AccessDecision }>[]> { return this.owner.inspect('decisions'); }
}
