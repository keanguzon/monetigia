import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

const migration = '202610070001_installment_purchase_dates.sql';
before(async () => {
  for (const name of ['202610060004_goal_transaction_operations.sql', '202610060005_goal_lifecycle_operations.sql', '202610060006_goal_write_guards.sql']) await applyMigration(name);
  try { await applyMigration(migration); } catch (error) { if (error.code !== 'ENOENT') throw error; }
});
async function setup(t) {
  const f = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(f));
  const card = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0 }).select().single());
  return { ...f, card };
}
const draft = (f, overrides = {}) => ({ type: 'expense', accountId: f.card.id, transferToAccountId: null, categoryId: null, goalId: null, amount: '1000.01', description: 'Laptop', date: '2026-10-06', installments: { count: 3, firstDueDate: '2026-11-06' }, reservationMoves: [], ...overrides });
const quote = (f, d) => f.owner.client.rpc('goal_transaction_quote', { p_draft: d });
const apply = (f, d, q, id = randomUUID()) => f.owner.client.rpc('goal_finance_apply', { p_request_id: id, p_command: { kind: 'transaction', draft: d }, p_quote: q });
async function save(f, d) { return requireSuccess(await apply(f, d, requireSuccess(await quote(f, d)))); }
const transactions = async f => requireSuccess(await f.owner.client.from('transactions').select('*').eq('user_id', f.owner.id).order('date').order('id'));

