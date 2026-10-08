import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, installLatestMigrations, requireSuccess } from './helpers.mjs';

const migration = '202610080003_debt_settlements.sql';
before(installLatestMigrations);
after(installLatestMigrations);

async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}

const account = overrides => ({ name: 'Credit', type: 'credit_card', currency: 'PHP', color: '#00aa99', icon: null,
  is_savings: false, interest_rate: 0, include_in_networth: true, display_order: 0, ...overrides });
const opening = overrides => ({ clientId: 'laptop', name: 'Laptop', mode: 'installments', amount: '1000.00',
  firstDueDate: '2026-01-31', count: 2, ...overrides });
const createDebt = (fixture, items = [], details = account()) => createDebtWithClient(fixture.owner.client, items, details);
const createDebtWithClient = (client, items = [], details = account()) => client.rpc('debt_account_create', {
  p_request_id: randomUUID(), p_account: details, p_opening_debts: items,
});
const apply = (fixture, command, request = randomUUID(), quote = null) => fixture.owner.client.rpc('goal_finance_apply', {
  p_request_id: request, p_command: command, p_quote: quote,
});

async function transact(fixture, draft) {
  const quote = requireSuccess(await fixture.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  return requireSuccess(await apply(fixture, { kind: 'transaction', draft }, randomUUID(), quote));
}

async function privateState(fixture, accountId) {
  const { queryAdmin } = await databaseRuntime();
  const [row] = await queryAdmin(`SELECT public.debt_account_state('${fixture.owner.id}'::uuid,'${accountId}'::uuid) AS state`);
  return row.state;
}

function purchaseDraft(accountId, overrides = {}) {
  return { type: 'expense', accountId, transferToAccountId: null, categoryId: null, goalId: null,
    amount: '200.00', description: 'Laptop purchase', date: '2026-09-01', installments: null, reservationMoves: [], ...overrides };
}

async function payment(fixture, cardId, amount, date = '2026-09-01') {
  return transact(fixture, { type: 'transfer', accountId: fixture.owner.account.id, transferToAccountId: cardId,
    categoryId: null, goalId: null, amount, description: 'Card payment', date, installments: null, reservationMoves: [] });
}

test('private debt state returns complete opening rows with the exact 6a account and row shapes', async t => {
  const fixture = await setup(t);
  const created = requireSuccess(await createDebt(fixture, [opening()]));
  const state = await privateState(fixture, created.accountId);

  assert.deepEqual(Object.keys(state).sort(), ['account', 'rows']);
  assert.deepEqual(Object.keys(state.account).sort(), [
    'accountId', 'fingerprint', 'reconciliation', 'reconciliationDelta', 'totalOutstanding', 'undatedOutstanding',
  ]);
  assert.equal(state.account.accountId, created.accountId);
  assert.equal(state.account.totalOutstanding, '1000.00');
  assert.equal(state.account.undatedOutstanding, '0.00');
  assert.equal(state.account.reconciliation, 'balanced');
  assert.equal(state.account.reconciliationDelta, '0.00');
  assert.match(state.account.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(state.rows.length, 2);
  assert.deepEqual(Object.keys(state.rows[0]).sort(), [
    'accountId', 'correctedAmount', 'dueDate', 'groupId', 'id', 'name', 'ordinal', 'originalAmount',
    'paidAmount', 'remainingAmount', 'source', 'transactionId',
  ]);
  assert.deepEqual(state.rows.map(row => [row.source, row.groupId, row.transactionId, row.dueDate,
    row.originalAmount, row.paidAmount, row.correctedAmount, row.remainingAmount, row.ordinal, row.name]), [
    ['opening', created.debtItemIds[0], null, '2026-01-31', '500.00', '0.00', '0.00', '500.00', 1, 'Laptop'],
    ['opening', created.debtItemIds[0], null, '2026-02-28', '500.00', '0.00', '0.00', '500.00', 2, 'Laptop'],
  ]);
  const tableRows = requireSuccess(await fixture.owner.client.from('debt_due_rows').select('id').eq('debt_item_id', created.debtItemIds[0]).order('ordinal'));
  assert.deepEqual(state.rows.map(row => row.id), tableRows.map(row => row.id));
});

test('purchase adapter preserves transaction IDs, proven groups, operation ordinals and schedule dates', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await createDebt(fixture));
  const result = await transact(fixture, purchaseDraft(card.accountId, {
    amount: '1000.00', installments: { count: 3, firstDueDate: '2026-09-15' },
  }));
  const purchases = requireSuccess(await fixture.owner.client.from('transactions').select('*').in('id', result.transactionIds).order('date'));
  const state = await privateState(fixture, card.accountId);

  assert.equal(state.account.totalOutstanding, '1000.00');
  assert.equal(state.account.reconciliation, 'balanced');
  assert.deepEqual(state.rows.map(row => [row.id, row.groupId, row.transactionId, row.source, row.dueDate,
    row.originalAmount, row.ordinal, row.name]), purchases.map((row, index) => [row.id,
    row.installment_group_id, row.id, 'purchase', row.date, Number(row.amount).toFixed(2), index + 1, row.description]));
  assert.ok(state.rows.every(row => row.groupId === result.operationId));
  assert.equal(state.rows.reduce((sum, row) => sum + Math.round(Number(row.remainingAmount) * 100), 0), 100000);
});

