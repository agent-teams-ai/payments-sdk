import { migratePaymentSchema } from '../../../../dist/index.js';
import { withPaymentTransaction } from '../../../../dist/features/payment-custody/adapters/database.js';
import { PaymentRecords } from '../../../../dist/features/payment-custody/adapters/records.js';
import { paymentQueries, paymentTables } from '../../../../dist/features/payment-custody/adapters/schema.js';
import { databaseFixture, scope } from '../../../../dist/testing.js';
import assert from 'node:assert/strict';
import test from 'node:test';

void test('per-input record batches retain per-key revisions, JSON null and atomic rollback across chunks', async () => {
  const f = await databaseFixture(), records = new PaymentRecords(f.schema);
  try {
    await f.pool.query(`INSERT INTO "${f.schema}".records (kind, id, revision, body, updated_at) VALUES
      ('batch', 'unchanged', 5, '{"amount":"42","nullable":null}', '2020-01-01T00:00:00Z'),
      ('batch', 'changed', 9, '{"before":true}', '2020-01-01T00:00:00Z')`);
    await withPaymentTransaction(f.database, tx => records.writeMany(tx, [
      { kind: 'batch', id: 'unchanged', body: { nullable: null, amount: '42' } },
      { kind: 'batch', id: 'changed', body: { after: true } },
      { kind: 'batch', id: 'null', body: null },
    ]));
    const rows = (await f.pool.query<{ id: string; revision: string; body: unknown; unchanged: boolean }>(
      `SELECT id, revision::text, body, updated_at = '2020-01-01T00:00:00Z'::timestamptz AS unchanged FROM "${f.schema}".records WHERE kind = 'batch' ORDER BY id`,
    )).rows;
    assert.deepEqual(rows, [
      { id: 'changed', revision: '10', body: { after: true }, unchanged: false },
      { id: 'null', revision: '1', body: null, unchanged: false },
      { id: 'unchanged', revision: '5', body: { amount: '42', nullable: null }, unchanged: true },
    ]);
    const chunked = Array.from({ length: 515 }, (_, index) => ({ kind: 'chunked', id: `row-${index}`, body: { position: index } }));
    await withPaymentTransaction(f.database, async tx => {
      await records.writeMany(tx, []);
      await assert.rejects(records.writeMany(tx, [...chunked, { kind: 'chunked', id: 'too-many', body: {} }]), RangeError);
      await assert.rejects(records.writeMany(tx, [...chunked.slice(0, 101), chunked[0]!]), /cannot repeat an identity/u);
      assert.equal((await tx.query<{ count: string }>(`SELECT count(*) FROM "${f.schema}".records WHERE kind = 'chunked'`)).rows[0]?.count, '0',
        'duplicate preflight spans every prospective chunk before the first write');
      await records.writeMany(tx, chunked);
    });
    assert.deepEqual((await f.pool.query(`SELECT count(*)::text AS count, min(revision)::text AS minimum, max(revision)::text AS maximum FROM "${f.schema}".records WHERE kind = 'chunked'`)).rows,
      [{ count: '515', minimum: '1', maximum: '1' }]);
    const large = 'x'.repeat(2_097_153);
    await withPaymentTransaction(f.database, tx => records.writeMany(tx, [
      { kind: 'large-batch', id: 'single', body: large }, { kind: 'large-batch', id: 'following', body: null },
    ]));
    assert.equal((await f.pool.query<{ length: number }>(`SELECT length(body #>> '{}') AS length FROM "${f.schema}".records WHERE kind = 'large-batch' AND id = 'single'`)).rows[0]?.length, large.length,
      'an individually oversized serialized body retains the prior single-write behavior');
    await f.pool.query(`CREATE FUNCTION "${f.schema}".reject_late_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind = 'rollback-batch' AND NEW.id = 'row-514' THEN RAISE EXCEPTION 'injected late record batch failure'; END IF; RETURN NEW; END $$`);
    await f.pool.query(`CREATE TRIGGER reject_late_batch BEFORE INSERT OR UPDATE ON "${f.schema}".records FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_late_batch()`);
    await assert.rejects(withPaymentTransaction(f.database, tx => records.writeMany(tx, chunked.map(row => ({ ...row, kind: 'rollback-batch' })))), /injected late record batch failure/u);
    assert.equal((await f.pool.query<{ count: string }>(`SELECT count(*) FROM "${f.schema}".records WHERE kind = 'rollback-batch'`)).rows[0]?.count, '0',
      'a failure in the final chunk rolls back every preceding chunk');
  } finally { await f.close(); }
});

void test('typed queries preserve existing schemaVersion 1 JSON bodies, no-op revisions and exact int8 range checks', async () => {
  const publicRecords = paymentTables('public').records;
  assert.match(paymentQueries.select({ id: publicRecords.id }).from(publicRecords).toSQL().sql, /from "public"\."records"/u,
    'the existing public schema option stays explicit and independent of host search_path');
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
    await migratePaymentSchema({ database: f.database, schema: f.schema, scope });
    const after = (await f.pool.query<{ relation: string; body: unknown }>(
      `SELECT '${f.schema}.records'::regclass::oid::text AS relation, body FROM "${f.schema}".configuration WHERE id = 'owner'`,
    )).rows[0];
    assert.deepEqual(after, before, 'baseline bootstrap preserves table identity and owner metadata');
    await withPaymentTransaction(f.database, async tx => {
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
      const grouped = await records.readMany(tx, 'codecs', ['string', 'missing', 'null', 'string']);
      assert.deepEqual([...grouped.keys()].toSorted(), ['null', 'string']);
      assert.deepEqual(grouped.get('null'), { revision: 1, body: null });
      assert.deepEqual(grouped.get('string'), { revision: 1, body: 'opaque' });
      assert.equal((await records.readMany(tx, 'codecs', [])).size, 0);
      assert.equal((await records.readMany(tx, 'missing', Array.from({ length: 400 }, (_, index) => `key-${index}`))).size, 0,
        'incoming and retained exact-version identities can exceed one 200-input page');
      await assert.rejects(records.readMany(tx, 'missing', Array.from({ length: 513 }, (_, index) => `key-${index}`)), RangeError);
      await records.guard(tx, 'membership');
      await records.guard(tx, 'membership');
      assert.equal((await records.read(tx, 'guards', 'membership'))?.revision, 2, 'membership guards advance even when their body is unchanged');
    });
    await f.pool.query(`INSERT INTO "${f.schema}".records (kind, id, revision, body) VALUES ('range', 'max', 9007199254740991, '{}'), ('range', 'overflow', 9007199254740992, '{}')`);
    await withPaymentTransaction(f.database, async tx => {
      assert.equal((await records.read(tx, 'range', 'max'))?.revision, Number.MAX_SAFE_INTEGER);
      assert.equal((await records.readMany(tx, 'range', ['max'])).get('max')?.revision, Number.MAX_SAFE_INTEGER);
      await assert.rejects(records.read(tx, 'range', 'overflow'), RangeError);
      await assert.rejects(records.readMany(tx, 'range', ['max', 'overflow']), RangeError);
    });
  } finally { await f.close(); }
});

void test('typed obligation upserts preserve attempts, quarantine and cooldown until an explicit reset', async () => {
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
    await withPaymentTransaction(f.database, tx => records.obligation(tx, work, 'quarantined'));
    assert.deepEqual(await read(), before, 'idempotent quarantine does not refresh its budget or revision');
    await withPaymentTransaction(f.database, tx => records.obligation(tx, work, 'complete'));
    assert.deepEqual(await read(), { ...before, state: 'complete', revision: '13' });
    await withPaymentTransaction(f.database, async tx => {
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
