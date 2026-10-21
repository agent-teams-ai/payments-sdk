import assert from 'node:assert/strict';
import { canonicalJson } from '@agent-teams/payments-core';
import type { PaymentScope } from '@agent-teams/payments-core';
import type { Pool } from 'pg';
import type { PaymentJobTransport, PaymentJobTransportHandlers, PaymentJobWork } from '@agent-teams/payments-postgres';

/** A deliberately small, test-owned durable transport, independent of pg-boss. Explicit pumping
 * selects delivery order without a sleep/timer oracle. It is not a second production job engine. */
export function sqlWakeupFixture(options: Readonly<{ pool: Pool; paymentSchema: string; schema: string; scope: PaymentScope }>) {
  assert.match(options.schema, /^[a-z][a-z0-9_]{0,47}$/u);
  const sql = `"${options.schema}"`;
  const namespace = Object.freeze({ paymentSchema: options.paymentSchema, scope: options.scope });
  let callbacks: PaymentJobTransportHandlers | undefined;
  let rejectEnqueue = false;
  const transport: PaymentJobTransport = {
    namespace,
    pendingWorkSql: (kindExpression, idExpression) => ({
      text: `EXISTS (SELECT 1 FROM ${sql}.wakeups w WHERE w.kind = ${kindExpression} AND w.id = ${idExpression} AND w.state IN ($1, $2))`,
      values: ['created', 'active'],
    }),
    enqueue: async (work, transaction) => {
      const added = await transaction.query(`INSERT INTO ${sql}.wakeups (kind, id, state) VALUES ($1, $2, 'created') ON CONFLICT DO NOTHING RETURNING id`, [work.kind, work.id]);
      if (rejectEnqueue) {rejectEnqueue = false; throw new Error('injected SQL-wakeup admission failure');}
      return added.rows.length === 1;
    },
    qualify: async () => {
      const owner = (await options.pool.query<{ body: unknown }>(`SELECT body FROM ${sql}.owner`)).rows[0]?.body;
      assert.equal(canonicalJson(owner), canonicalJson(namespace), 'transport namespace must match its persisted owner');
    },
    start: async handlers => { callbacks = handlers; },
    stop: async () => { callbacks = undefined; },
  };
  async function pump(kind?: PaymentJobWork['kind']): Promise<PaymentJobWork | undefined> {
    const installed = callbacks;
    assert.ok(installed, 'test transport is not started');
    const work = (await options.pool.query<PaymentJobWork>(`UPDATE ${sql}.wakeups SET state = 'active'
      WHERE (kind, id) = (SELECT kind, id FROM ${sql}.wakeups WHERE state = 'created' AND ($1::text IS NULL OR kind = $1)
        ORDER BY (kind = 'inbox') DESC, kind, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING kind, id`, [kind ?? null])).rows[0];
    if (!work) {return;}
    await installed.work(work);
    await options.pool.query(`DELETE FROM ${sql}.wakeups WHERE kind = $1 AND id = $2`, [work.kind, work.id]);
    return work;
  }
  return {
    transport,
    async bootstrap(): Promise<void> {
      await options.pool.query(`CREATE SCHEMA ${sql}; CREATE TABLE ${sql}.owner (body jsonb NOT NULL);
        CREATE TABLE ${sql}.wakeups (kind text NOT NULL, id text NOT NULL, state text NOT NULL, PRIMARY KEY (kind, id));`);
      await options.pool.query(`INSERT INTO ${sql}.owner VALUES ($1)`, [JSON.stringify(namespace)]);
    },
    rejectNextEnqueue(): void { rejectEnqueue = true; },
    pump,
    async empty(): Promise<void> { await options.pool.query(`DELETE FROM ${sql}.wakeups`); },
    async replay(work: PaymentJobWork): Promise<void> { assert.ok(callbacks); await callbacks.work(work); },
    async pumpAll(): Promise<void> {
      for (let count = 0; count < 100; count += 1) {if (!await pump()) {return;}}
      assert.fail('Test transport exceeded its bounded drain');
    },
  };
}
