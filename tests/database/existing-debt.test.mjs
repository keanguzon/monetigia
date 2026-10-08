import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, installLatestMigrations, insertOperation, requireSuccess } from './helpers.mjs';

const migration = '202610080002_existing_debt_creation.sql';
before(installLatestMigrations);
after(installLatestMigrations);
async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
const account = overrides => ({ name: 'Credit', type: 'credit_card', currency: 'PHP', color: '#00aa99', icon: 'gcash.png', is_savings: false, interest_rate: 0, include_in_networth: true, display_order: 0, ...overrides });
const debt = overrides => ({ clientId: 'laptop', name: 'Laptop', mode: 'installments', amount: '1000.00', firstDueDate: '2026-01-31', count: 3, ...overrides });
const create = (f, items = [debt()], request = randomUUID(), details = account(), client = f.owner.client) => client.rpc('debt_account_create', { p_request_id: request, p_account: details, p_opening_debts: items });
async function ownerState(f) {
  const tables = ['accounts', 'goals', 'transactions', 'goal_allocation_events', 'financial_operations', 'debt_items', 'debt_due_rows'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, requireSuccess(await f.owner.client.from(table).select('*').order('id'))])));
}
async function rows(f, itemId) { return requireSuccess(await f.owner.client.from('debt_due_rows').select('*').eq('debt_item_id', itemId).order('ordinal')); }
const money = value => Number(value).toFixed(2);
const rejects = result => { assert.ok(result.error, 'request must reject'); };

test('atomic creation derives balance and preserves cash, goals and history; replay and migration retain records', async t => {
  const f = await setup(t), request = randomUUID();
  const beforeState = await ownerState(f);
  const items = [debt({ amount: '16000.00', count: 2 }), debt({ clientId: 'phone', name: 'Phone', amount: '3000.00', mode: 'single', count: 1 })];
  const result = requireSuccess(await create(f, items, request));
  assert.equal(result.replayed, false); assert.equal(result.debtItemIds.length, 2);
  const state = await ownerState(f);
  assert.equal(money(state.accounts.find(a => a.id === result.accountId).balance), '19000.00');
  assert.equal(state.accounts.length, beforeState.accounts.length + 1);
  for (const table of ['goals', 'transactions', 'goal_allocation_events']) assert.deepEqual(state[table], beforeState[table]);
  assert.deepEqual(state.accounts.find(a => a.id === f.owner.account.id), beforeState.accounts[0]);
  assert.deepEqual(result.debtItemIds.map(id => state.debt_items.find(i => i.id === id).client_id), ['laptop', 'phone']);
  assert.equal(state.financial_operations.length, 1); assert.equal(state.debt_due_rows.length, 3);
  assert.deepEqual(requireSuccess(await create(f, items, request)), { ...result, replayed: true });
  await applyMigration(migration);
  assert.deepEqual(await ownerState(f), state);
  const zero = requireSuccess(await create(f, []));
  assert.deepEqual(zero.debtItemIds, []);
  assert.equal(money(requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id', zero.accountId).single()).balance), '0.00');
});

test('concurrent identical requests create once; normalized replay and command conflicts retain original IDs', async t => {
  const f = await setup(t), request = randomUUID(), items = [debt(), debt({ clientId: '2' })];
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => create(f, items, request)));
  const results = outcomes.map(result => requireSuccess(result));
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(new Set(results.map(r => r.accountId)).size, 1);
  const state = await ownerState(f);
  assert.equal(state.accounts.length, 2); assert.equal(state.debt_items.length, 2); assert.equal(state.financial_operations.length, 1);
  assert.equal(requireSuccess(await create(f, items.map(d => ({ ...d, name: ` ${d.name} ` })), request, account({ name: ' Credit ' }))).replayed, true);
  assert.equal(requireSuccess(await create(f, items.map(d => ({ ...d, name: `\u00a0${d.name}\ufeff` })), request, account({ name: '\u00a0Credit\ufeff' }))).replayed, true);
  for (const changed of [[debt({ amount: '1001.00' }), items[1]], [debt({ name: 'Other' }), items[1]], [...items].reverse()]) assert.match((await create(f, changed, request)).error.message, /REQUEST_CONFLICT/);
  assert.match((await create(f, items, request, account({ name: 'Different' }))).error.message, /REQUEST_CONFLICT/);
  const other = requireSuccess(await create(f, items, request, account(), f.other.client)); assert.notEqual(other.accountId, results[0].accountId);
  const reserveId = randomUUID();
  requireSuccess(await f.owner.client.rpc('goal_finance_apply', { p_request_id: reserveId, p_command: { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '1.00' } }));
  assert.match((await create(f, items, reserveId)).error.message, /REQUEST_CONFLICT/);
  const incomplete = await insertOperation(f, f.owner.id, { command: { kind: 'create_debt_account', account: account(), openingDebts: [debt()] } });
  rejects(await create(f, [debt()], incomplete.request_id));
});

