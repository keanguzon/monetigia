import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

before(async () => {
  await applyMigration('202610060003_goal_reservation_operations.sql');
  const { admin } = await databaseRuntime();
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await admin.rpc('goal_finance_snapshot');
    if (result.error?.code !== 'PGRST202') {
      assert.equal(result.error?.message, 'NOT_ALLOWED');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('PostgREST did not reload goal_finance_snapshot');
});
after(async () => {
  for (const filename of ['202610060004_goal_transaction_operations.sql','202610060005_goal_lifecycle_operations.sql','202610060006_goal_write_guards.sql']) await applyMigration(filename);
});

async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}
const command = (f, kind = 'reserve', amount = '5000.00', overrides = {}) => ({
  kind, goalId: f.owner.goal.id, accountId: f.owner.account.id, amount, ...overrides,
});
const apply = (f, cmd, requestId = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', {
  p_request_id: requestId, p_command: cmd, p_quote: quote,
});
const snapshot = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
async function counts(f) {
  return Promise.all(['financial_operations', 'goal_allocation_events', 'transactions'].map(async table =>
    requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id))));
}
async function expectFailure(f, cmd, code, quote = null) {
  const before = await counts(f);
  const result = await apply(f, cmd, randomUUID(), quote);
  assert.equal(result.error?.message, code);
  assert.deepEqual(await counts(f), before);
}

test('reserve, release and reallocate preserve actual cash and create no transactions', async t => {
  const f = await setup(t);
  const goal2 = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '10000.00' }).select().single());
  const initialGoal = requireSuccess(await f.owner.client.from('goals').select('*').eq('id', f.owner.goal.id).single());
  requireSuccess(await apply(f, command(f)));
  let state = await snapshot(f);
  assert.deepEqual(state.wallets.find(w => w.accountId === f.owner.account.id), {
    accountId: f.owner.account.id, actual: '30000.00', reserved: '5000.00', available: '25000.00',
  });
  assert.equal((await counts(f))[2].length, 0);
  let goal = state.goals.find(g => g.id === f.owner.goal.id);
  assert.equal(goal.reserved, '5000.00');
  assert.equal(goal.spent, '0.00');
  assert.equal(goal.progressAmount, '5000.00');
  assert.equal(goal.remaining, '0.00');
  assert.equal(goal.progressPercent, 100);
  assert.deepEqual(goal.walletReservations, [{ accountId: f.owner.account.id, amount: '5000.00' }]);
  for (const field of ['target_amount', 'current_amount', 'allocation_per_cycle']) assert.match(goal[field], /^\d+\.\d{2}$/);
  requireSuccess(await apply(f, command(f, 'release', '2000.00')));
  assert.equal((await snapshot(f)).wallets[0].reserved, '3000.00');
  requireSuccess(await apply(f, command(f, 'reallocate', '1000.00', { destinationGoalId: goal2.id })));
  state = await snapshot(f);
  assert.deepEqual(state.wallets[0], { accountId: f.owner.account.id, actual: '30000.00', reserved: '3000.00', available: '27000.00' });
  assert.equal(state.goals.find(g => g.id === f.owner.goal.id).reserved, '2000.00');
  assert.equal(state.goals.find(g => g.id === goal2.id).reserved, '1000.00');
  const [operations, events, transactions] = await counts(f);
  assert.equal(operations.length, 3);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(e => e.kind).sort(), ['move_in', 'move_out', 'release', 'reserve']);
  assert.equal(transactions.length, 0);
  assert.deepEqual(requireSuccess(await f.owner.client.from('goals').select('*').eq('id', initialGoal.id).single()), initialGoal);
  assert.equal(requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id', f.owner.account.id).single()).balance, 30000);
});

test('foreign and missing account/goal references fail without writes', async t => {
  const f = await setup(t);
  for (const overrides of [{ accountId: f.other.account.id }, { goalId: f.other.goal.id }, { accountId: randomUUID() }, { goalId: randomUUID() }]) {
    await expectFailure(f, command(f, 'reserve', '1.00', overrides), 'NOT_ALLOWED');
  }
  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.other.goal.id }), 'NOT_ALLOWED');
});

test('credit, non-PHP and inactive wallets cannot be reserved', async t => {
  const f = await setup(t);
  for (const overrides of [{ type: 'credit_card' }, { currency: 'USD' }, { is_active: false }]) {
    const wallet = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: '30000.00', ...overrides }).select().single());
    await expectFailure(f, command(f, 'reserve', '1.00', { accountId: wallet.id }), 'NOT_ALLOWED');
  }
});

