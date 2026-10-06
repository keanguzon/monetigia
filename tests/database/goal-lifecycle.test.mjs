import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, eventInput, insertOperation, requireSuccess } from './helpers.mjs';

before(async () => {
  await applyMigration('202610060004_goal_transaction_operations.sql');
  try { await applyMigration('202610060005_goal_lifecycle_operations.sql'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
});
async function setup(t) {
  const f = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(f));
  return f;
}
const apply = (f, command, id = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', { p_request_id: id, p_command: command, p_quote: quote });
const snap = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
const goal = (s, id) => s.goals.find(g => g.goalId === id);
const wallet = (s, id) => s.wallets.find(w => w.accountId === id);
const reserve = async (f, amount, goalId = f.owner.goal.id, accountId = f.owner.account.id) => requireSuccess(await apply(f, { kind: 'reserve', goalId, accountId, amount }));
const close = (f, status = 'completed', leftovers = { mode: 'release' }, id = f.owner.goal.id) => apply(f, { kind: 'close', goalId: id, status, leftovers });
const remove = (f, id, request = randomUUID()) => apply(f, { kind: 'delete_transaction', transactionId: id }, request);
async function save(f, overrides = {}) {
  const draft = { type: 'expense', accountId: f.owner.account.id, transferToAccountId: null, categoryId: null, goalId: null, amount: '2000.00', description: null, date: '2026-10-01', installments: null, reservationMoves: [], ...overrides };
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  return requireSuccess(await apply(f, { kind: 'transaction', draft }, randomUUID(), quote));
}
async function rows(f) {
  return Promise.all(['goals', 'accounts', 'financial_operations', 'goal_allocation_events', 'transactions'].map(async table => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
}
const account = async (f, name = 'Bank', type = 'bank', balance = '0.00') => requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name, type, balance }).select().single());

test('Date closes below target with explicit release, preserving actual spending and replay', async t => {
  const f = await setup(t);
  await reserve(f, '3000.00');
  await save(f, { goalId: f.owner.goal.id });
  const initial = await rows(f);
  assert.equal((await close(f, 'completed', null)).error?.message, 'INVALID_STATE');
  assert.deepEqual(await rows(f), initial);
  const command = { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: { mode: 'release' } };
  const request = randomUUID();
  const result = requireSuccess(await apply(f, command, request));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.status, 'completed'); assert.equal(g.is_completed, true);
  assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '2000.00');
  assert.equal(wallet(s, f.owner.account.id).actual, '28000.00');
  assert.ok(g.completed_at);
  const completed = await rows(f);
  assert.deepEqual(requireSuccess(await apply(f, command, request)), { ...result, replayed: true });
  assert.deepEqual(await rows(f), completed);
  assert.equal((await apply(f, { ...command, status: 'cancelled' }, request)).error?.message, 'REQUEST_CONFLICT');
});
test('Laptop reserve and spend 30000 completes with 30000 progress, never double counted', async t => {
  const f = await setup(t);
  await reserve(f, '30000.00');
  await save(f, { amount: '30000.00', goalId: f.owner.goal.id });
  requireSuccess(await close(f, 'completed', null));
  const g = goal(await snap(f), f.owner.goal.id);
  assert.equal(g.progressAmount, '30000.00'); assert.equal(g.spent, '30000.00'); assert.equal(g.reserved, '0.00');
});
test('leftovers move across each backing wallet without changing actual or total reserved', async t => {
  const f = await setup(t), dst = await account(f, 'Bank', 'bank', '2000.00');
  const target = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 10000 }).select().single());
  await reserve(f, '3000.00'); await reserve(f, '2000.00', f.owner.goal.id, dst.id);
  const before = await snap(f);
  requireSuccess(await close(f, 'cancelled', { mode: 'move', goalId: target.id }));
  const s = await snap(f);
  assert.deepEqual(s.wallets, before.wallets);
  assert.deepEqual(goal(s, target.id).walletReservations, goal(before, f.owner.goal.id).walletReservations);
  assert.equal(goal(s, target.id).reserved, '5000.00');
  assert.equal(goal(s, f.owner.goal.id).status, 'cancelled');
});
test('cancel, reopen, and archive retain spending; archive requires closed zero reservations', async t => {
  const f = await setup(t);
  await reserve(f, '3000.00'); await save(f, { goalId: f.owner.goal.id });
  assert.equal((await apply(f, { kind: 'archive', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
  requireSuccess(await close(f, 'cancelled'));
  assert.equal(goal(await snap(f), f.owner.goal.id).is_completed, false);
  requireSuccess(await apply(f, { kind: 'reopen', goalId: f.owner.goal.id }));
  let g = goal(await snap(f), f.owner.goal.id);
  assert.equal(g.status, 'active'); assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '2000.00');
  requireSuccess(await close(f));
  requireSuccess(await apply(f, { kind: 'archive', goalId: f.owner.goal.id }));
  g = goal(await snap(f), f.owner.goal.id);
  assert.ok(g.archived_at); assert.equal(g.status, 'completed'); assert.equal(g.spent, '2000.00');
  assert.equal((await apply(f, { kind: 'reopen', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
});
test('deletion restores active reservations and retains source event and transaction UUID', async t => {
  const f = await setup(t); await reserve(f, '3000.00');
  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
  const originals = (await rows(f))[3];
  const request = randomUUID(); const result = requireSuccess(await remove(f, tx, request));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.reserved, '3000.00'); assert.equal(g.spent, '0.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
  const after = await rows(f);
  for (const original of originals) assert.deepEqual(after[3].find(e => e.id === original.id), original);
  const reversal = after[3].find(e => e.kind === 'reversal');
  assert.equal(reversal.transaction_id, tx); assert.equal(reversal.reversal_of, originals.find(e => e.kind === 'spend').id);
  assert.equal(after[4].length, 0);
  assert.deepEqual(requireSuccess(await remove(f, tx, request)), { ...result, replayed: true });
  assert.deepEqual(await rows(f), after);
  assert.equal((await remove(f, tx)).error?.message, 'NOT_ALLOWED');
});
test('deletion preserves closed goal state', async t => {
  const f = await setup(t); await reserve(f, '3000.00');
  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
  requireSuccess(await close(f));
  requireSuccess(await apply(f, { kind: 'archive', goalId: f.owner.goal.id }));
  const closed = goal(await snap(f), f.owner.goal.id);
  requireSuccess(await remove(f, tx));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.status, 'completed'); assert.equal(g.reserved, '0.00'); assert.equal(g.spent, '0.00');
  assert.equal(g.completed_at, closed.completed_at); assert.equal(g.archived_at, closed.archived_at); assert.equal(g.is_completed, true);
  assert.equal(wallet(s, f.owner.account.id).available, '30000.00');
});
for (const closed of [false, true]) test(`ordinary expense release reversal respects ${closed ? 'closed' : 'active'} goal`, async t => {
  const f = await setup(t); await reserve(f, '5000.00');
  const tx = (await save(f, { amount: '28000.00' })).transactionIds[0];
  if (closed) requireSuccess(await close(f));
  requireSuccess(await remove(f, tx));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.reserved, closed ? '0.00' : '5000.00'); assert.equal(g.spent, '0.00');
  assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
  const reversal = (await rows(f))[3].find(e => e.kind === 'reversal');
  if (closed) {
    assert.equal(reversal, undefined);
    assert.ok((await rows(f))[2].find(o => o.command.kind === 'delete_transaction' && o.command.transactionId === tx));
  } else { assert.ok(reversal); assert.equal(reversal.reserved_delta, 3000); }
});
test('cash transfer reversal restores carried allocations to source', async t => {
  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
  requireSuccess(await remove(f, tx));
  const s = await snap(f);
  assert.deepEqual(goal(s, f.owner.goal.id).walletReservations, [{ accountId: f.owner.account.id, amount: '5000.00' }]);
  assert.equal(wallet(s, dst.id).actual, '0.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
});
test('transfer reversal fails atomically after downstream spending or reallocation', async t => {
  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
  await save(f, { accountId: dst.id, goalId: f.owner.goal.id, amount: '1000.00' });
  const initial = await rows(f);
  assert.equal((await remove(f, tx)).error?.message, 'INSUFFICIENT_ACTUAL');
  assert.deepEqual(await rows(f), initial);
});
test('transfer reversal requires the carried reservation even when actual money remains', async t => {
  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
  requireSuccess(await apply(f, { kind: 'release', goalId: f.owner.goal.id, accountId: dst.id, amount: '1000.00' }));
  const initial = await rows(f);
  assert.equal((await remove(f, tx)).error?.message, 'INSUFFICIENT_RESERVATION');
  assert.deepEqual(await rows(f), initial);
});
test('closed carried transfer reverses wallet money without restoring reservations', async t => {
  const f = await setup(t), dst = await account(f); await reserve(f, '5000.00');
  const tx = (await save(f, { type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }] })).transactionIds[0];
  requireSuccess(await close(f));
  requireSuccess(await remove(f, tx));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.status, 'completed'); assert.equal(g.reserved, '0.00');
  assert.equal(wallet(s, f.owner.account.id).available, '30000.00'); assert.equal(wallet(s, dst.id).actual, '0.00');
  const history = (await rows(f))[3];
  assert.equal(history.filter(e => e.transaction_id === tx).length, 2);
  assert.equal(history.filter(e => e.kind === 'reversal').length, 0);
});
test('debt goal payment reversal restores cash reservation and card debt once', async t => {
  const f = await setup(t), card = await account(f, 'Card', 'credit_card', '2000.00');
  requireSuccess(await f.admin.from('goals').update({ category: 'debt' }).eq('id', f.owner.goal.id));
  requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: card.id, type: 'expense', amount: 2000, date: '2026-10-01' }));
  await reserve(f, '2000.00');
  const tx = (await save(f, { type: 'transfer', goalId: f.owner.goal.id, transferToAccountId: card.id })).transactionIds[0];
  requireSuccess(await remove(f, tx));
  const s = await snap(f), g = goal(s, f.owner.goal.id);
  assert.equal(g.reserved, '2000.00'); assert.equal(g.spent, '0.00');
  assert.equal(wallet(s, card.id).actual, '2000.00'); assert.equal(wallet(s, f.owner.account.id).actual, '30000.00');
});
test('a late deletion failure rolls back operation, allocation reversals, balances and transaction', async t => {
  const f = await setup(t); await reserve(f, '3000.00');
  const tx = (await save(f, { goalId: f.owner.goal.id })).transactionIds[0];
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`CREATE OR REPLACE FUNCTION public.task5_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='${tx}'::uuid THEN RAISE EXCEPTION 'task5_late_failure'; END IF; RETURN OLD; END $$;
    CREATE TRIGGER task5_reject_delete BEFORE DELETE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.task5_reject_delete()`);
  try {
    const initial = await rows(f);
    assert.equal((await remove(f, tx)).error?.message, 'task5_late_failure');
    assert.deepEqual(await rows(f), initial);
  } finally { await queryAdmin('DROP TRIGGER task5_reject_delete ON public.transactions; DROP FUNCTION public.task5_reject_delete()'); }
});
test('income reversal cannot overdraw reservations and gives corrective instructions', async t => {
  const f = await setup(t);
  const tx = (await save(f, { type: 'income', amount: '5000.00' })).transactionIds[0];
  await reserve(f, '35000.00'); const initial = await rows(f);
  const result = await remove(f, tx);
  assert.equal(result.error?.message, 'INSUFFICIENT_AVAILABLE');
  assert.match(result.error?.hint ?? '', /release|corrective/i);
  assert.deepEqual(await rows(f), initial);
});
test('deleting one scheduled installment reverses only its row amount', async t => {
  const f = await setup(t), card = await account(f, 'Card', 'credit_card');
  const result = await save(f, { accountId: card.id, amount: '1000.01', installments: { count: 3 } });
  requireSuccess(await remove(f, result.transactionIds[0]));
  const remaining = (await rows(f))[4];
  assert.equal(remaining.length, 2); assert.deepEqual(remaining.map(r => r.id).sort(), result.transactionIds.slice(1).sort());
  assert.equal(wallet(await snap(f), card.id).actual, '666.67');
});
test('spent-only legacy original deletion never creates a reservation', async t => {
  const f = await setup(t), tx = (await save(f)).transactionIds[0], op = await insertOperation(f);
  requireSuccess(await f.admin.from('goal_allocation_events').insert(eventInput(f, op, { kind: 'legacy_spent', reserved_delta: '0.00', spent_delta: '2000.00', transaction_id: tx })));
  requireSuccess(await remove(f, tx));
  const g = goal(await snap(f), f.owner.goal.id);
  assert.equal(g.spent, '0.00'); assert.equal(g.reserved, '0.00');
});
test('lifecycle rejects foreign ownership, review state, extra fields, quotes, and unsafe archive', async t => {
  const f = await setup(t), initial = await rows(f);
  assert.equal((await close(f, 'completed', { mode: 'release' }, f.other.goal.id)).error?.message, 'NOT_ALLOWED');
  assert.equal((await remove(f, randomUUID())).error?.message, 'NOT_ALLOWED');
  assert.equal((await apply(f, { kind: 'reopen', goalId: f.owner.goal.id, extra: true })).error?.message, 'INVALID_STATE');
  assert.equal((await apply(f, { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: null }, randomUUID(), {})).error?.message, 'INVALID_STATE');
  assert.deepEqual(await rows(f), initial);
  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review' }).eq('id', f.owner.goal.id));
  assert.equal((await close(f)).error?.message, 'NEEDS_REVIEW');
  requireSuccess(await f.admin.from('goals').update({ review_state: 'confirmed', status: 'completed' }).eq('id', f.owner.goal.id));
  const op = await insertOperation(f);
  requireSuccess(await f.admin.from('goal_allocation_events').insert(eventInput(f, op)));
  assert.equal((await apply(f, { kind: 'archive', goalId: f.owner.goal.id })).error?.message, 'INVALID_STATE');
});
test('snapshot never mirrors the legacy completion boolean and helper lanes deny direct execution', async t => {
  const f = await setup(t);
  requireSuccess(await f.admin.from('goals').update({ is_completed: true }).eq('id', f.owner.goal.id));
  const initial = await rows(f);
  assert.equal(goal(await snap(f), f.owner.goal.id).status, 'active');
  assert.deepEqual(await rows(f), initial);
  for (const name of ['goal_reservation_apply', 'goal_transaction_apply']) {
    const result = await f.owner.client.rpc(name, { p_request_id: randomUUID(), p_command: { kind: 'reserve' }, p_quote: null });
    assert.ok(result.error); assert.match(result.error.message, /permission denied/i);
  }
  const command = { kind: 'close', goalId: f.owner.goal.id, status: 'cancelled', leftovers: null };
  const request = randomUUID();
  const results = await Promise.all([apply(f, command, request), apply(f, command, request)]);
  const values = results.map(r => requireSuccess(r));
  assert.equal(values[0].operationId, values[1].operationId);
  assert.equal(values.filter(r => r.replayed).length, 1);
});
