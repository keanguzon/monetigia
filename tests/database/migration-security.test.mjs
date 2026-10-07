import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

before(async () => {
  for (const name of ['004_goal_transaction_operations', '005_goal_lifecycle_operations', '006_goal_write_guards']) {
    try { await applyMigration(`202610060${name}.sql`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
});
async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
const apply = (f, command, request = randomUUID()) => f.owner.client.rpc('goal_finance_apply', { p_request_id: request, p_command: command });
const snap = async f => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
const totals = (f, s) => s.goals.find(g => g.goalId === f.owner.goal.id);
const wallet = (f, s) => s.wallets.find(w => w.accountId === f.owner.account.id);
async function legacy(f, category = 'tech') {
  requireSuccess(await f.admin.from('goals').update({ review_state: 'needs_review', current_amount: 2000, category }).eq('id', f.owner.goal.id));
}
async function tx(f, overrides = {}) {
  return requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, goal_id: f.owner.goal.id, type: 'expense', amount: 2000, date: '2026-10-01', ...overrides }).select().single());
}
const command = (f, overrides = {}) => ({ kind: 'adopt_legacy', goalId: f.owner.goal.id, status: 'active', reservations: [], spentTransactionIds: [], ...overrides });

test('legacy review keeps old tags and balances; importing cash spending never charges twice and deletion restores no reservation', async t => {
  const f = await setup(t); await legacy(f); const old = await tx(f);
  const before = await snap(f);
  assert.equal(totals(f, before).reserved, '0.00');
  const request = randomUUID(), c = command(f, { spentTransactionIds: [old.id] });
  const result = requireSuccess(await apply(f, c, request));
  const after = await snap(f);
  assert.equal(wallet(f, after).actual, wallet(f, before).actual);
  assert.equal(totals(f, after).spent, '2000.00');
  assert.equal(requireSuccess(await f.owner.client.from('transactions').select('*').eq('id', old.id).single()).goal_id, old.goal_id);
  assert.equal(requireSuccess(await f.owner.client.from('goals').select('*').eq('id', f.owner.goal.id).single()).current_amount, 2000);
  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
  assert.equal((await apply(f, c)).error?.message, 'INVALID_STATE');
  requireSuccess(await apply(f, { kind: 'delete_transaction', transactionId: old.id }));
  const afterDeletion = await snap(f);
  assert.equal(totals(f, afterDeletion).spent, '0.00');
  assert.equal(totals(f, afterDeletion).reserved, '0.00');
  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
});

test('review uses current available cash, allows empty history and blocks completed reservations, foreign IDs and repeated imports', async t => {
  const f = await setup(t); await legacy(f);
  const old = await tx(f);
  const foreign = await tx(f, { user_id: f.other.id, account_id: f.other.account.id, goal_id: f.other.goal.id });
  assert.equal((await apply(f, command(f, { goalId: f.other.goal.id }))).error?.message, 'NOT_ALLOWED');
  assert.equal((await apply(f, command(f, { spentTransactionIds: [foreign.id] }))).error?.message, 'NOT_ALLOWED');
  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '30000.01' }] }))).error?.message, 'INSUFFICIENT_AVAILABLE');
  assert.equal((await apply(f, command(f, { status: 'completed', reservations: [{ accountId: f.owner.account.id, amount: '1.00' }] }))).error?.message, 'INVALID_STATE');
  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.other.account.id, amount: '1.00' }] }))).error?.message, 'NOT_ALLOWED');
  assert.equal((await apply(f, command(f, { spentTransactionIds: [randomUUID()] }))).error?.message, 'NOT_ALLOWED');
  requireSuccess(await apply(f, command(f, { status: 'completed', spentTransactionIds: [old.id] })));
  assert.equal(totals(f, await snap(f)).reserved, '0.00');
  const otherGoal = requireSuccess(await f.admin.from('goals').insert({ user_id: f.owner.id, name: 'Other', target_amount: 5000, review_state: 'needs_review' }).select().single());
  assert.equal((await apply(f, command(f, { goalId: otherGoal.id, spentTransactionIds: [old.id] }))).error?.message, 'INVALID_STATE');
  requireSuccess(await apply(f, command(f, { goalId: otherGoal.id })));
});