test('proven historical payments allocate once to obligations that existed at payment time', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await createDebt(fixture));
  const first = await transact(fixture, purchaseDraft(card.accountId, { amount: '500.00', description: 'First purchase' }));
  const paid = await payment(fixture, card.accountId, '200.00');
  const later = await transact(fixture, purchaseDraft(card.accountId, { amount: '100.00', description: 'Later purchase', date: '2026-10-01' }));

  await applyMigration(migration);
  const state = await privateState(fixture, card.accountId);
  const history = requireSuccess(await fixture.owner.client.from('debt_settlement_events').select('*').order('id'));
  assert.equal(history.length, 1);
  assert.equal(history[0].kind, 'settlement');
  assert.equal(history[0].amount, 200);
  assert.equal(history[0].account_id, card.accountId);
  assert.equal(history[0].payment_operation_id, paid.operationId);
  assert.equal(history[0].payment_transaction_id, paid.transactionIds[0]);
  assert.equal(history[0].purchase_transaction_id, first.transactionIds[0]);
  assert.equal(history[0].operation_id, paid.operationId);
  assert.deepEqual(state.rows.map(row => [row.transactionId, row.paidAmount, row.remainingAmount]), [
    [first.transactionIds[0], '200.00', '300.00'],
    [later.transactionIds[0], '0.00', '100.00'],
  ]);
  assert.equal(state.account.totalOutstanding, '400.00');
  assert.equal(state.account.reconciliation, 'balanced');

  const fingerprint = state.account.fingerprint;
  await applyMigration(migration);
  const afterReinstall = await privateState(fixture, card.accountId);
  const afterHistory = requireSuccess(await fixture.owner.client.from('debt_settlement_events').select('*').order('id'));
  assert.deepEqual(afterHistory, history);
  assert.equal(afterReinstall.account.fingerprint, fingerprint);
});

test('legacy principal remains truthful undated residual beside proven purchases and payments', async t => {
  const fixture = await setup(t);
  const legacy = requireSuccess(await fixture.admin.from('accounts').insert({ user_id: fixture.owner.id,
    ...account({ name: 'Imported legacy balance', balance: '5000.00' }) }).select().single());
  const pureLegacy = requireSuccess(await fixture.admin.from('accounts').insert({ user_id: fixture.owner.id,
    ...account({ name: 'Legacy only', balance: '5000.00' }) }).select().single());
  await transact(fixture, purchaseDraft(legacy.id, { amount: '2000.00' }));
  await payment(fixture, legacy.id, '400.00', '2026-09-01');

  await applyMigration(migration);
  const mixed = await privateState(fixture, legacy.id);
  const residual = await privateState(fixture, pureLegacy.id);
  assert.deepEqual([mixed.account.totalOutstanding, mixed.rows[0].remainingAmount,
    mixed.account.undatedOutstanding, mixed.account.reconciliation, mixed.account.reconciliationDelta],
  ['6600.00', '1600.00', '5000.00', 'balanced', '0.00']);
  assert.deepEqual([residual.account.totalOutstanding, residual.account.undatedOutstanding,
    residual.account.reconciliation, residual.account.reconciliationDelta, residual.rows.length],
  ['5000.00', '5000.00', 'balanced', '0.00', 0]);
});

