/** Nonproduction independent-owner transport. Never reads payment-owner or another consumer SQL. */
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { EvidenceMessage, PaymentScope } from '@agent-teams/payments-core';

export type ConsumerTrust = Readonly<{ producerNamespace: string; scope: PaymentScope }>;
export type Source = Readonly<{ sourceKey: string; revision: number; digest: string; messageId: string; body: EvidenceMessage; lastKnown?: EvidenceMessage; held: boolean }>;
export type ReadSet = readonly Readonly<{ sourceKey: string; revision: number; digest: string }>[];
export type ReceiptOutcome = 'accepted' | 'duplicate' | 'stale' | 'conflict' | 'held';
export type DeliveryResult = Readonly<{ acknowledge: true; outcome: ReceiptOutcome }> | Readonly<{ acknowledge: false; outcome: 'quarantined'; reason: string }>;
export type OwnerOptions = Readonly<{ pool: Pool; schema: string; trust: ConsumerTrust }>;
export type Effect = Readonly<{ effectKey: string; basisKey: string; kind: string; amount: string; sourceKey?: string; causeEffectKey?: string; policyVersion: string }>;

export function canonical(value: unknown): string {
  function visit(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(visit);
    if (typeof item === 'object' && item !== null) return Object.fromEntries(Object.entries(item).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, visit(child)]));
    throw new TypeError('Non JSON message');
  }
  return JSON.stringify(visit(value));
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function sourceIdentity(message: Pick<EvidenceMessage, 'producerNamespace' | 'scope' | 'aggregate'>): string { return canonical([message.producerNamespace, message.scope, message.aggregate]); }
export function evidenceReadSet(sources: readonly Source[]): ReadSet { return sources.map(source => ({ sourceKey: source.sourceKey, revision: source.revision, digest: source.digest })).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)); }
export function signFixtureMessage<T extends object>(body: T): T & { bodyDigest: string } { return { ...body, bodyDigest: hash(body) }; }
export function quoteSchema(schema: string): string { if (!/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) throw new TypeError('Unsafe schema'); return `"${schema}"`; }

type Envelope = EvidenceMessage & { schemaVersion: number; envelopeVersion: number };
function validate(value: unknown, trust: ConsumerTrust): Readonly<{ message?: Envelope; held?: boolean; reason?: string }> {
  if (!value || typeof value !== 'object') return { reason: 'unknown_envelope' };
  const message = value as Envelope;
  const bounded = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 512 && !/[\u0000-\u001f]/u.test(item);
  if (message.envelopeVersion !== 1 || !bounded(message.producerNamespace) || !bounded(message.messageId) || !Number.isSafeInteger(message.revision) || message.revision < 1 || !Number.isSafeInteger(message.schemaVersion) || message.schemaVersion < 1 || !message.aggregate || !['transaction', 'subscription'].includes(message.aggregate.type) || !bounded(message.aggregate.id)) return { reason: 'unknown_envelope' };
  if (message.producerNamespace !== trust.producerNamespace || canonical(message.scope) !== canonical(trust.scope)) return { reason: 'untrusted_scope' };
  const { bodyDigest, ...body } = message;
  if (typeof bodyDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(bodyDigest) || hash(body) !== bodyDigest) return { reason: 'digest_mismatch' };
  if (hash([message.producerNamespace, message.scope, message.aggregate, message.revision]) !== message.messageId) return { reason: 'message_identity_mismatch' };
  if (message.schemaVersion !== 1) return { message, held: true };
  if (message.kind === 'held' && bounded(message.reason) && bounded(message.resolutionRef)) return { message, held: true };
  if (message.kind === 'complete' && message.aggregate.type === 'transaction' && Array.isArray(message.adjustments) && Array.isArray(message.flags)) return { message, held: false };
  if (message.kind === 'subscription_complete' && message.aggregate.type === 'subscription' && message.binding && message.observation && Array.isArray(message.flags)) return { message, held: false };
  // Known control envelope can take custody of undecodable payload while restricting use.
  return { message, held: true };
}

