import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

const migration = '202610140001_spending_summary.sql';
before(async () => {
  try { await applyMigration(migration); } catch (error) { if (error.code !== 'ENOENT') throw error; }
});
async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}
const params = (start = '2026-10-01', end = '2026-10-31') => ({ p_start: start, p_end: end });
async function summary(f, range = params(), identity = f.owner) {
  const response = await identity.client.rpc('spending_summary', range);
  assert.equal(response.error, null, JSON.stringify(response.error));
  return response.data;
}
async function account(f, type, currency = 'PHP', identity = f.owner) {
  return requireSuccess(await f.admin.from('accounts').insert({ user_id: identity.id, name: `${type} ${currency}`, type, currency, balance: '0.00' }).select().single());
}
async function insert(f, rows) {
  requireSuccess(await f.admin.from('transactions').insert(rows.map(row => ({ user_id: f.owner.id, account_id: f.owner.account.id, type: 'expense', amount: '1.00', date: '2026-10-15', ...row }))));
}

test('counts non-credit expenses and card repayments once, ignores card purchases and wallet-to-wallet transfers', async t => {
  const f = await setup(t);
  const card = await account(f, 'credit_card');
  const bank = await account(f, 'bank');
  await insert(f, [
    { amount: '10.10' }, { amount: '0.20', goal_id: f.owner.goal.id },
    { account_id: bank.id, amount: '2.00' },
    { type: 'transfer', amount: '3.30', transfer_to_account_id: card.id },
    { account_id: card.id, amount: '100.00', goal_id: f.owner.goal.id },
    { type: 'transfer', amount: '500.00', transfer_to_account_id: bank.id },
    { account_id: card.id, type: 'income', amount: '50.00' },
    { account_id: card.id, type: 'transfer', amount: '70.00', transfer_to_account_id: bank.id },
    { type: 'income', amount: '1.05' },
  ]);
  assert.deepEqual(await summary(f), { start: '2026-10-01', end: '2026-10-31', spent: '15.60', expenses: '12.30', debtPayments: '3.30', income: '1.05', net: '-14.55', categories: [{ categoryId: null, name: 'Uncategorized', amount: '12.30' }], transactionCount: 5, excludedCurrencyTransactionCount: 0 });
});

test('groups by category with Uncategorized for null category and keeps debt payments out of categories', async t => {
  const f = await setup(t);
  const food = requireSuccess(await f.owner.client.from('categories').insert({ user_id: f.owner.id, name: 'Food', type: 'expense' }).select().single());
  const shared = requireSuccess(await f.admin.from('categories').insert({ name: 'Shared', type: 'expense', is_default: true }).select().single());
  t.after(async () => { requireSuccess(await f.admin.from('categories').delete().eq('id', shared.id)); });
  const card = await account(f, 'credit_card');
  await insert(f, [{ amount: '2.10', category_id: food.id }, { amount: '0.20', category_id: food.id }, { amount: '1.00' }, { amount: '0.50', category_id: shared.id }, { type: 'transfer', amount: '10.00', transfer_to_account_id: card.id, category_id: food.id }]);
  requireSuccess(await f.owner.client.from('categories').update({ name: 'Groceries' }).eq('id', food.id));
  assert.deepEqual((await summary(f)).categories, [{ categoryId: food.id, name: 'Groceries', amount: '2.30' }, { categoryId: null, name: 'Uncategorized', amount: '1.00' }, { categoryId: shared.id, name: 'Shared', amount: '0.50' }]);
});

test('is exact for 1,200 expenses in one month', async t => {
  const f = await setup(t);
  await insert(f, Array.from({ length: 1200 }, () => ({ amount: '0.01' })));
  const result = await summary(f);
  assert.equal(result.spent, '12.00');
  assert.equal(result.net, '-12.00');
  assert.equal(result.transactionCount, 1200);
});

test('includes rows on the start and end dates and excludes the day before and after', async t => {
  const f = await setup(t);
  await insert(f, [{ date: '2026-09-30', amount: '100.00' }, { date: '2026-10-01', amount: '0.10' }, { date: '2026-10-31', amount: '0.20' }, { date: '2026-11-01', amount: '200.00' }]);
  assert.equal((await summary(f)).spent, '0.30');
  assert.equal((await summary(f, params('2026-10-01', '2026-10-01'))).spent, '0.10');
});

test("returns another user's rows to no one", async t => {
  const f = await setup(t);
  await insert(f, [{ amount: '1.00' }, { user_id: f.other.id, account_id: f.other.account.id, amount: '900.00' }]);
  assert.equal((await summary(f)).spent, '1.00');
  assert.equal((await summary(f, params(), f.other)).spent, '900.00');
  const { url, options, queryAdmin } = await databaseRuntime();
  const anon = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  assert.ok((await anon.rpc('spending_summary', params())).error);
  await assert.rejects(queryAdmin('SELECT public.spending_summary($1::date,$2::date)', ['2026-10-01', '2026-10-31']), /NOT_ALLOWED/);
});

test('does not read foreign account identities or private category names from inconsistent historical rows', async t => {
  const f = await setup(t);
  const card = await account(f, 'credit_card', 'PHP', f.other);
  const category = requireSuccess(await f.other.client.from('categories').insert({ user_id: f.other.id, name: 'Private other category', type: 'expense' }).select().single());
  await insert(f, [{ account_id: f.other.account.id, amount: '50.00' }, { type: 'transfer', transfer_to_account_id: card.id, amount: '60.00' }, { category_id: category.id, amount: '2.00' }]);
  const result = await summary(f);
  assert.equal(result.spent, '2.00');
  assert.equal(result.transactionCount, 1);
  assert.deepEqual(result.categories, [{ categoryId: null, name: 'Uncategorized', amount: '2.00' }]);
});

