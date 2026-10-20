import assert from 'node:assert/strict';
import test from 'node:test';
import { migratePaymentSchema } from '../dist/index.js';
import { withPaymentTransaction } from '../dist/database.js';
import { PaymentRecords } from '../dist/records.js';
import { databaseFixture, scope } from './helpers.ts';

test('typed queries preserve existing schemaVersion 1 JSON bodies, no-op revisions and exact int8 range checks', async () => {
  const f = await databaseFixture();
  const records = new PaymentRecords(f.schema);
  try {
    const before = (await f.pool.query<{ relation: string; body: unknown }>(
      `SELECT '${f.schema}.records'::regclass::oid::text AS relation, body FROM "${f.schema}".configuration WHERE id = 'owner'`,
    )).rows[0];
    assert.ok(before);
    // Seed with the pre-Drizzle schema and wire representation, independently of the builder.
    await f.pool.query(`INSERT INTO "${f.schema}".records (kind, id, revision, body)
      VALUES ('baseline', 'old', 7, '{"nested":{"amount":"9007199254740993","nullable":null},"flags":[true,false]}')`);
    await migratePaymentSchema({ pool: f.pool, schema: f.schema, scope });
    const after = (await f.pool.query<{ relation: string; body: unknown }>(
      `SELECT '${f.schema}.records'::regclass::oid::text AS relation, body FROM "${f.schema}".configuration WHERE id = 'owner'`,
    )).rows[0];
    assert.deepEqual(after, before, 'baseline bootstrap preserves table identity and owner metadata');
    await withPaymentTransaction(f.pool, async tx => {
      const body = { nested: { amount: '9007199254740993', nullable: null }, flags: [true, false] };
      assert.deepEqual(await records.read(tx, 'baseline', 'old'), { revision: 7, body });
      const unchanged = (await tx.query<{ updated: string }>(`SELECT updated_at::text AS updated FROM "${f.schema}".records WHERE kind = 'baseline' AND id = 'old'`)).rows[0];
      await records.write(tx, 'baseline', 'old', { flags: [true, false], nested: { nullable: null, amount: '9007199254740993' } });
      const same = (await tx.query<{ revision: string; updated: string }>(`SELECT revision::text, updated_at::text AS updated FROM "${f.schema}".records WHERE kind = 'baseline' AND id = 'old'`)).rows[0];
      assert.deepEqual(same, { revision: '7', updated: unchanged?.updated }, 'jsonb equality does not advance revision or publication order');
      await records.write(tx, 'baseline', 'old', { ...body, changed: true });
      assert.equal((await records.read(tx, 'baseline', 'old'))?.revision, 8);
      for (const [id, value] of [['null', null], ['string', 'opaque'], ['number', 42], ['array', [null, { value: false }]]] as const) {
        await records.write(tx, 'codecs', id, value);
        assert.deepEqual((await records.read(tx, 'codecs', id))?.body, value);
      }
      await records.guard(tx, 'membership');
      await records.guard(tx, 'membership');
      assert.equal((await records.read(tx, 'guards', 'membership'))?.revision, 2, 'membership guards advance even when their body is unchanged');
    });
    await f.pool.query(`INSERT INTO "${f.schema}".records (kind, id, revision, body) VALUES ('range', 'max', 9007199254740991, '{}'), ('range', 'overflow', 9007199254740992, '{}')`);
    await withPaymentTransaction(f.pool, async tx => {
      assert.equal((await records.read(tx, 'range', 'max'))?.revision, Number.MAX_SAFE_INTEGER);
      await assert.rejects(records.read(tx, 'range', 'overflow'), RangeError);
    });
  } finally { await f.close(); }
});

test('typed obligation upserts preserve attempts, quarantine and cooldown until an explicit reset', async () => {
  const f = await databaseFixture();
  const records = new PaymentRecords(f.schema);
  const work = { kind: 'prepared', id: 'existing-obligation' } as const;
  const read = async () => (await f.pool.query<{ state: string; revision: string; attempts: number; issue: string | null; due: string }>(
    `SELECT state, revision::text, attempts, issue, next_attempt_at::text AS due FROM "${f.schema}".obligations WHERE kind = $1 AND id = $2`,
    [work.kind, work.id],
  )).rows[0];
  try {
    await f.pool.query(`INSERT INTO "${f.schema}".obligations (kind, id, state, revision, attempts, issue, next_attempt_at)
      VALUES ('prepared', 'existing-obligation', 'quarantined', 12, 8, 'operator_review', '2100-01-01T00:00:00Z')`);
    const before = await read(); assert.ok(before);
    await withPaymentTransaction(f.pool, tx => records.obligation(tx, work, 'quarantined'));
    assert.deepEqual(await read(), before, 'idempotent quarantine does not refresh its budget or revision');
    await withPaymentTransaction(f.pool, tx => records.obligation(tx, work, 'complete'));
    assert.deepEqual(await read(), { ...before, state: 'complete', revision: '13' });
    await withPaymentTransaction(f.pool, async tx => {
      await records.obligation(tx, work, 'pending', true);
      assert.deepEqual(await records.pendingWork(tx, 'prepared', 1), [work.id]);
      await records.write(tx, 'evidence', 'a', {});
      await records.write(tx, 'evidence', 'c', {});
      await records.write(tx, 'evidence', 'b', {});
      assert.deepEqual(await records.listKeys(tx, 'evidence', 'a', 1), [{ id: 'b' }]);
    });
    const reset = await read(); assert.ok(reset);
    assert.equal(reset.state, 'pending'); assert.equal(reset.revision, '14');
    assert.equal(reset.attempts, 0); assert.equal(reset.issue, null);
    assert.ok(new Date(reset.due).getTime() < new Date('2100-01-01T00:00:00Z').getTime());
  } finally { await f.close(); }
});