test('only cash expenses and cash-to-card debt payments qualify, with exact cents and transactional rollback', async t => {
  const f = await setup(t); await legacy(f, 'debt');
  const card = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Card', type: 'credit_card', balance: 2000 }).select().single());
  for (const overrides of [{ type: 'credit_card' }, { currency: 'USD' }, { is_active: false }]) {
    const ineligible = requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Ineligible', type: 'cash', balance: 2000, ...overrides }).select().single());
    assert.equal((await apply(f, command(f, { reservations: [{ accountId: ineligible.id, amount: '0.01' }] }))).error?.message, 'INVALID_STATE');
  }
  const alreadyCounted = await tx(f);
  assert.equal((await apply(f, command(f, { spentTransactionIds: [alreadyCounted.id, alreadyCounted.id] }))).error?.message, 'INVALID_STATE');
  for (const overrides of [{ type: 'income' }, { type: 'transfer', transfer_to_account_id: f.owner.account.id }, { account_id: card.id }]) {
    const invalid = await tx(f, overrides);
    assert.equal((await apply(f, command(f, { spentTransactionIds: [invalid.id] }))).error?.message, 'INVALID_STATE');
  }
  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '1.001' }] }))).error?.message, 'INVALID_STATE');
  const payment = await tx(f, { type: 'transfer', transfer_to_account_id: card.id });
  requireSuccess(await apply(f, command(f, { spentTransactionIds: [payment.id], reservations: [{ accountId: f.owner.account.id, amount: '0.01' }] })));
  assert.equal(totals(f, await snap(f)).reserved, '0.01');
  assert.equal(totals(f, await snap(f)).spent, '2000.00');
});

test('authenticated direct finance writes fail while safe metadata, targets, owner reads and opening wallets work', async t => {
  const f = await setup(t);
  const inserted = await tx(f);
  for (const action of [
    f.owner.client.from('transactions').insert({ user_id: f.owner.id, account_id: f.owner.account.id, type: 'expense', amount: 1, date: '2026-10-01' }),
    f.owner.client.from('transactions').update({ amount: 1 }).eq('id', inserted.id),
    f.owner.client.from('transactions').delete().eq('id', inserted.id),
    f.owner.client.from('financial_operations').insert({ user_id: f.owner.id, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: {} }),
    f.owner.client.from('goal_allocation_events').insert({}),
  ]) assert.equal((await action).error?.code, '42501');
  for (const values of [{ balance: 1 }, { type: 'credit_card' }, { currency: 'USD' }, { user_id: f.other.id }, { id: randomUUID() }, { is_active: false }]) {
    assert.ok((await f.owner.client.from('accounts').update(values).eq('id', f.owner.account.id)).error);
  }
  for (const values of [{ status: 'completed' }, { is_completed: true }, { current_amount: 1 }, { archived_at: new Date().toISOString() }, { review_state: 'needs_review' }, { user_id: f.other.id }, { id: randomUUID() }]) {
    assert.ok((await f.owner.client.from('goals').update(values).eq('id', f.owner.goal.id)).error);
  }
  requireSuccess(await f.owner.client.from('accounts').update({ name: 'Renamed', color: '#123456', icon: 'wallet', display_order: 3, interest_rate: 1, include_in_networth: false }).eq('id', f.owner.account.id));
  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
  const operation = requireSuccess(await f.owner.client.from('financial_operations').select('id').eq('user_id', f.owner.id).single());
  const event = requireSuccess(await f.owner.client.from('goal_allocation_events').select('id').eq('user_id', f.owner.id).single());
  for (const [table, id, patch] of [['financial_operations', operation.id, { result: {} }], ['goal_allocation_events', event.id, { reserved_delta: 0 }]]) {
    assert.equal((await f.owner.client.from(table).update(patch).eq('id', id)).error?.code, '42501');
    assert.equal((await f.owner.client.from(table).delete().eq('id', id)).error?.code, '42501');
  }
  requireSuccess(await f.owner.client.from('goals').update({ target_amount: 2000 }).eq('id', f.owner.goal.id));
  assert.equal(totals(f, await snap(f)).progressPercent, 50);
  assert.equal(wallet(f, await snap(f)).actual, '30000.00');
  assert.ok((await f.owner.client.from('accounts').delete().eq('id', f.owner.account.id)).error);
  assert.ok((await f.owner.client.from('goals').delete().eq('id', f.owner.goal.id)).error);
  const empty = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'New', type: 'cash', balance: 10, currency: 'PHP' }).select().single());
  requireSuccess(await f.owner.client.from('accounts').delete().eq('id', empty.id));
  assert.deepEqual(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', f.other.account.id)), []);
  assert.ok((await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Forged', target_amount: 1, status: 'completed' })).error);
});

test('standalone guards reapply safely and revoke a known disposable old definer deletion RPC', async t => {
  const f = await setup(t), old = await tx(f), { queryAdmin } = await databaseRuntime();
  await queryAdmin(`CREATE FUNCTION public.task10_fixture_old_delete(p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM public.transactions WHERE id=p_id $$; GRANT EXECUTE ON FUNCTION public.task10_fixture_old_delete(uuid) TO authenticated`);
  try {
    await queryAdmin("NOTIFY pgrst, 'reload schema'");
    for (let attempt = 0; attempt < 20; attempt++) {
      const visible = await f.owner.client.rpc('task10_fixture_old_delete', { p_id: randomUUID() });
      if (!visible.error) break;
      if (attempt === 19 || visible.error.code !== 'PGRST202') requireSuccess(visible);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await applyMigration('202610060006_goal_write_guards.sql');
    await applyMigration('202610060006_goal_write_guards.sql');
    const grants = await queryAdmin("SELECT to_regprocedure('public.task10_fixture_old_delete(uuid)') IS NOT NULL AS present,has_function_privilege('authenticated','public.task10_fixture_old_delete(uuid)','EXECUTE') AS authenticated,has_function_privilege('anon','public.task10_fixture_old_delete(uuid)','EXECUTE') AS anon,has_function_privilege('service_role','public.task10_fixture_old_delete(uuid)','EXECUTE') AS service");
    assert.deepEqual(grants, [{ present: true, authenticated: false, anon: false, service: false }]);
    const blocked = await f.owner.client.rpc('task10_fixture_old_delete', { p_id: old.id });
    assert.ok(['42501','PGRST202'].includes(blocked.error?.code));
    assert.equal(requireSuccess(await f.owner.client.from('transactions').select('id').eq('id', old.id)).length, 1);
    requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '0.01' }));
  } finally { await queryAdmin('DROP FUNCTION public.task10_fixture_old_delete(uuid)'); }
});