test('unproven earlier expense blocks guessed historical allocation to a later purchase', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await createDebt(fixture));
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`UPDATE public.accounts SET balance=100.00 WHERE user_id='${fixture.owner.id}'::uuid AND id='${card.accountId}'::uuid`);
  await queryAdmin(`INSERT INTO public.transactions(user_id,account_id,transfer_to_account_id,category_id,goal_id,type,amount,description,date)
    VALUES('${fixture.owner.id}'::uuid,'${card.accountId}'::uuid,NULL,NULL,NULL,'expense',100.00,'Imported expense','2026-01-01')`);
  const purchase = await transact(fixture, purchaseDraft(card.accountId, { amount: '500.00', date: '2026-09-01' }));
  await payment(fixture, card.accountId, '200.00', '2026-09-01');

  await applyMigration(migration);
  const state = await privateState(fixture, card.accountId);
  const events = requireSuccess(await fixture.owner.client.from('debt_settlement_events').select('*'));
  const knownPurchase = state.rows.find(row => row.transactionId === purchase.transactionIds[0]);
  assert.deepEqual(events, []);
  assert.deepEqual([knownPurchase.paidAmount, state.account.reconciliation], ['0.00', 'needs_review']);
});

test('multiple operation claims leave historical payment unallocated and account reviewed', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await createDebt(fixture, [opening({ mode: 'single', count: 1 })]));
  await transact(fixture, purchaseDraft(card.accountId, { amount: '100.00' }));
  const paid = await payment(fixture, card.accountId, '100.00');
  const duplicateOperationId = randomUUID();
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`INSERT INTO public.financial_operations(id,user_id,request_id,command_hash,command,result,completed_at)
    VALUES('${duplicateOperationId}'::uuid,'${fixture.owner.id}'::uuid,'${randomUUID()}'::uuid,repeat('a',64),
      jsonb_build_object('kind','transaction','draft',jsonb_build_object('type','transfer','accountId','${fixture.owner.account.id}',
        'transferToAccountId','${card.accountId}','amount','100.00')),
      jsonb_build_object('operationId','${duplicateOperationId}','transactionIds',jsonb_build_array('${paid.transactionIds[0]}'),'replayed',false),now())`);

  await applyMigration(migration);
  const state = await privateState(fixture, card.accountId);
  const events = requireSuccess(await fixture.owner.client.from('debt_settlement_events').select('*'));
  assert.deepEqual(events, []);
  assert.deepEqual([state.rows[0].paidAmount, state.account.reconciliation], ['0.00', 'needs_review']);
});

test('unproven purchase group metadata falls back to its own ID and ordinal one', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await createDebt(fixture));
  const first = await transact(fixture, purchaseDraft(card.accountId, { amount: '100.00' }));
  const second = await transact(fixture, purchaseDraft(card.accountId, { amount: '200.00' }));
  const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`UPDATE public.transactions SET installment_group_id='${second.operationId}'::uuid
    WHERE user_id='${fixture.owner.id}'::uuid AND id='${first.transactionIds[0]}'::uuid`);

  const state = await privateState(fixture, card.accountId);
  const row = state.rows.find(candidate => candidate.transactionId === first.transactionIds[0]);
  assert.deepEqual([row.groupId, row.ordinal, state.account.reconciliation],
    [first.transactionIds[0], 1, 'needs_review']);
});

test('unsupported and incomplete account history stays visible as needs_review with exact nonnegative totals', async t => {
  const fixture = await setup(t);
  const unsupported = requireSuccess(await fixture.admin.from('accounts').insert({ user_id: fixture.owner.id, ...account({
    name: 'Imported USD', currency: 'USD', balance: '90.00', is_active: false,
  }) }).select().single());
  const zero = requireSuccess(await createDebt(fixture));

  const review = await privateState(fixture, unsupported.id);
  const empty = await privateState(fixture, zero.accountId);
  assert.equal(review.account.totalOutstanding, '90.00');
  assert.ok(Number(review.account.undatedOutstanding) >= 0);
  assert.equal(review.account.reconciliation, 'needs_review');
  assert.equal(review.account.reconciliationDelta, '90.00');
  assert.equal(review.rows.length, 0);
  assert.equal(empty.account.totalOutstanding, '0.00');
  assert.equal(empty.account.undatedOutstanding, '0.00');
  assert.equal(empty.account.reconciliation, 'balanced');
  assert.deepEqual(empty.rows, []);
  assert.notEqual(review.account.fingerprint, empty.account.fingerprint);
});

