import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

const migration = '202610150001_transaction_history_filters.sql';
before(async () => { try { await applyMigration(migration); } catch (e) { if (e.code !== 'ENOENT') throw e; } });
async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
async function insert(f, rows) {
  const groups = [...new Set(rows.map(r => r.installment_group_id).filter(Boolean))];
  if (groups.length) requireSuccess(await f.admin.from('financial_operations').upsert(groups.map(id => ({ id, user_id: f.owner.id, request_id: id, command_hash: '0'.repeat(64), command: {} }))));
  return requireSuccess(await f.admin.from('transactions').insert(rows.map(r => ({ user_id: f.owner.id, account_id: f.owner.account.id, type: 'expense', amount: '1.00', date: '2026-10-15', ...r }))).select());
}
async function page(f, q = {}, who = f.owner) { const r = await who.client.rpc('transaction_history_page', { p_query: q }); assert.equal(r.error, null, JSON.stringify(r.error)); return r.data; }
async function account(f, currency = 'PHP', who = f.owner) { return requireSuccess(await f.admin.from('accounts').insert({ user_id: who.id, name: `Wallet ${currency}`, type: 'bank', currency }).select().single()); }

test('finds old history beyond 1,000 rows and pages 50 complete logical groups without repeats', async t => {
  const f = await setup(t);
  await insert(f, Array.from({ length: 1050 }, (_, i) => ({ description: `old ${i}`, created_at: '2020-01-01T00:00:00Z' })));
  const groups = Array.from({ length: 55 }, () => randomUUID());
  await insert(f, groups.flatMap(installment_group_id => [ { installment_group_id, description: 'needle', date: '2026-10-01' }, { installment_group_id, description: 'sibling', date: '2027-01-01', amount: '2.25' } ]));
  const a = await page(f, { search: 'needle' }); const b = await page(f, { search: 'needle', offset: 50 });
  assert.equal(a.version, 1); assert.equal(a.totalMatchingEntries, 55); assert.equal(a.entries.length, 50); assert.equal(a.nextOffset, 50);
  assert.equal(b.entries.length, 5); assert.equal(b.nextOffset, null); assert.equal(new Set([...a.entries, ...b.entries].map(e => e.key)).size, 55);
  for (const e of [...a.entries, ...b.entries]) { assert.equal(e.rows.length, 2); assert.equal(e.matchingRowIds.length, 1); assert.equal(e.recordedAmount, '3.25'); assert.equal(e.kind, 'installment_group'); assert.equal(e.transactionDate, '2027-01-01'); assert.equal(e.rows[0].amount, '1.00'); assert.ok(!('descriptionProof' in e.rows[0])); }
  assert.equal((await page(f, { search: 'old 1049' })).totalMatchingEntries, 1);
  for (const sort of ['transaction_date_asc', 'transaction_date_desc', 'date_added_asc', 'date_added_desc', 'amount_asc', 'amount_desc']) {
    const first = await page(f, { search: 'needle', sort }); const last = await page(f, { search: 'needle', sort, offset: 50 });
    const keys = [...first.entries, ...last.entries].map(e => e.key);
    assert.equal(new Set(keys).size, 55);
    const want = groups.map(id => `installment:${id}`).sort();
    if (sort.endsWith('_desc')) want.reverse();
    // The rows share one insert timestamp, so entry key resolves every tie.
    assert.deepEqual(keys, want);
  }
});

test('requires same child for every predicate and uses complete children for amount and purchase date', async t => {
  const f = await setup(t); const w = await account(f);
  const c = requireSuccess(await f.owner.client.from('categories').insert({ user_id: f.owner.id, name: 'Food', type: 'expense' }).select().single());
  const g = randomUUID();
  const rows = await insert(f, [{ installment_group_id: g, category_id: c.id, description: 'target', date: '2026-10-01', amount: '0.10', purchase_date: '2026-09-01' }, { installment_group_id: g, account_id: w.id, description: 'other', date: '2026-11-01', amount: '0.20', purchase_date: '2026-09-01' }]);
  assert.equal((await page(f, { categoryIds: [c.id], start: '2026-11-01', end: '2026-11-01' })).totalMatchingEntries, 0);
  assert.equal((await page(f, { search: 'target', walletIds: [w.id] })).totalMatchingEntries, 0);
  const p = await page(f, { search: 'target', minAmount: '0.30', maxAmount: '0.30' });
  assert.equal(p.totalMatchingEntries, 1); assert.equal(p.entries[0].recordedAmount, '0.30'); assert.equal(p.entries[0].transactionDate, '2026-09-01'); assert.deepEqual(p.entries[0].matchingRowIds, [rows[0].id]);
});