test('review serializes competing reservations and duplicate request replay without overbooking', async t => {
  const f = await setup(t); await legacy(f);
  const next = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 30000 }).select().single());
  const outcomes = await Promise.all([
    apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '20000.00' }] })),
    apply(f, { kind: 'reserve', goalId: next.id, accountId: f.owner.account.id, amount: '20000.00' }),
  ]);
  assert.equal(outcomes.filter(result => !result.error).length, 1);
  assert.equal(outcomes.find(result => result.error)?.error.message, 'INSUFFICIENT_AVAILABLE');
  assert.equal(wallet(f, await snap(f)).reserved, '20000.00');
  const duplicate = await setup(t); await legacy(duplicate);
  const request = randomUUID(), c = command(duplicate, { reservations: [{ accountId: duplicate.owner.account.id, amount: '0.01' }] });
  const results = (await Promise.all([apply(duplicate, c, request), apply(duplicate, c, request)])).map(result => requireSuccess(result));
  assert.equal(results[0].operationId, results[1].operationId);
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.equal(totals(duplicate, await snap(duplicate)).reserved, '0.01');
});

test('a late import failure rolls back review state, operations, reservations, spending and actual balances', async t => {
  const f = await setup(t); await legacy(f); const old = await tx(f), { queryAdmin } = await databaseRuntime();
  const before = await snap(f);
  const rows = async () => Promise.all(['goals','accounts','transactions','financial_operations','goal_allocation_events'].map(async table => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
  const initial = await rows();
  await queryAdmin(`CREATE FUNCTION public.task10_reject_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.goal_id='${f.owner.goal.id}'::uuid AND NEW.kind='legacy_spent' THEN RAISE EXCEPTION 'late_import_failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER task10_reject_import BEFORE INSERT ON public.goal_allocation_events FOR EACH ROW EXECUTE FUNCTION public.task10_reject_import()`);
  try {
    assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '1000.00' }], spentTransactionIds: [old.id] }))).error?.message, 'late_import_failure');
    assert.deepEqual(await rows(), initial); assert.deepEqual(await snap(f), before);
  } finally { await queryAdmin('DROP TRIGGER task10_reject_import ON public.goal_allocation_events; DROP FUNCTION public.task10_reject_import()'); }
});

test('fake savings are not auto-reversed and cannot reserve money absent from the current wallet', async t => {
  const f = await setup(t); await legacy(f); const fake = await tx(f);
  requireSuccess(await f.admin.from('accounts').update({ balance: 0 }).eq('id', f.owner.account.id));
  assert.equal((await apply(f, command(f, { reservations: [{ accountId: f.owner.account.id, amount: '0.01' }] }))).error?.message, 'INSUFFICIENT_AVAILABLE');
  requireSuccess(await apply(f, command(f)));
  assert.equal(wallet(f, await snap(f)).actual, '0.00');
  assert.equal(totals(f, await snap(f)).spent, '0.00');
  assert.equal(requireSuccess(await f.owner.client.from('transactions').select('id').eq('id', fake.id)).length, 1);
});