test('event tables are owner-readable and append-only; helpers stay private and wrong-owner targets fail', async t => {
  const fixture = await setup(t);
  const ownerCard = requireSuccess(await createDebt(fixture, [opening()]));
  const otherCard = requireSuccess(await createDebtWithClient(fixture.other.client, [opening()]));
  const ownerRows = requireSuccess(await fixture.owner.client.from('debt_due_rows').select('*').eq('debt_item_id', ownerCard.debtItemIds[0]).order('ordinal'));
  const otherDue = requireSuccess(await fixture.admin.from('debt_due_rows').select('*').eq('user_id', fixture.other.id).eq('debt_item_id', otherCard.debtItemIds[0]).limit(1).single());
  await transact(fixture, purchaseDraft(ownerCard.accountId, { amount: '100.00' }));
  await payment(fixture, ownerCard.accountId, '1.00');
  await applyMigration(migration);
  const secondPayment = await payment(fixture, ownerCard.accountId, '2.00');
  const { queryAdmin } = await databaseRuntime();

  const ownerRead = requireSuccess(await fixture.owner.client.from('debt_settlement_events').select('*'));
  const otherRead = requireSuccess(await fixture.other.client.from('debt_settlement_events').select('*').eq('user_id', fixture.owner.id));
  assert.equal(ownerRead.length, 1);
  assert.deepEqual(otherRead, []);
  for (const table of ['debt_settlement_events', 'debt_correction_events']) {
    const grants = (await queryAdmin(`SELECT relrowsecurity AS rls,
      has_table_privilege('authenticated',oid,'SELECT') AS select_allowed,
      has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') AS write_allowed,
      has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_allowed,
      has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE') AS service_allowed
      FROM pg_class WHERE oid='public.${table}'::regclass`))[0];
    assert.deepEqual(grants, { rls: true, select_allowed: true, write_allowed: false, anon_allowed: false, service_allowed: false });
    assert.ok((await queryAdmin(`SELECT cmd FROM pg_policies WHERE schemaname='public' AND tablename='${table}'`)).some(row => row.cmd === 'SELECT'));
  }
  const helperGrants = (await queryAdmin(`SELECT p.prosecdef,p.proconfig,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='debt_account_state'`))[0];
  assert.equal(helperGrants.prosecdef, true);
  assert.ok(helperGrants.proconfig.includes('search_path=pg_catalog, public'));
  assert.deepEqual([helperGrants.authenticated, helperGrants.anon, helperGrants.service, helperGrants.public_execute], [false, false, false, false]);
  assert.ok((await queryAdmin(`SELECT pg_get_functiondef('public.guard_financial_identity()'::regprocedure) AS body`))[0].body.includes('debt_settlement_events'));
  assert.ok((await queryAdmin(`SELECT pg_get_functiondef('public.guard_financial_identity()'::regprocedure) AS body`))[0].body.includes('debt_correction_events'));

  const denied = await fixture.owner.client.from('debt_correction_events').insert({});
  assert.ok(denied.error);
  const helperDenied = await fixture.owner.client.rpc('debt_account_state', { p_owner: fixture.owner.id, p_account_id: ownerCard.accountId });
  assert.ok(helperDenied.error);
  await assert.rejects(() => queryAdmin(`UPDATE public.debt_settlement_events SET amount=amount WHERE id='${ownerRead[0].id}'::uuid`));
  await assert.rejects(() => queryAdmin(`DELETE FROM public.debt_settlement_events WHERE id='${ownerRead[0].id}'::uuid`));
  const wrongOwner = `INSERT INTO public.debt_settlement_events(user_id,account_id,operation_id,amount,kind,payment_operation_id,payment_transaction_id,opening_due_row_id)
    VALUES('${fixture.owner.id}'::uuid,'${ownerCard.accountId}'::uuid,'${secondPayment.operationId}'::uuid,0.01,'settlement','${secondPayment.operationId}'::uuid,'${secondPayment.transactionIds[0]}'::uuid,'${otherDue.id}'::uuid)`;
  await assert.rejects(() => queryAdmin(wrongOwner));
  assert.notEqual(otherCard.accountId, ownerCard.accountId);
});