test('SQL schedules preserve exact centavos, entered overdue date and original day through month clamping', async t => {
  const f = await setup(t);
  const specs = [debt(), debt({ clientId: 'tiny', amount: '0.05' }), debt({ clientId: '24', count: 24 }), debt({ clientId: '600', amount: '6.00', count: 600 }), debt({ clientId: 'leap', firstDueDate: '2028-01-31' }), debt({ clientId: 'ancient', firstDueDate: '0001-01-31' })];
  const result = requireSuccess(await create(f, specs));
  const schedules = await Promise.all(result.debtItemIds.map(id => rows(f, id)));
  assert.deepEqual(schedules[0].map(r => money(r.original_amount)), ['333.33', '333.33', '333.34']);
  assert.deepEqual(schedules[1].map(r => money(r.original_amount)), ['0.01', '0.01', '0.03']);
  assert.deepEqual(schedules[0].map(r => r.due_date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(schedules[4].map(r => r.due_date), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual(schedules[5].map(r => r.due_date), ['0001-01-31', '0001-02-28', '0001-03-31']);
  assert.equal(money(schedules[2][23].original_amount), '41.82'); assert.equal(schedules[2][23].due_date, '2027-12-31');
  for (let i = 0; i < specs.length; i++) { assert.equal(schedules[i].length, specs[i].count); assert.equal(schedules[i].reduce((sum, row) => sum + Math.round(Number(row.original_amount) * 100), 0), Math.round(Number(specs[i].amount) * 100)); }
});

test('invalid typed JSON, date, range or allocation rejects the entire request including registry', async t => {
  const f = await setup(t), prior = await ownerState(f);
  const bad = [null, {}, 'wrong', [debt({ count: '2' })], [debt({ count: '2e1' })], [debt({ count: 2.5 })], [debt({ count: 0 })], [debt({ count: -1 })], [debt({ count: 601 })], [debt({ mode: 'single' })], [debt({ amount: 1000 })], [debt({ amount: '1.001' })], [debt({ amount: '0.00' })], [debt({ amount: '01.00' })], [debt({ amount: '10000000000000.00' })], [debt({ amount: '0.02' })], [debt({ firstDueDate: '2026-02-30' })], [debt({ firstDueDate: '0000-01-01' })], [debt({ firstDueDate: '9999-12-31' })], [debt({ name: 'x'.repeat(61) })], [debt({ name: ' ' })], [debt({ clientId: '' })], [debt({ clientId: 'x'.repeat(101) })], [debt({ extra: true })], [debt(), debt()], [debt({ amount: '9999999999999.99' }), debt({ clientId: '2', amount: '0.03' })], Array.from({ length: 101 }, (_, i) => debt({ clientId: `${i}` })), Array.from({ length: 11 }, (_, i) => debt({ clientId: `${i}`, count: 600 }))];
  for (const items of bad) { rejects(await create(f, items)); assert.deepEqual(await ownerState(f), prior); }
  for (const details of [null, [], account({ ownerId: f.other.id }), account({ name: ' ' }), account({ name: 'x'.repeat(61) }), account({ color: '#fff' }), account({ icon: '../x.png' }), account({ icon: 'x\\y.png' }), account({ icon: 'https://x.png' }), account({ icon: 'x.exe' }), account({ display_order: '0' }), account({ display_order: -1 }), account({ display_order: 1.5 }), account({ display_order: 2147483648 }), account({ include_in_networth: 'true' }), account({ include_in_networth: null }), account({ interest_rate: '0' }), account({ interest_rate: 1 }), account({ balance: '1.00' }), account({ is_savings: true }), account({ is_active: true }), account({ currency: 'USD' }), account({ type: 'cash' })]) { rejects(await create(f, [debt()], randomUUID(), details)); assert.deepEqual(await ownerState(f), prior); }
  rejects(await create(f, [debt(), debt({ clientId: 'bad', firstDueDate: '2027-02-29' })]));
  rejects(await create(f, [], null)); assert.deepEqual(await ownerState(f), prior);
  const max = requireSuccess(await create(f, [debt({ amount: '9999999999999.99', count: 1, firstDueDate: '9999-12-31' })]));
  const { queryAdmin } = await databaseRuntime();
  assert.equal((await queryAdmin('SELECT balance::text AS amount FROM public.accounts WHERE id=$1', [max.accountId]))[0].amount, '9999999999999.99');
});

test('owner select only, denied direct writes, composite FKs, delete history and final function grants', async t => {
  const f = await setup(t), result = requireSuccess(await create(f));
  const state = await ownerState(f), item = state.debt_items[0], row = state.debt_due_rows[0];
  for (const table of ['debt_items', 'debt_due_rows']) {
    assert.deepEqual(requireSuccess(await f.other.client.from(table).select('*').eq('user_id', f.owner.id)), []);
    rejects(await f.owner.client.from(table).insert(table === 'debt_items' ? { ...item, id: randomUUID(), client_id: 'new' } : { ...row, id: randomUUID(), ordinal: 4 }));
    rejects(await f.owner.client.from(table).update({ original_amount: 1 }).eq('id', table === 'debt_items' ? item.id : row.id));
    rejects(await f.owner.client.from(table).delete().eq('id', table === 'debt_items' ? item.id : row.id));
  }
  rejects(await f.admin.from('debt_items').insert({ ...item, id: randomUUID(), user_id: f.other.id, client_id: 'bad' }));
  rejects(await f.admin.from('debt_due_rows').insert({ ...row, id: randomUUID(), user_id: f.other.id }));
  rejects(await f.owner.client.from('accounts').delete().eq('id', result.accountId));
  for (const original_amount of [0, -1, '1.001', '10000000000000.00']) rejects(await f.admin.from('debt_due_rows').insert({ ...row, id: randomUUID(), ordinal: 4, original_amount }));
  const { queryAdmin, url, options } = await databaseRuntime();
  const grants = await queryAdmin("SELECT has_function_privilege('authenticated','public.debt_account_create(uuid,jsonb,jsonb)','EXECUTE') AS authenticated, has_function_privilege('anon','public.debt_account_create(uuid,jsonb,jsonb)','EXECUTE') AS anon, has_function_privilege('service_role','public.debt_account_create(uuid,jsonb,jsonb)','EXECUTE') AS service_role");
  assert.deepEqual(grants, [{ authenticated: true, anon: false, service_role: false }]);
  rejects(await create(f, [], randomUUID(), account(), f.admin));
  const anonymous = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  rejects(await create(f, [], randomUUID(), account(), anonymous));
  assert.deepEqual(await ownerState(f), state);
});

test('late due-row failure rolls back the account, items, earlier due rows and operation', async t => {
  const f = await setup(t), prior = await ownerState(f), request = randomUUID();
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`CREATE FUNCTION public.task4b_reject_due_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${f.owner.id}'::uuid AND NEW.ordinal=3 THEN RAISE EXCEPTION 'fixture_late_due_failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER task4b_reject_due_fixture BEFORE INSERT ON public.debt_due_rows FOR EACH ROW EXECUTE FUNCTION public.task4b_reject_due_fixture()`);
  try {
    assert.match((await create(f, [debt()], request)).error.message, /fixture_late_due_failure/);
    assert.deepEqual(await ownerState(f), prior);
  } finally {
    await queryAdmin('DROP TRIGGER task4b_reject_due_fixture ON public.debt_due_rows; DROP FUNCTION public.task4b_reject_due_fixture()');
  }
  assert.equal(requireSuccess(await create(f, [debt()], request)).replayed, false);
});

test('incomplete and missing stored results fail closed, missing owner profile rejects, ordinary deletion remains possible', async t => {
  const f = await setup(t), request = randomUUID(), result = requireSuccess(await create(f, [debt()], request));
  const operation = requireSuccess(await f.admin.from('financial_operations').select('*').eq('user_id', f.owner.id).eq('request_id', request).single());
  for (const values of [{ completed_at: null }, { result: null }, { result: {} }, { result: { ...result, debtItemIds: [] } }, { result: { ...result, accountId: f.other.account.id } }]) {
    requireSuccess(await f.admin.from('financial_operations').update({ completed_at: operation.completed_at, result: operation.result, ...values }).eq('id', operation.id));
    assert.match((await create(f, [debt()], request)).error.message, /INVALID_STATE/);
    assert.equal((await ownerState(f)).accounts.length, 2);
  }
  requireSuccess(await f.admin.from('financial_operations').update({ completed_at: operation.completed_at, result: operation.result }).eq('id', operation.id));
  assert.deepEqual(requireSuccess(await create(f, [debt()], request)), { ...result, replayed: true });
  requireSuccess(await f.owner.client.from('accounts').delete().eq('id', f.owner.account.id));
  assert.deepEqual(requireSuccess(await f.owner.client.from('accounts').select('id').eq('id', f.owner.account.id)), []);
  requireSuccess(await f.admin.from('users').delete().eq('id', f.other.id));
  assert.match((await create(f, [], randomUUID(), account(), f.other.client)).error.message, /NOT_ALLOWED/);
});

test('allocation accepts the 100-item and 6000-row boundary with exact SQL totals', async t => {
  const f = await setup(t);
  const items = Array.from({ length: 100 }, (_, i) => debt({ clientId: `${i}`, amount: '0.60', count: 60 }));
  const result = requireSuccess(await create(f, items));
  assert.equal(result.debtItemIds.length, 100);
  const { queryAdmin } = await databaseRuntime();
  const summary = await queryAdmin('SELECT count(*)::integer AS count,sum(original_amount)::text AS amount FROM public.debt_due_rows WHERE user_id=$1', [f.owner.id]);
  assert.deepEqual(summary, [{ count: 6000, amount: '60.00' }]);
});

test('final chronological state pins definer search paths, owner read policies, unconstrained money and client grants', async () => {
  await installLatestMigrations();
  const { queryAdmin } = await databaseRuntime();
  const [functionInfo] = await queryAdmin(`SELECT p.prosecdef,p.proconfig,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='debt_account_create'`);
  assert.equal(functionInfo.prosecdef, true); assert.ok(functionInfo.proconfig.includes('search_path=pg_catalog, public'));
  assert.equal(functionInfo.authenticated, true); assert.equal(functionInfo.anon, false); assert.equal(functionInfo.service, false); assert.equal(functionInfo.public_execute, false);
  for (const table of ['debt_items', 'debt_due_rows']) {
    const [permissions] = await queryAdmin(`SELECT relrowsecurity AS rls,
      has_table_privilege('authenticated',oid,'SELECT') AS select_allowed,
      has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') AS write_allowed,
      has_any_column_privilege('authenticated',oid,'INSERT,UPDATE') AS column_write_allowed,
      has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_allowed
      FROM pg_class WHERE oid='public.${table}'::regclass`);
    assert.deepEqual(permissions, { rls: true, select_allowed: true, write_allowed: false, column_write_allowed: false, anon_allowed: false });
    const policies = await queryAdmin(`SELECT cmd,roles::text AS roles FROM pg_policies WHERE schemaname='public' AND tablename='${table}'`);
    assert.deepEqual(policies, [{ cmd: 'SELECT', roles: '{authenticated}' }]);
    const [amountColumn] = await queryAdmin(`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='public.${table}'::regclass AND attname='original_amount'`);
    assert.equal(amountColumn.type, 'numeric');
  }
  for (const fn of ['public.debt_trim_name(text)', 'public.guard_financial_identity()']) {
    const [grants] = await queryAdmin(`SELECT has_function_privilege('authenticated','${fn}','EXECUTE') AS authenticated,has_function_privilege('anon','${fn}','EXECUTE') AS anon,has_function_privilege('service_role','${fn}','EXECUTE') AS service`);
    assert.deepEqual(grants, { authenticated: false, anon: false, service: false });
  }
  const [restore] = await queryAdmin("SELECT has_function_privilege('authenticated','public.goal_restore_archived(uuid,uuid)','EXECUTE') AS authenticated,has_function_privilege('service_role','public.goal_restore_archived(uuid,uuid)','EXECUTE') AS service");
  assert.deepEqual(restore, { authenticated: true, service: false });
});

test('final installed purchase boundary keeps the 12 cap and earliest centavo remainder', async t => {
  const f = await setup(t), card = requireSuccess(await create(f, []));
  const draft = { type: 'expense', accountId: card.accountId, transferToAccountId: null, categoryId: null, goalId: null,
    amount: '1000.00', description: 'Purchase compatibility', date: '2026-10-01',
    installments: { count: 3, firstDueDate: '2026-11-30' }, reservationMoves: [] };
  for (const count of [13, 24, 600]) rejects(await f.owner.client.rpc('goal_transaction_quote', { p_draft: { ...draft, installments: { ...draft.installments, count } } }));
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  const purchase = requireSuccess(await f.owner.client.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: { kind: 'transaction', draft }, p_quote: quote }));
  const transactions = requireSuccess(await f.owner.client.from('transactions').select('*').in('id', purchase.transactionIds).order('date'));
  assert.deepEqual(transactions.map(row => money(row.amount)), ['333.34', '333.33', '333.33']);
  assert.deepEqual(transactions.map(row => row.date), ['2026-11-30', '2026-12-30', '2027-01-30']);
  assert.equal((await ownerState(f)).debt_items.length, 0);
});