test('purchase metadata separates due dates, splits centavos once, and replay preserves one group', async t => {
  const f = await setup(t);
  const d = draft(f), q = requireSuccess(await quote(f, d)), id = randomUUID();
  const result = requireSuccess(await apply(f, d, q, id));
  const tx = await transactions(f);
  assert.deepEqual(tx.map(row => [row.amount, row.date, row.purchase_date, row.installment_group_id]), [
    [333.34, '2026-11-06', '2026-10-06', result.operationId],
    [333.34, '2026-12-06', '2026-10-06', result.operationId],
    [333.33, '2027-01-06', '2026-10-06', result.operationId],
  ]);
  assert.deepEqual(tx.map(row => row.history_date), ['2026-10-06', '2026-10-06', '2026-10-06']);
  assert.equal(requireSuccess(await apply(f, d, q, id)).replayed, true);
  assert.deepEqual(await transactions(f), tx);
  assert.equal(requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id', f.card.id).single()).balance, 1000.01);
  assert.equal((await apply(f, draft(f, { installments: { count: 3, firstDueDate: '2026-11-07' } }), q, id)).error?.message, 'REQUEST_CONFLICT');
  assert.equal((await apply(f, draft(f, { installments: { count: 3, firstDueDate: '2026-11-07' } }), q)).error?.message, 'STALE_QUOTE');
});

test('installment monthly dates retain the anchor across short and leap months', async t => {
  const f = await setup(t);
  for (const [firstDueDate, expected] of [
    ['2027-01-31', ['2027-01-31', '2027-02-28', '2027-03-31']],
    ['2028-01-31', ['2028-01-31', '2028-02-29', '2028-03-31']],
  ]) {
    const result = await save(f, draft(f, { installments: { count: 3, firstDueDate } }));
    assert.deepEqual((await transactions(f)).filter(row => result.transactionIds.includes(row.id)).map(row => row.date), expected);
  }
  const legacy = await save(f, draft(f, { date: '2026-10-01', installments: { count: 3 } }));
  assert.deepEqual((await transactions(f)).filter(row => legacy.transactionIds.includes(row.id)).map(row => row.date), ['2026-10-01', '2026-11-01', '2026-12-01']);
  const legacyDay = await save(f, draft(f, { date: '2027-05-31', installments: { count: 3 } }));
  assert.deepEqual((await transactions(f)).filter(row => legacyDay.transactionIds.includes(row.id)).map(row => row.date), ['2027-05-31', '2027-06-30', '2027-07-31']);
});

test('malformed due dates, foreign owners and direct metadata edits cannot write money', async t => {
  const f = await setup(t);
  for (const firstDueDate of ['2026-02-30', '2027-02-29', '2026-1-01', null, 20261106]) {
    assert.equal((await quote(f, draft(f, { installments: { count: 3, firstDueDate } }))).error?.message, 'INVALID_STATE');
  }
  assert.equal((await quote(f, draft(f, { accountId: f.other.account.id }))).error?.message, 'NOT_ALLOWED');
  assert.deepEqual(await transactions(f), []);
  const result = await save(f, draft(f));
  const foreign = await f.other.client.from('transactions').select('*').eq('installment_group_id', result.operationId);
  assert.deepEqual(requireSuccess(foreign), []);
  assert.ok((await f.owner.client.from('transactions').update({ purchase_date: '2026-01-01' }).eq('id', result.transactionIds[0])).error);
  const { queryAdmin } = await databaseRuntime();
  const otherOperation = requireSuccess(await f.admin.from('financial_operations').insert({ user_id: f.other.id, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: {} }).select().single());
  await assert.rejects(queryAdmin(`UPDATE public.transactions SET installment_group_id='${otherOperation.id}' WHERE id='${result.transactionIds[0]}'`), /foreign key/i);
  assert.equal((await transactions(f))[0].installment_group_id, result.operationId);
});

test('ordinary entries and debt payment retain the selected calendar date', async t => {
  const f = await setup(t);
  await save(f, draft(f, { date: '2026-10-06', installments: null }));
  await save(f, draft(f, { type: 'transfer', accountId: f.owner.account.id, transferToAccountId: f.card.id, amount: '100.00', date: '2026-10-09', installments: null }));
  await save(f, draft(f, { type: 'income', accountId: f.owner.account.id, amount: '20.00', date: '2026-10-11', installments: null }));
  const tx = await transactions(f);
  assert.deepEqual(tx.map(row => row.date), ['2026-10-06', '2026-10-09', '2026-10-11']);
  assert.deepEqual(tx.map(row => row.history_date), ['2026-10-06', '2026-10-09', '2026-10-11']);
  assert.ok(tx.every(row => row.installment_group_id === null && row.purchase_date === null));
  assert.equal((await quote(f, draft(f, { type: 'transfer', accountId: f.owner.account.id, transferToAccountId: f.card.id, amount: '1.00', date: '2026-11-09', installments: null }))).error?.message, 'INVALID_STATE');
});

test('backfill groups only proven operation IDs without inventing legacy purchase dates', async t => {
  const f = await setup(t);
  await applyMigration('202610060004_goal_transaction_operations.sql');
  await applyMigration('202610060005_goal_lifecycle_operations.sql');
  const oldDraft = draft(f, { date: '2026-10-01', installments: { count: 3 } });
  const oldQuote = requireSuccess(await quote(f, oldDraft)), request = randomUUID();
  const result = requireSuccess(await apply(f, oldDraft, oldQuote, request));
  const unrelated = requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.card.id, type: 'expense', amount: 333.34, description: 'Laptop (Installment 1/3)', date: '2026-10-01' }).select().single());
  const prior = await transactions(f);
  await applyMigration(migration);
  await applyMigration(migration);
  const after = await transactions(f);
  assert.deepEqual(after.map(row => [row.id, row.amount, row.date]), prior.map(row => [row.id, row.amount, row.date]));
  assert.ok(after.filter(row => result.transactionIds.includes(row.id)).every(row => row.installment_group_id === result.operationId && row.purchase_date === null));
  assert.equal(after.find(row => row.id === unrelated.id).installment_group_id, null);
  assert.deepEqual(requireSuccess(await apply(f, oldDraft, oldQuote, request)), { ...result, replayed: true });
  const created = await save(f, draft(f));
  assert.equal((await transactions(f)).find(row => row.id === created.transactionIds[0]).purchase_date, '2026-10-06');
});

test('deleting one installment preserves siblings and reverses only its debt', async t => {
  const f = await setup(t);
  const result = await save(f, draft(f));
  requireSuccess(await f.owner.client.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: { kind: 'delete_transaction', transactionId: result.transactionIds[0] } }));
  const remaining = await transactions(f);
  assert.equal(remaining.length, 2);
  assert.ok(remaining.every(row => row.installment_group_id === result.operationId && row.purchase_date === '2026-10-06'));
  assert.equal(requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id', f.card.id).single()).balance, 666.67);
});
