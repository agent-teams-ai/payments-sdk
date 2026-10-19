import type { PaymentScope } from '@agent-teams/payments-core';
import { canonicalJson } from '@agent-teams/payments-core';
import type { Pool } from 'pg';
import { sqlIdentifier, withPaymentTransaction } from './database.js';

/** Bootstrap is an explicit deployment operation performed with the migration role. */
export async function migratePaymentSchema(options: Readonly<{ pool: Pool; schema: string; scope: PaymentScope }>): Promise<void> {
  const schema = sqlIdentifier(options.schema);
  await withPaymentTransaction(options.pool, async tx => {
    await tx.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${schema}.configuration (
      id text PRIMARY KEY CHECK (id = 'owner'),
      revision bigint NOT NULL CHECK (revision > 0),
      body jsonb NOT NULL
    )`);
    await tx.query(`INSERT INTO ${schema}.configuration (id, revision, body) VALUES ('owner', 1, $1)
      ON CONFLICT (id) DO NOTHING`, [JSON.stringify({ schemaVersion: 1, scope: options.scope, consumers: [], recoveryFenced: false, fenceAudits: [] })]);
    const existing = await tx.query<{ body: { scope: PaymentScope; schemaVersion: number } }>(`SELECT body FROM ${schema}.configuration WHERE id = 'owner' FOR UPDATE`);
    const metadata = existing.rows[0]?.body;
    if (!metadata || canonicalJson(metadata.scope) !== canonicalJson(options.scope) || metadata.schemaVersion !== 1) {
      throw new Error('Payment schema is already owned by another scope or schema version');
    }
    await tx.query(`CREATE TABLE IF NOT EXISTS ${schema}.records (
      kind text NOT NULL,
      id text NOT NULL,
      revision bigint NOT NULL CHECK (revision > 0),
      body jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (kind, id)
    )`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_intent_idx ON ${schema}.records ((body ->> 'intentId'), kind, id)`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_completion_intent_idx ON ${schema}.records ((body #>> '{completion,intentId}'), id) WHERE kind = 'transactions'`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_subscription_idx ON ${schema}.records USING gin ((body -> 'providerSubscriptionRefs')) WHERE kind = 'subscriptionBindings'`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_state_idx ON ${schema}.records (kind, (body ->> 'state'), id)`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_publication_idx ON ${schema}.records (kind, id) WHERE body ->> 'publicationRequired' = 'true'`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_delivery_idx ON ${schema}.records ((body ->> 'consumerId'), id) WHERE kind = 'deliveries' AND body ->> 'acknowledged' = 'false'`);
    await tx.query(`CREATE INDEX IF NOT EXISTS records_event_idx ON ${schema}.records ((body #>> '{input,source,eventId}'), id) WHERE kind = 'inbox'`);
    await tx.query(`CREATE TABLE IF NOT EXISTS ${schema}.obligations (
      kind text NOT NULL,
      id text NOT NULL,
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'quarantined', 'complete')),
      next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      attempts integer NOT NULL DEFAULT 0,
      issue text,
      PRIMARY KEY (kind, id)
    )`);
    await tx.query(`CREATE INDEX IF NOT EXISTS obligations_repair_idx ON ${schema}.obligations (next_attempt_at, kind, id) WHERE state = 'pending'`);
  }, { acquireMs: 1_000, lockMs: 1_000, statementMs: 10_000, transactionMs: 25_000, deadlineMs: 30_000 });
}
