import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdapter } from '../public/js/storage.js';
import { createDataService, migrateStorage, SCHEMA_VERSION, DATA_KEYS } from '../public/js/dataService.js';

const seed = async (st, data) => { for (const [k, v] of Object.entries(data)) await st.set(k, v); };

test('初めて使うときは、今の版を記録するだけ', async () => {
  const st = createMemoryAdapter();
  assert.deepEqual(await migrateStorage(st), { status: 'fresh', from: null, to: SCHEMA_VERSION });
  assert.equal(await st.get('schemaVersion'), SCHEMA_VERSION);
  assert.equal(await st.get('preMigrationBackup'), null);
  assert.equal((await migrateStorage(st)).status, 'current');
});

test('版の記録がない古いデータは v1 として変換し、変換前のデータを残す', async () => {
  const st = createMemoryAdapter();
  await seed(st, {
    profile: { takeHome: 300000 },
    expenses: [{ id: 'a', date: '2026-10-01', category: 'food', amount: '500.4' }, { id: 'b', category: 'food', amount: 100 }],
    goals: [{ id: 'g', name: '車', targetAmount: '100000', saved: 5000 }],
  });
  const r = await migrateStorage(st);
  assert.deepEqual(r, { status: 'migrated', from: 1, to: SCHEMA_VERSION });
  assert.deepEqual(await st.get('expenses'), [{ id: 'a', date: '2026-10-01', category: 'food', amount: 500, shop: '', memo: '' }]);
  const [g] = await st.get('goals');
  assert.deepEqual([g.targetAmount, g.lastContributionMonth, g.lastContributionAmount], [100000, null, 0]);
  const backup = await st.get('preMigrationBackup');
  assert.equal(backup.fromVersion, 1);
  assert.equal(backup.data.expenses.length, 2); // 変換前のまま
});

test('変換は版の順に1つずつ適用する', async () => {
  const st = createMemoryAdapter();
  await seed(st, { schemaVersion: 1, profile: {} });
  const order = [];
  await migrateStorage(st, { 2: async () => order.push(2), 3: async () => order.push(3) }, 3);
  assert.deepEqual(order, [2, 3]);
  assert.equal(await st.get('schemaVersion'), 3);
});

test('新しい版のアプリで保存されたデータは書き換えない', async () => {
  const st = createMemoryAdapter();
  await seed(st, { schemaVersion: SCHEMA_VERSION + 1, expenses: [{ amount: '1' }] });
  assert.equal((await migrateStorage(st)).status, 'newer');
  assert.deepEqual(await st.get('expenses'), [{ amount: '1' }]);
});

test('復元：今のデータを丸ごと置き換え、古いバックアップは今の版に変換する', async () => {
  const st = createMemoryAdapter();
  const ds = createDataService(st);
  await seed(st, { schemaVersion: SCHEMA_VERSION, goals: [{ id: 'now' }], expenses: [] });
  await ds.importAll({ app: 'my-money', version: 1, data: { profile: { takeHome: 1 }, expenses: [{ id: 'x', date: '2026-01-01', amount: '9' }], evil: 1 } });
  assert.equal(await st.get('goals'), null); // バックアップにない項目は消える
  assert.equal(await st.get('evil'), null); // 知らない項目は読み込まない
  assert.equal((await st.get('expenses'))[0].amount, 9); // v1 → 今の版に変換
  assert.equal(await st.get('schemaVersion'), SCHEMA_VERSION);
});

test('復元：新しい版のアプリで作ったバックアップは断る', async () => {
  const ds = createDataService(createMemoryAdapter());
  await assert.rejects(ds.importAll({ app: 'my-money', schemaVersion: SCHEMA_VERSION + 1, data: {} }), /新しいバージョン/);
  await assert.rejects(ds.importAll({ foo: 1 }), /バックアップファイルではありません/);
});

test('書き出し：今の版と、バックアップ対象の項目だけを含める', async () => {
  const st = createMemoryAdapter();
  await seed(st, { profile: { takeHome: 1 }, meta: { lastBackupAt: 'x' } });
  const out = await createDataService(st).exportAll();
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(out.data), DATA_KEYS);
});