test('closed, archived and unreviewed goals reject allocation changes', async t => {
  const f = await setup(t);
  for (const [patch, error] of [[{ status: 'completed' }, 'INVALID_STATE'], [{ status: 'cancelled' }, 'INVALID_STATE'], [{ archived_at: '2026-10-06T00:00:00Z' }, 'INVALID_STATE'], [{ review_state: 'needs_review' }, 'NEEDS_REVIEW']]) {
    requireSuccess(await f.admin.from('goals').update({ status: 'active', archived_at: null, review_state: 'confirmed', ...patch }).eq('id', f.owner.goal.id));
    for (const kind of ['reserve', 'release', 'reallocate']) await expectFailure(f, command(f, kind, '1.00', kind === 'reallocate' ? { destinationGoalId: f.owner.goal.id } : {}), error);
  }
});

test('reallocation validates destination and rejects moving to the same goal', async t => {
  const f = await setup(t);
  requireSuccess(await apply(f, command(f)));
  const destination = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Closed', target_amount: '1000.00', status: 'completed' }).select().single());
  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'INVALID_STATE');
  requireSuccess(await f.admin.from('goals').update({ status: 'active', review_state: 'needs_review' }).eq('id', destination.id));
  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: destination.id }), 'NEEDS_REVIEW');
  await expectFailure(f, command(f, 'reallocate', '1.00', { destinationGoalId: f.owner.goal.id }), 'INVALID_STATE');
});

test('insufficient availability and excessive release or move roll back', async t => {
  const f = await setup(t);
  requireSuccess(await apply(f, command(f)));
  await expectFailure(f, command(f, 'reserve', '25000.01'), 'INSUFFICIENT_AVAILABLE');
  await expectFailure(f, command(f, 'release', '5000.01'), 'INSUFFICIENT_RESERVATION');
  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '1000.00' }).select().single());
  await expectFailure(f, command(f, 'reallocate', '5000.01', { destinationGoalId: destination.id }), 'INSUFFICIENT_RESERVATION');
});

test('money must be a positive canonical bounded decimal string and commands must be supported', async t => {
  const f = await setup(t);
  for (const amount of ['0.00', '-1.00', '1.001', '1', '01.00', 'NaN', '10000000000000.00', 1, null]) await expectFailure(f, command(f, 'reserve', amount), 'INVALID_STATE');
  for (const kind of ['transaction', 'close', 'reopen', 'archive', 'delete_transaction', 'adopt_legacy', 'unknown']) await expectFailure(f, { kind }, 'INVALID_STATE');
  await expectFailure(f, command(f), 'INVALID_STATE', {});
  await expectFailure(f, { ...command(f), unexpected: true }, 'INVALID_STATE');
});

test('concurrent over-allocation serializes and request replay retains the original result', async t => {
  const f = await setup(t);
  const requests = [randomUUID(), randomUUID()];
  const results = await Promise.all(requests.map(id => apply(f, command(f, 'reserve', '20000.00'), id)));
  assert.equal(results.filter(r => !r.error).length, 1);
  assert.equal(results.find(r => r.error).error.message, 'INSUFFICIENT_AVAILABLE');
  const winner = results.findIndex(r => !r.error);
  const original = requireSuccess(results[winner]);
  assert.equal(original.replayed, false);
  assert.deepEqual(original.transactionIds, []);
  assert.match(original.operationId, /^[0-9a-f-]{36}$/);
  const before = await counts(f);
  requireSuccess(await f.admin.from('goals').update({ status: 'completed' }).eq('id', f.owner.goal.id));
  assert.deepEqual(requireSuccess(await apply(f, command(f, 'reserve', '20000.00'), requests[winner])), { ...original, replayed: true });
  assert.equal((await apply(f, command(f, 'reserve', '1.00'), requests[winner])).error?.message, 'REQUEST_CONFLICT');
  assert.deepEqual(await counts(f), before);
  assert.equal((await snapshot(f)).wallets[0].reserved, '20000.00');
});

test('concurrent duplicate requests append a single event', async t => {
  const f = await setup(t);
  const request = randomUUID();
  const results = await Promise.all([apply(f, command(f), request), apply(f, command(f), request)]);
  const values = results.map(r => requireSuccess(r));
  assert.equal(values[0].operationId, values[1].operationId);
  assert.deepEqual(values.map(v => v.replayed).sort(), [false, true]);
  const [operations, events] = await counts(f);
  assert.equal(operations.length, 1);
  assert.equal(events.length, 1);
});