test('ordered migrations and reproducible schema preserve imported history and finish with secure grants', async t => {
  const f = await setup(t); await legacy(f); const old = await tx(f);
  const c = command(f, { spentTransactionIds: [old.id] }), request = randomUUID();
  const result = requireSuccess(await apply(f, c, request));
  for (let pass = 0; pass < 2; pass++) for (const name of ['001_runtime_baseline','002_goal_allocation_ledger','003_goal_reservation_operations','004_goal_transaction_operations','005_goal_lifecycle_operations','006_goal_write_guards']) await applyMigration(`202610060${name}.sql`);
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(await readFile(new URL('../../supabase/schema.sql', import.meta.url), 'utf8'));
  await queryAdmin("NOTIFY pgrst, 'reload schema'");
  assert.deepEqual(requireSuccess(await apply(f, c, request)), { ...result, replayed: true });
  assert.equal(totals(f, await snap(f)).spent, '2000.00');
  assert.ok((await f.owner.client.from('accounts').update({ balance: 1 }).eq('id', f.owner.account.id)).error);
  const denied = await queryAdmin("SELECT has_table_privilege('authenticated','public.transactions','INSERT') AS tx,has_column_privilege('authenticated','public.accounts','balance','UPDATE') AS balance,has_column_privilege('authenticated','public.goals','status','UPDATE') AS lifecycle,has_function_privilege('authenticated','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS helper");
  assert.deepEqual(denied, [{ tx: false, balance: false, lifecycle: false, helper: false }]);
});

test('authenticated opening balances reject nonfinite and invalid domain values while finite zero and positive wallets work', async t => {
  const f = await setup(t), initial = await snap(f);
  for (const balance of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
    const result = await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Invalid opening', type: 'cash', balance });
    assert.ok(result.error, `Opening balance ${balance} must be denied`);
    assert.deepEqual(await snap(f), initial);
  }
  for (const balance of ['0.00','0.01','9999999999999.99']) {
    const row = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Finite opening', type: 'cash', balance }).select().single());
    assert.equal((await snap(f)).wallets.find(w => w.accountId === row.id).actual, balance);
  }
});

test('authenticated goal creation rejects nonfinite target and allocation money without poisoning the finance snapshot', async t => {
  const f = await setup(t), initial = await snap(f);
  for (const field of ['target_amount','allocation_per_cycle']) for (const amount of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
    const result = await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Invalid goal money', target_amount: '5000.00', allocation_per_cycle: '0.00', [field]: amount });
    assert.ok(result.error, `${field} ${amount} must be denied`);
    assert.deepEqual(await snap(f), initial);
  }
  const row = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Finite goal', target_amount: '9999999999999.99', allocation_per_cycle: '0.00' }).select().single());
  assert.equal((await snap(f)).goals.find(g => g.goalId === row.id).target_amount, '9999999999999.99');
});

test('authenticated goal money edits reject nonfinite values, preserve valid derived target edits and leave untouched legacy invalid amounts intact', async t => {
  const f = await setup(t);
  requireSuccess(await apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1000.00' }));
  const initial = await snap(f);
  for (const field of ['target_amount','allocation_per_cycle']) for (const amount of ['NaN','Infinity','-Infinity','not-a-number','-0.01','10000000000000.00',null]) {
    const result = await f.owner.client.from('goals').update({ [field]: amount }).eq('id', f.owner.goal.id);
    assert.ok(result.error, `${field} ${amount} must be denied`);
    assert.deepEqual(await snap(f), initial);
  }
  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '2000.00', allocation_per_cycle: '0.01' }).eq('id', f.owner.goal.id));
  const after = await snap(f);
  assert.equal(totals(f, after).progressPercent, 50);
  assert.equal(totals(f, after).reserved, '1000.00');
  assert.equal(wallet(f, after).actual, '30000.00');
  requireSuccess(await f.admin.from('goals').update({ allocation_per_cycle: 'NaN' }).eq('id', f.owner.goal.id));
  await applyMigration('202610060006_goal_write_guards.sql');
  requireSuccess(await f.owner.client.from('goals').update({ target_amount: '3000.00', name: 'Legacy reviewed separately' }).eq('id', f.owner.goal.id));
  const { queryAdmin } = await databaseRuntime();
  const old = await queryAdmin(`SELECT allocation_per_cycle::text AS allocation,target_amount::text AS target FROM public.goals WHERE id='${f.owner.goal.id}'::uuid`);
  assert.deepEqual(old, [{ allocation: 'NaN', target: '3000.00' }]);
});