test('matches either transfer wallet, excludes transfers from category filters, and searches literal text', async t => {
  const f = await setup(t); const w = await account(f);
  await insert(f, [{ type: 'transfer', transfer_to_account_id: w.id, description: "literal %_\\' OR true --" }, { description: 'ordinary' }]);
  assert.equal((await page(f, { walletIds: [w.id] })).totalMatchingEntries, 1);
  assert.equal((await page(f, { walletIds: [f.owner.account.id] })).totalMatchingEntries, 2);
  assert.equal((await page(f, { includeUncategorized: true })).totalMatchingEntries, 1);
  for (const search of ['%', '_', "\\' OR true --"]) assert.equal((await page(f, { search })).totalMatchingEntries, 1);
});

test('sorts all six ways with stable ties and canonical date metadata', async t => {
  const f = await setup(t);
  const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'];
  await insert(f, ids.map((id, i) => ({ id, date: i ? '2026-10-02' : '2026-10-01', created_at: i ? '2026-10-02T00:00:00Z' : '2026-10-01T00:00:00Z', amount: i ? '2.00' : '1.00' })));
  for (const sort of ['transaction_date_asc', 'date_added_asc', 'amount_asc']) assert.deepEqual((await page(f, { sort })).entries.map(e => e.rows[0].id), ids);
  for (const sort of ['transaction_date_desc', 'date_added_desc', 'amount_desc']) assert.deepEqual((await page(f, { sort })).entries.map(e => e.rows[0].id), [...ids].reverse());
});

test('keeps foreign and invalid money outside amount mode, counts exclusions before bounds once, sums beyond row precision', async t => {
  const f = await setup(t); const usd = await account(f, 'USD');
  const group = randomUUID();
  await insert(f, [{ amount: 'NaN' }, { amount: '-0.01' }, { account_id: usd.id, amount: 'NaN' }, { type: 'transfer', transfer_to_account_id: usd.id }, { amount: '0.10' }, { amount: '9999999999999.99', installment_group_id: group }, { amount: '9999999999999.99', installment_group_id: group }]);
  assert.equal((await page(f)).totalMatchingEntries, 6);
  const p = await page(f, { sort: 'amount_desc' }); assert.equal(p.totalMatchingEntries, 2); assert.equal(p.excludedCurrencyEntryCount, 2); assert.equal(p.invalidAmountEntryCount, 2); assert.equal(p.entries[0].recordedAmount, '19999999999999.98');
  const bounded = await page(f, { minAmount: '1' }); assert.equal(bounded.totalMatchingEntries, 1); assert.equal(bounded.excludedCurrencyEntryCount, 2); assert.equal(bounded.invalidAmountEntryCount, 2);
});

test('does not expose other owner related names or rows and denies anon/service roles', async t => {
  const f = await setup(t); const foreign = await account(f, 'PHP', f.other);
  const c = requireSuccess(await f.other.client.from('categories').insert({ user_id: f.other.id, name: 'Secret category', type: 'expense' }).select().single());
  await insert(f, [{ description: 'mine', category_id: c.id, transfer_to_account_id: foreign.id }, { type: 'transfer', transfer_to_account_id: foreign.id }, { user_id: f.other.id, account_id: foreign.id, description: 'foreign' }]);
  assert.equal((await page(f, { search: 'Secret category' })).totalMatchingEntries, 0);
  const p = await page(f); assert.equal(p.totalMatchingEntries, 2); for (const e of p.entries) { assert.equal(e.rows[0].category, null); assert.equal(e.rows[0].transfer_to_account, null); }
  assert.equal((await page(f, { sort: 'amount_asc' })).excludedCurrencyEntryCount, 1);
  const { url, options, queryAdmin } = await databaseRuntime(); const anon = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  assert.ok((await anon.rpc('transaction_history_page', { p_query: {} })).error);
  assert.ok((await f.admin.rpc('transaction_history_page', { p_query: {} })).error);
  const [grants] = await queryAdmin("SELECT has_function_privilege('anon','public.transaction_history_page(jsonb)','execute') AS anon, has_function_privilege('service_role','public.transaction_history_page(jsonb)','execute') AS service"); assert.deepEqual(grants, { anon: false, service: false });
});