test('snapshot is owned, read-only, retains archived metadata and separates legacy tags', async t => {
  const f = await setup(t);
  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review', current_amount: '999.99' }).eq('id', f.owner.goal.id));
  const archived = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Historical name', target_amount: '5000.00', status: 'cancelled', archived_at: '2026-10-06T00:00:00Z' }).select().single());
  for (const [type, amount] of [['expense', '123.45'], ['transfer', '76.55'], ['income', '500.00']]) {
    requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, goal_id: f.owner.goal.id, type, amount, date: '2026-10-06' }));
  }
  const before = await counts(f);
  const row = requireSuccess(await f.admin.from('goals').select('*').eq('id', f.owner.goal.id).single());
  const state = await snapshot(f);
  assert.equal(state.goals.length, 2);
  assert.equal(state.wallets.length, 1);
  assert.equal(state.goals.find(g => g.id === archived.id).name, 'Historical name');
  const legacy = state.goals.find(g => g.id === f.owner.goal.id);
  assert.equal(legacy.review_state, 'needs_review');
  assert.equal(legacy.legacyTaggedAmount, '200.00');
  assert.equal(legacy.reserved, '0.00');
  assert.equal(legacy.spent, '0.00');
  assert.equal(legacy.progressAmount, '0.00');
  assert.equal(legacy.remaining, '5000.00');
  assert.equal(legacy.progressPercent, 0);
  assert.equal(state.goals.find(g => g.id === archived.id).legacyTaggedAmount, null);
  assert.deepEqual(await counts(f), before);
  assert.deepEqual(requireSuccess(await f.admin.from('goals').select('*').eq('id', row.id).single()), row);
});

test('anonymous and identity-less callers cannot execute finance RPCs', async t => {
  const f = await setup(t);
  const { url, options } = await databaseRuntime();
  const anon = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  assert.equal((await anon.rpc('goal_finance_snapshot')).error?.code, '42501');
  assert.equal((await anon.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: command(f) })).error?.code, '42501');
  assert.equal((await f.admin.rpc('goal_finance_snapshot')).error?.message, 'NOT_ALLOWED');
});

test('RPCs are security definers with pinned search paths', async () => {
  const { queryAdmin } = await databaseRuntime();
  const rows = await queryAdmin("SELECT proname,prosecdef,proconfig FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public' AND proname IN ('goal_finance_snapshot','goal_finance_apply') ORDER BY proname;");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.prosecdef, true);
    assert.ok(row.proconfig.includes('search_path=pg_catalog, public'));
  }
});

test('a failure after the first reallocation event rolls back the operation and all events', async t => {
  const f = await setup(t);
  requireSuccess(await apply(f, command(f)));
  const destination = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: '1000.00' }).select().single());
  const { queryAdmin } = await databaseRuntime();
  const name = `reservation_rollback_${randomUUID().replaceAll('-', '')}`;
  await queryAdmin(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORCED_FAILURE'; END $$;
    CREATE TRIGGER ${name} BEFORE INSERT ON public.goal_allocation_events FOR EACH ROW
    WHEN (NEW.user_id='${f.owner.id}'::uuid AND NEW.kind='move_in') EXECUTE FUNCTION public.${name}();`);
  try {
    const state = await snapshot(f);
    await expectFailure(f, command(f, 'reallocate', '1000.00', { destinationGoalId: destination.id }), 'FORCED_FAILURE');
    assert.deepEqual(await snapshot(f), state);
  } finally {
    await queryAdmin(`DROP TRIGGER ${name} ON public.goal_allocation_events; DROP FUNCTION public.${name}();`);
  }
});

test('reservations remain exact and release is scoped to the chosen wallet', async t => {
  const f = await setup(t);
  const second = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Bank', type: 'bank', balance: '100.01' }).select().single());
  requireSuccess(await apply(f, command(f, 'reserve', '0.01')));
  requireSuccess(await apply(f, command(f, 'reserve', '99.99', { accountId: second.id })));
  let state = await snapshot(f);
  const goal = state.goals.find(g => g.id === f.owner.goal.id);
  assert.equal(goal.reserved, '100.00');
  assert.equal(goal.remaining, '4900.00');
  assert.equal(goal.progressPercent, 2);
  assert.deepEqual(goal.walletReservations, [
    { accountId: f.owner.account.id, amount: '0.01' }, { accountId: second.id, amount: '99.99' },
  ].sort((a, b) => a.accountId.localeCompare(b.accountId)));
  assert.deepEqual(state.wallets.find(w => w.accountId === second.id), { accountId: second.id, actual: '100.01', reserved: '99.99', available: '0.02' });
  await expectFailure(f, command(f, 'release', '0.02'), 'INSUFFICIENT_RESERVATION');
  requireSuccess(await apply(f, command(f, 'release', '0.01')));
  state = await snapshot(f);
  assert.equal(state.goals[0].reserved, '99.99');
  assert.deepEqual(state.goals[0].walletReservations, [{ accountId: second.id, amount: '99.99' }]);
});