test('rejects missing, nonfinite, reversed ranges and ranges over 366 days with INVALID_RANGE', async t => {
  const f = await setup(t);
  for (const range of [params(null), params('2026-10-01', null), params('2026-10-02', '2026-10-01'), params('2026-01-01', '2027-01-02'), params('-infinity', '2026-10-01'), params('2026-10-01', 'infinity'), params('infinity', 'infinity'), params('4713-01-01 BC', '5874897-12-31')]) {
    const result = await f.owner.client.rpc('spending_summary', range);
    assert.equal(result.error?.message, 'INVALID_RANGE', JSON.stringify(range));
  }
  assert.equal((await summary(f, params('2026-01-01', '2027-01-01'))).spent, '0.00');
});

test('excludes non-PHP source or debt destination currency once and excludes irrelevant rows from both counts', async t => {
  const f = await setup(t);
  const usd = await account(f, 'bank', 'USD');
  const usdCard = await account(f, 'credit_card', 'USD');
  const phpCard = await account(f, 'credit_card');
  await insert(f, [
    { amount: '0.10' }, { type: 'income', amount: '0.30' },
    { type: 'transfer', transfer_to_account_id: phpCard.id, amount: '0.10' },
    { account_id: usd.id, amount: '100.00' }, { account_id: usd.id, type: 'income', amount: '200.00' },
    { type: 'transfer', transfer_to_account_id: usdCard.id, amount: '300.00' },
    { account_id: usd.id, type: 'transfer', transfer_to_account_id: usdCard.id, amount: '400.00' },
    { account_id: usd.id, type: 'transfer', transfer_to_account_id: phpCard.id, amount: '500.00' },
    { account_id: usdCard.id, amount: '600.00' },
    { type: 'transfer', transfer_to_account_id: usd.id, amount: '700.00' },
  ]);
  const result = await summary(f);
  assert.equal(result.spent, '0.20');
  assert.equal(result.income, '0.30');
  assert.equal(result.net, '0.10');
  assert.equal(result.transactionCount, 3);
  assert.equal(result.excludedCurrencyTransactionCount, 5);
});

test('returns exact aggregate money strings above individual transaction precision', async t => {
  const f = await setup(t);
  await insert(f, [{ amount: '9999999999999.99' }, { amount: '9999999999999.99' }]);
  assert.equal((await summary(f)).spent, '19999999999999.98');
});

test('rejects invalid historical qualifying money instead of reporting nonfinite or negative totals', async t => {
  const f = await setup(t);
  for (const amount of ['NaN', '-0.01']) {
    await insert(f, [{ amount }]);
    const result = await f.owner.client.rpc('spending_summary', params());
    assert.equal(result.error?.message, 'INVALID_AMOUNT');
    requireSuccess(await f.admin.from('transactions').delete().eq('user_id', f.owner.id));
  }
});

test('matches the current useDashboardStats arithmetic for a mixed fixture', async t => {
  const f = await setup(t);
  const card = await account(f, 'credit_card');
  const wallet = await account(f, 'e_wallet');
  const investment = await account(f, 'investment');
  await insert(f, [{ amount: '3.25' }, { account_id: wallet.id, amount: '2.25' }, { account_id: investment.id, type: 'income', amount: '15.00' }, { account_id: card.id, amount: '40.00' }, { type: 'transfer', transfer_to_account_id: card.id, amount: '1.50' }, { type: 'transfer', transfer_to_account_id: wallet.id, amount: '20.00' }]);
  const rows = requireSuccess(await f.owner.client.from('transactions').select('*'));
  const accounts = requireSuccess(await f.owner.client.from('accounts').select('id,type'));
  const types = new Map(accounts.map(a => [a.id, a.type]));
  const credit = id => types.get(id) === 'credit_card';
  const income = rows.filter(r => r.type === 'income' && !credit(r.account_id)).reduce((s, r) => s + Number(r.amount), 0);
  const expenses = rows.filter(r => r.type === 'expense' && !credit(r.account_id)).reduce((s, r) => s + Number(r.amount), 0);
  const debt = rows.filter(r => r.type === 'transfer' && !credit(r.account_id) && credit(r.transfer_to_account_id)).reduce((s, r) => s + Number(r.amount), 0);
  const result = await summary(f);
  assert.equal(result.spent, '7.00');
  assert.equal(result.income, income.toFixed(2));
  assert.equal(result.spent, (expenses + debt).toFixed(2));
});

test('installs from raw CRLF and raw LF text with identical function semantics and grants', async t => {
  const f = await setup(t);
  const { queryAdmin } = await databaseRuntime();
  const sql = (await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const catalogs = [];
  for (const raw of [sql.replace(/\n/g, '\r\n'), sql]) {
    await queryAdmin(raw);
    const [catalog] = await queryAdmin(`SELECT p.prosrc, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text AS grants,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
      FROM pg_proc p WHERE p.oid='public.spending_summary(date,date)'::regprocedure`);
    catalog.prosrc = catalog.prosrc.replace(/\r\n/g, '\n');
    catalogs.push(catalog);
    assert.equal((await summary(f)).spent, '0.00');
  }
  assert.deepEqual(catalogs[0], catalogs[1]);
  assert.equal(catalogs[0].prosecdef, false);
  assert.equal(catalogs[0].provolatile, 's');
  assert.deepEqual(catalogs[0].proconfig, ['search_path=pg_catalog, public']);
  assert.equal(catalogs[0].authenticated, true);
  assert.equal(catalogs[0].anon, false);
  assert.equal(catalogs[0].public_execute, false);
  const indexes = await queryAdmin(`SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='transactions'`);
  assert.ok(indexes.some(row => /\(user_id, date\)/.test(row.indexdef)));
});