test('validates every supplied field, caps and calendar ranges without executing hostile input', async t => {
  const f = await setup(t);
  for (const q of [null, [], { owner: f.other.id }, { version: 2 }, { version: '1' }, { sort: 'drop table transactions' }, { type: 'other' }, { offset: -1 }, { offset: 1000001 }, { offset: 1.2 }, { offset: '1' }, { search: 1 }, { search: 'a'.repeat(121) }, { includeUncategorized: 'true' }, { walletIds: ['bad'] }, { categoryIds: Array(101).fill(randomUUID()) }, { minAmount: '-1' }, { minAmount: 'NaN' }, { maxAmount: '1.234' }, { maxAmount: '10000000000000' }, { minAmount: 1 }, { minAmount: '2', maxAmount: '1' }, { start: '2026-02-30', end: '2026-03-01' }, { start: '2026-10-01' }, { start: '0000-01-01', end: '2026-01-01' }, { start: '2026-10-02', end: '2026-10-01' }]) {
    const r = await f.owner.client.rpc('transaction_history_page', { p_query: q }); assert.equal(r.error?.message, 'INVALID_HISTORY_QUERY', JSON.stringify(q));
  }
  assert.equal((await page(f, { start: '2028-02-29', end: '2028-02-29', minAmount: '000.1', maxAmount: ' ' })).totalMatchingEntries, 0);
});

test('reapplies LF/CRLF migration with identical security and semantics', async t => {
  const f = await setup(t); const { queryAdmin } = await databaseRuntime(); const sql = (await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n'); const result = [];
  for (const raw of [sql, sql.replace(/\n/g, '\r\n')]) { await queryAdmin(raw); const [r] = await queryAdmin("SELECT prosecdef, provolatile, proconfig, proacl::text FROM pg_proc WHERE oid='public.transaction_history_page(jsonb)'::regprocedure"); result.push(r); assert.equal((await page(f)).totalMatchingEntries, 0); }
  assert.deepEqual(result[0], result[1]); assert.equal(result[0].prosecdef, false); assert.equal(result[0].provolatile, 's'); assert.deepEqual(result[0].proconfig, ['search_path=pg_catalog, public']);
});

test('amount eligibility checks nonmatching siblings and inconsistent group dates use latest due', async t => {
  const f = await setup(t); const usd = await account(f, 'USD'); const g = randomUUID();
  await insert(f, [{ installment_group_id: g, description: 'match', date: '2026-10-01', purchase_date: '2026-09-01' }, { installment_group_id: g, description: 'sibling', date: '2026-11-01', purchase_date: '2026-09-02', account_id: usd.id }]);
  const ordinary = await page(f, { search: 'match' }); assert.equal(ordinary.entries[0].transactionDate, '2026-11-01'); assert.equal(ordinary.entries[0].currency, null);
  const amount = await page(f, { search: 'match', sort: 'amount_desc' }); assert.equal(amount.totalMatchingEntries, 0); assert.equal(amount.excludedCurrencyEntryCount, 1); assert.equal(amount.invalidAmountEntryCount, 0);
});

test('malformed historical group dates stay unavailable and sort last in both directions', async t => {
  const f = await setup(t); const g = randomUUID();
  await insert(f, [{ installment_group_id: g, purchase_date: 'infinity' }, { date: '2026-10-01' }]);
  for (const sort of ['transaction_date_asc', 'transaction_date_desc']) {
    const p = await page(f, { sort }); assert.equal(p.entries[1].groupId, g); assert.equal(p.entries[1].transactionDate, null);
    assert.equal(p.entries[1].rows[0].purchase_date, null); assert.equal(p.entries[1].rows[0].history_date, null);
  }
});