/** Independent owner transactions. The small fixture uses a per-buyer membership guard. */
export class ConsumerOwner {
  readonly sql: string;
  readonly options: OwnerOptions;
  constructor(options: OwnerOptions) { this.options = options; this.sql = quoteSchema(options.schema); }
  async migrate(): Promise<void> {
    const s = this.sql;
    await this.options.pool.query(`CREATE SCHEMA ${s};
      CREATE TABLE ${s}.receipts(message_id text PRIMARY KEY, source_key text NOT NULL, revision bigint NOT NULL, digest text NOT NULL, outcome text NOT NULL);
      CREATE TABLE ${s}.evidence_projection(source_key text PRIMARY KEY, revision bigint NOT NULL, digest text NOT NULL, message_id text NOT NULL, body jsonb NOT NULL, last_known jsonb, held boolean NOT NULL);
      CREATE TABLE ${s}.decisions(basis_key text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL);
      CREATE TABLE ${s}.effects(effect_key text PRIMARY KEY, basis_key text NOT NULL, body jsonb NOT NULL);
      CREATE TABLE ${s}.obligations(obligation_key text PRIMARY KEY, basis_key text, blocker text NOT NULL, read_set jsonb NOT NULL, state text NOT NULL);
      CREATE TABLE ${s}.outbox(outbox_id text PRIMARY KEY, body jsonb NOT NULL);
      CREATE TABLE ${s}.audits(audit_id text PRIMARY KEY, body jsonb NOT NULL);
      CREATE TABLE ${s}.quarantine(quarantine_id text PRIMARY KEY, reason text NOT NULL, body jsonb NOT NULL);`);
  }
  async atomic<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL synchronous_commit = on; SET LOCAL lock_timeout = '1500ms'; SET LOCAL statement_timeout = '5000ms'; SET LOCAL transaction_timeout = '10000ms'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  async lockBuyer(client: PoolClient, buyerId: string): Promise<void> {
    // ALL contribution, lifecycle, restriction, decision and resolution writers share this lock.
    // It covers new sources (phantoms) and initial guards across streams and periods, while a
    // different beneficiary proceeds independently. No cross-owner or whole-merchant lock exists.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${this.options.schema}:buyer:${buyerId}`]);
  }
  async sources(client: PoolClient, buyerId?: string): Promise<Source[]> {
    const result = await client.query<{ source_key: string; revision: string; digest: string; message_id: string; body: EvidenceMessage; last_known: EvidenceMessage | null; held: boolean }>(`SELECT * FROM ${this.sql}.evidence_projection WHERE ($1::text IS NULL OR COALESCE(body->'completion'->>'buyerId',body->'binding'->>'buyerId',last_known->'completion'->>'buyerId',last_known->'binding'->>'buyerId')=$1) ORDER BY source_key`, [buyerId ?? null]);
    return result.rows.map(row => ({ sourceKey: row.source_key, revision: Number(row.revision), digest: row.digest, messageId: row.message_id, body: row.body, ...(row.last_known ? { lastKnown: row.last_known } : {}), held: row.held }));
  }
  async decision<T>(client: PoolClient, basisKey: string): Promise<Readonly<{ revision: number; body: T }> | undefined> {
    const result = await client.query<{ revision: string; body: T }>(`SELECT revision,body FROM ${this.sql}.decisions WHERE basis_key=$1`, [basisKey]);
    const row = result.rows[0]; return row ? { revision: Number(row.revision), body: row.body } : undefined;
  }
  async putDecision(client: PoolClient, basisKey: string, revision: number, body: unknown): Promise<void> {
    await client.query(`INSERT INTO ${this.sql}.decisions VALUES($1,$2,$3) ON CONFLICT(basis_key) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body`, [basisKey, revision, body]);
    await client.query(`INSERT INTO ${this.sql}.outbox VALUES($1,$2)`, [hash(['decision', basisKey, revision]), { basisKey, revision, body }]);
  }
  async effect(client: PoolClient, effect: Effect): Promise<void> { await client.query(`INSERT INTO ${this.sql}.effects VALUES($1,$2,$3) ON CONFLICT(effect_key) DO NOTHING`, [effect.effectKey, effect.basisKey, effect]); }
  async obligation(client: PoolClient, key: string, basis: string | null, blocker: string, sources: readonly Source[], state: 'pending' | 'resolved' = 'pending'): Promise<void> {
    await client.query(`INSERT INTO ${this.sql}.obligations VALUES($1,$2,$3,$4,$5) ON CONFLICT(obligation_key) DO UPDATE SET blocker=EXCLUDED.blocker,read_set=EXCLUDED.read_set,state=EXCLUDED.state`, [key, basis, blocker, evidenceReadSet(sources), state]);
  }
  async receive(value: unknown, recompute: (client: PoolClient, sources: readonly Source[]) => Promise<void>, faults: Readonly<{ beforeCommit?: () => void }> = {}): Promise<DeliveryResult> {
    const decoded = validate(value, this.options.trust);
    if (!decoded.message) {
      await this.atomic(async client => { await client.query(`INSERT INTO ${this.sql}.quarantine VALUES($1,$2,$3)`, [randomUUID(), decoded.reason, JSON.parse(JSON.stringify(value ?? null))]); });
      return { acknowledge: false, outcome: 'quarantined', reason: decoded.reason ?? 'unknown_envelope' };
    }
    const message = decoded.message, sourceKey = sourceIdentity(message);
    return this.atomic(async client => {
      // Source identity is stable before product routing is available. This lock precedes the
      // buyer guard; resolution never takes a source lock, preventing an inverse lock order.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${this.options.schema}:source:${sourceKey}`]);
      const prior = (await this.sources(client)).find(source => source.sourceKey === sourceKey);
      const route = message.kind === 'complete' ? message.completion?.buyerId : message.kind === 'subscription_complete' ? message.binding.buyerId : undefined;
      const previous = prior?.lastKnown ?? prior?.body;
      const buyerId = route ?? (previous?.kind === 'complete' ? previous.completion?.buyerId : previous?.kind === 'subscription_complete' ? previous.binding.buyerId : undefined);
      if (buyerId) await this.lockBuyer(client, buyerId);
      const receipts = await client.query<{ digest: string; source_key: string }>(`SELECT digest,source_key FROM ${this.sql}.receipts WHERE message_id=$1`, [message.messageId]);
      const receipt = receipts.rows[0];
      if (receipt?.digest === message.bodyDigest && receipt.source_key === sourceKey) return { acknowledge: true, outcome: 'duplicate' } as const;
      const sources = buyerId ? await this.sources(client, buyerId) : prior ? [prior] : [], current = sources.find(source => source.sourceKey === sourceKey);
      let outcome: ReceiptOutcome;
      if (receipt || (current?.revision === message.revision && current.digest !== message.bodyDigest)) {
        outcome = 'conflict';
        if (current) await client.query(`UPDATE ${this.sql}.evidence_projection SET held=true WHERE source_key=$1`, [sourceKey]);
        await this.obligation(client, hash(['conflict', sourceKey]), null, 'digest_conflict', sources);
        await client.query(`INSERT INTO ${this.sql}.audits VALUES($1,$2)`, [randomUUID(), { kind: 'digest_conflict', sourceKey, message }]);
      } else if (current && message.revision <= current.revision) outcome = message.revision === current.revision ? 'duplicate' : 'stale';
      else {
        outcome = decoded.held ? 'held' : 'accepted';
        const lastKnown = decoded.held ? current?.lastKnown ?? current?.body ?? null : message;
        await client.query(`INSERT INTO ${this.sql}.evidence_projection VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(source_key) DO UPDATE SET revision=EXCLUDED.revision,digest=EXCLUDED.digest,message_id=EXCLUDED.message_id,body=EXCLUDED.body,last_known=EXCLUDED.last_known,held=EXCLUDED.held`, [sourceKey, message.revision, message.bodyDigest, message.messageId, message, lastKnown, decoded.held === true]);
        await this.obligation(client, hash(['source', sourceKey]), null, decoded.held ? 'upgrade_or_review' : 'none', buyerId ? await this.sources(client, buyerId) : [], decoded.held ? 'pending' : 'resolved');
      }
      if (!receipt) await client.query(`INSERT INTO ${this.sql}.receipts VALUES($1,$2,$3,$4,$5)`, [message.messageId, sourceKey, message.revision, message.bodyDigest, outcome]);
      if (buyerId && ['accepted', 'held', 'conflict'].includes(outcome)) await recompute(client, await this.sources(client, buyerId));
      // This outbox also records custody when policy has no product effect or cannot route a basis.
      await client.query(`INSERT INTO ${this.sql}.outbox VALUES($1,$2) ON CONFLICT(outbox_id) DO NOTHING`, [hash(['receipt', message.messageId, message.bodyDigest]), { messageId: message.messageId, outcome }]);
      faults.beforeCommit?.();
      return { acknowledge: true, outcome } as const;
    });
  }
  async inspect<T>(table: 'decisions' | 'effects' | 'obligations' | 'outbox' | 'audits' | 'receipts' | 'evidence_projection' | 'quarantine'): Promise<T[]> { return (await this.options.pool.query(`SELECT * FROM ${this.sql}.${table}`)).rows as T[]; }
}
