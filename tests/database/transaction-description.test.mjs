import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanupFinanceFixture, createFinanceFixture, databaseRuntime, installLatestMigrations, requireSuccess } from './helpers.mjs';

before(installLatestMigrations);
after(installLatestMigrations);

test('metadata edits preserve finance, reject stale/category ownership, and replay once', async t => {
  const fixture = await setup(t);
  const purchase = await transact(fixture, fixture.owner.account.id);
  const id = purchase.transactionIds[0];
  const category = requireSuccess(await fixture.admin.from('categories').insert({ user_id: fixture.owner.id, name: 'Metadata QA', type: 'expense' }).select().single());
  const before = requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot'));
  const command = { ...edit({ transactionId: id }, 'Updated metadata', 'Original purchase'), metadata: { date: '2026-10-09', categoryId: category.id, expectedDate: '2026-10-01', expectedCategoryId: null } };
  const request = randomUUID();
  requireSuccess(await apply(fixture, command, request));
  assert.equal(requireSuccess(await apply(fixture, command, request)).replayed, true);
  const row = requireSuccess(await readTransaction(fixture, id));
  assert.equal(row.date, '2026-10-09'); assert.equal(row.category_id, category.id);
  assert.equal(row.amount, 90); assert.equal(row.type, 'expense'); assert.equal(row.account_id, fixture.owner.account.id);
  assert.deepEqual(requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot')), before);
  assert.equal((await apply(fixture, command)).error?.message, 'STALE_QUOTE');
  const foreign = requireSuccess(await fixture.admin.from('categories').insert({ user_id: fixture.other.id, name: 'Other owner', type: 'expense' }).select().single());
  const invalid = { ...command, expectedDescription: 'Updated metadata', metadata: { ...command.metadata, expectedDate: '2026-10-09', expectedCategoryId: category.id, categoryId: foreign.id } };
  assert.equal((await apply(fixture, invalid)).error?.message, 'NOT_ALLOWED');
  assert.equal((await apply(fixture, { ...invalid, amount: '1.00' })).error?.message, 'INVALID_STATE');
});

test('group metadata edits purchase date without moving installment due dates', async t => {
  const fixture = await setup(t);
  const credit = requireSuccess(await creditAccount(fixture));
  const purchase = await transact(fixture, credit.id, { installments: { count: 3, firstDueDate: '2026-11-01' } });
  const before = requireSuccess(await fixture.admin.from('transactions').select('*').in('id', purchase.transactionIds).order('id'));
  const command = { ...edit({ groupId: purchase.operationId }, 'Group metadata', 'Original purchase'), metadata: { date: '2026-10-09', categoryId: null, expectedDate: '2026-10-01', expectedCategoryId: null } };
  requireSuccess(await apply(fixture, command));
  const after = requireSuccess(await fixture.admin.from('transactions').select('*').in('id', purchase.transactionIds).order('id'));
  assert.deepEqual(after.map(row => [row.id,row.date,row.amount,row.account_id]), before.map(row => [row.id,row.date,row.amount,row.account_id]));
  assert.ok(after.every(row => row.purchase_date === '2026-10-09'));
  requireSuccess(await fixture.owner.client.rpc('debt_snapshot'));
});

async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}

const apply = (fixture, command, requestId = randomUUID(), quote = null) => fixture.owner.client.rpc('goal_finance_apply', {
  p_request_id: requestId, p_command: command, p_quote: quote,
});
const edit = (target, description, expectedDescription) => ({
  kind: 'edit_transaction_description', transactionId: target.transactionId ?? null,
  groupId: target.groupId ?? null, description, expectedDescription,
});

async function transact(fixture, accountId, overrides = {}) {
  const draft = { type: 'expense', accountId, transferToAccountId: null, categoryId: null, goalId: null,
    amount: '90.00', description: 'Original purchase', date: '2026-10-01', installments: null, reservationMoves: [], ...overrides };
  const quote = requireSuccess(await fixture.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  return requireSuccess(await apply(fixture, { kind: 'transaction', draft }, randomUUID(), quote));
}

const readTransaction = (fixture, id) => fixture.admin.from('transactions').select('*').eq('id', id).maybeSingle();
const readOperation = (fixture, id) => fixture.admin.from('financial_operations').select('*').eq('id', id).single();
const creditAccount = (fixture, balance = '0.00') => fixture.admin.from('accounts').insert({
  user_id: fixture.owner.id, name: 'Credit', type: 'credit_card', currency: 'PHP', balance,
}).select().single();

test('ordinary edits replay once, preserve finance state, and replay before later edits or deletion', async t => {
  const fixture = await setup(t);
  const purchase = await transact(fixture, fixture.owner.account.id, { amount: '125.00', description: 'Original' });
  const originalTransaction = requireSuccess(await readTransaction(fixture, purchase.transactionIds[0]));
  const originalOperation = requireSuccess(await readOperation(fixture, purchase.operationId));
  const beforeFinance = requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot'));
  const requestId = randomUUID();
  const command = edit({ transactionId: originalTransaction.id }, '  New title\t', 'Original');

  const concurrent = await Promise.all([apply(fixture, command, requestId), apply(fixture, command, requestId)]);
  const results = concurrent.map(result => requireSuccess(result));
  assert.equal(results.filter(result => result.replayed).length, 1);
  assert.deepEqual(results.map(result => result.transactionIds), [[originalTransaction.id], [originalTransaction.id]]);
  let edited = requireSuccess(await readTransaction(fixture, originalTransaction.id));
  assert.equal(edited.description, 'New title');
  const afterFinance = requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot'));
  assert.deepEqual(afterFinance, beforeFinance);
  const preserved = requireSuccess(await readOperation(fixture, purchase.operationId));
  assert.deepEqual([preserved.command, preserved.result], [originalOperation.command, originalOperation.result]);
  assert.deepEqual([edited.amount, edited.account_id, edited.goal_id, edited.category_id, edited.type, edited.date],
    [originalTransaction.amount, originalTransaction.account_id, originalTransaction.goal_id, originalTransaction.category_id,
      originalTransaction.type, originalTransaction.date]);

  const income = await transact(fixture, fixture.owner.account.id,
    { type: 'income', amount: '12.00', description: 'Interest' });
  const beforeIncomeEdit = requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot'));
  requireSuccess(await apply(fixture, edit({ transactionId: income.transactionIds[0] }, 'Interest earned', 'Interest')));
  assert.deepEqual(requireSuccess(await fixture.owner.client.rpc('goal_finance_snapshot')), beforeIncomeEdit);

  requireSuccess(await apply(fixture, edit({ transactionId: originalTransaction.id }, 'Latest title', 'New title')));
  const replay = requireSuccess(await apply(fixture, command, requestId));
  assert.equal(replay.replayed, true);
  edited = requireSuccess(await readTransaction(fixture, originalTransaction.id));
  assert.equal(edited.description, 'Latest title');
  assert.equal((await apply(fixture, edit({ transactionId: originalTransaction.id }, 'Conflicting title', 'Latest title'), requestId)).error?.message,
    'REQUEST_CONFLICT');

  requireSuccess(await apply(fixture, { kind: 'delete_transaction', transactionId: originalTransaction.id }));
  assert.equal(requireSuccess(await readTransaction(fixture, originalTransaction.id)), null);
  assert.equal(requireSuccess(await apply(fixture, command, requestId)).replayed, true);
  assert.equal(requireSuccess(await readTransaction(fixture, originalTransaction.id)), null);
});

test('SQL validation trims the shared ASCII set, counts code points, and rejects stale, malformed, and foreign targets', async t => {
  const fixture = await setup(t);
  const purchase = await transact(fixture, fixture.owner.account.id, { description: 'Boundary' });
  const id = purchase.transactionIds[0];
  const blank = '\t\r\n\v\f  ';
  requireSuccess(await apply(fixture, edit({ transactionId: id }, blank, 'Boundary')));
  assert.equal(requireSuccess(await readTransaction(fixture, id)).description, null);

  const fiveHundred = '😀'.repeat(500);
  requireSuccess(await apply(fixture, edit({ transactionId: id }, fiveHundred, null)));
  assert.equal(Array.from(requireSuccess(await readTransaction(fixture, id)).description).length, 500);
  const oversizedRequest = randomUUID();
  assert.equal((await apply(fixture, edit({ transactionId: id }, '😀'.repeat(501), fiveHundred), oversizedRequest)).error?.message,
    'INVALID_STATE');
  assert.deepEqual(requireSuccess(await fixture.admin.from('financial_operations').select('id').eq('request_id', oversizedRequest)), []);
  assert.equal(requireSuccess(await readTransaction(fixture, id)).description, fiveHundred);

  const staleRequest = randomUUID();
  assert.equal((await apply(fixture, edit({ transactionId: id }, 'No change', 'Outdated'), staleRequest)).error?.message, 'STALE_QUOTE');
  assert.deepEqual(requireSuccess(await fixture.admin.from('financial_operations').select('id').eq('request_id', staleRequest)), []);
  for (const malformed of [
    { ...edit({ transactionId: id }, 'Bad', fiveHundred), extra: true },
    edit({ transactionId: id, groupId: purchase.operationId }, 'Bad', fiveHundred),
    edit({}, 'Bad', fiveHundred),
  ]) {
    assert.equal((await apply(fixture, malformed)).error?.message, 'INVALID_STATE');
  }
  assert.equal((await fixture.other.client.rpc('goal_finance_apply', {
    p_request_id: randomUUID(), p_command: edit({ transactionId: id }, 'Private', fiveHundred), p_quote: null,
  })).error?.message, 'NOT_ALLOWED');
});

test('group edits preserve original ordinals, isolate equal titles, support null bases, and reject broken proof atomically', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await creditAccount(fixture));
  const first = await transact(fixture, card.id, {
    description: 'Equal title', installments: { count: 3, firstDueDate: '2026-11-01' },
  });
  const second = await transact(fixture, card.id, {
    description: 'Equal title', installments: { count: 3, firstDueDate: '2026-12-01' },
  });
  requireSuccess(await apply(fixture, { kind: 'delete_transaction', transactionId: first.transactionIds[1] }));
  const groupResult = requireSuccess(await apply(fixture, edit({ groupId: first.operationId }, 'Renamed', 'Equal title')));
  assert.deepEqual(groupResult.transactionIds, [...first.transactionIds.filter((_, index) => index !== 1)].sort());
  assert.equal((await apply(fixture, edit({ groupId: first.operationId }, 'Stale replacement', 'Equal title'))).error?.message,
    'STALE_QUOTE');
  for (const [index, id] of first.transactionIds.entries()) {
    const row = requireSuccess(await readTransaction(fixture, id));
    if (index === 1) assert.equal(row, null);
    else assert.equal(row.description, `Renamed (Installment ${index + 1}/3)`);
  }
  for (const [index, id] of second.transactionIds.entries()) {
    assert.equal(requireSuccess(await readTransaction(fixture, id)).description, `Equal title (Installment ${index + 1}/3)`);
  }

  const nullBase = await transact(fixture, card.id, {
    description: null, installments: { count: 2, firstDueDate: '2027-01-01' },
  });
  requireSuccess(await apply(fixture, edit({ groupId: nullBase.operationId }, null, null)));
  assert.deepEqual(await Promise.all(nullBase.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), [' (Installment 1/2)', ' (Installment 2/2)']);
  requireSuccess(await apply(fixture, edit({ groupId: nullBase.operationId }, 'Named later', null)));
  assert.deepEqual(await Promise.all(nullBase.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), [
    'Named later (Installment 1/2)', 'Named later (Installment 2/2)',
  ]);

  const broken = await transact(fixture, card.id, {
    description: 'Consistent', installments: { count: 2, firstDueDate: '2027-02-01' },
  });
  const brokenRow = requireSuccess(await readTransaction(fixture, broken.transactionIds[1]));
  requireSuccess(await fixture.admin.from('transactions').update({ description: 'Wrong (Installment 2/2)' }).eq('id', brokenRow.id));
  const beforeBrokenEdit = await Promise.all(broken.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description));
  const brokenRequest = randomUUID();
  assert.equal((await apply(fixture, edit({ groupId: broken.operationId }, 'Changed', 'Consistent'), brokenRequest)).error?.message,
    'NEEDS_REVIEW');
  assert.deepEqual(await Promise.all(broken.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), beforeBrokenEdit);
  assert.deepEqual(requireSuccess(await fixture.admin.from('financial_operations').select('id').eq('request_id', brokenRequest)), []);

  const missingProof = await transact(fixture, card.id, {
    description: 'Unproven', installments: { count: 2, firstDueDate: '2027-03-01' },
  });
  const beforeMissingProof = await Promise.all(missingProof.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description));
  requireSuccess(await fixture.admin.from('financial_operations').update({ command: { kind: 'reserve' } })
    .eq('id', missingProof.operationId));
  const missingProofRequest = randomUUID();
  assert.equal((await apply(fixture, edit({ groupId: missingProof.operationId }, 'Changed', 'Unproven'), missingProofRequest)).error?.message,
    'NEEDS_REVIEW');
  assert.deepEqual(await Promise.all(missingProof.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), beforeMissingProof);
  assert.deepEqual(requireSuccess(await fixture.admin.from('financial_operations').select('id').eq('request_id', missingProofRequest)), []);

  const misnumbered = await transact(fixture, card.id, {
    description: 'Ordinal proof', installments: { count: 2, firstDueDate: '2027-04-01' },
  });
  requireSuccess(await fixture.admin.from('transactions').update({ description: 'Ordinal proof (Installment 1/2)' })
    .eq('id', misnumbered.transactionIds[1]));
  const beforeMisnumberedEdit = await Promise.all(misnumbered.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description));
  const misnumberedRequest = randomUUID();
  assert.equal((await apply(fixture, edit({ groupId: misnumbered.operationId }, 'Renumbered', 'Ordinal proof'), misnumberedRequest)).error?.message,
    'NEEDS_REVIEW');
  assert.deepEqual(await Promise.all(misnumbered.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), beforeMisnumberedEdit);
  assert.deepEqual(requireSuccess(await fixture.admin.from('financial_operations').select('id').eq('request_id', misnumberedRequest)), []);
});

test('legacy null purchase dates and count-one groups remain editable without inventing suffixes', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await creditAccount(fixture));
  const legacy = await transact(fixture, card.id, {
    description: 'Legacy', installments: { count: 2, firstDueDate: '2026-11-01' },
  });
  requireSuccess(await fixture.admin.from('transactions').update({ purchase_date: null }).eq('installment_group_id', legacy.operationId));
  requireSuccess(await apply(fixture, edit({ groupId: legacy.operationId }, 'Updated legacy', 'Legacy')));
  assert.deepEqual(await Promise.all(legacy.transactionIds.map(async id =>
    requireSuccess(await readTransaction(fixture, id)).description)), [
    'Updated legacy (Installment 1/2)', 'Updated legacy (Installment 2/2)',
  ]);

  const single = await transact(fixture, card.id, {
    description: 'One', installments: { count: 1, firstDueDate: '2026-11-01' },
  });
  requireSuccess(await apply(fixture, edit({ groupId: single.operationId }, 'One changed', 'One')));
  assert.equal(requireSuccess(await readTransaction(fixture, single.transactionIds[0])).description, 'One changed');
});

test('credit purchase and payment edits retain debt provenance through snapshot, reversal, and correction', async t => {
  const fixture = await setup(t);
  const card = requireSuccess(await creditAccount(fixture));
  const purchase = await transact(fixture, card.id, {
    description: 'Laptop', installments: { count: 3, firstDueDate: '2026-11-01' },
  });
  const initial = requireSuccess(await fixture.owner.client.rpc('debt_snapshot'));
  const initialRows = initial.rows.filter(row => row.groupId === purchase.operationId);
  assert.equal(initial.accounts.find(account => account.accountId === card.id).reconciliation, 'balanced');
  for (const next of ['Laptop renamed', 'Laptop final']) {
    requireSuccess(await apply(fixture, edit({ groupId: purchase.operationId }, next,
      next === 'Laptop renamed' ? 'Laptop' : 'Laptop renamed')));
  }

  const payment = await transact(fixture, fixture.owner.account.id, {
    type: 'transfer', transferToAccountId: card.id, amount: '20.00', description: 'Payment', date: '2026-11-10',
  });
  requireSuccess(await apply(fixture, edit({ transactionId: payment.transactionIds[0] }, 'Payment named', 'Payment')));
  requireSuccess(await apply(fixture, edit({ transactionId: payment.transactionIds[0] }, 'Payment final', 'Payment named')));
  let snapshot = requireSuccess(await fixture.owner.client.rpc('debt_snapshot'));
  let accountState = snapshot.accounts.find(account => account.accountId === card.id);
  let rows = snapshot.rows.filter(row => row.groupId === purchase.operationId);
  assert.deepEqual([accountState.totalOutstanding, accountState.reconciliation,
    ...rows.map(row => [row.ordinal, row.originalAmount, row.paidAmount, row.remainingAmount, row.name])],
  ['70.00', 'balanced', ...initialRows.map(row => [row.ordinal, row.originalAmount,
    row.ordinal === 1 ? '20.00' : '0.00', row.ordinal === 1 ? '10.00' : '30.00', `Laptop final (Installment ${row.ordinal}/3)`])]);

  requireSuccess(await apply(fixture, { kind: 'delete_transaction', transactionId: payment.transactionIds[0] }));
  snapshot = requireSuccess(await fixture.owner.client.rpc('debt_snapshot'));
  accountState = snapshot.accounts.find(account => account.accountId === card.id);
  rows = snapshot.rows.filter(row => row.groupId === purchase.operationId);
  assert.deepEqual([accountState.totalOutstanding, accountState.reconciliation, rows.map(row => row.remainingAmount)],
    ['90.00', 'balanced', ['30.00', '30.00', '30.00']]);

  requireSuccess(await apply(fixture, { kind: 'correct_debt_rows', accountId: card.id,
    rowIds: [rows[1].id], fingerprint: accountState.fingerprint }));
  snapshot = requireSuccess(await fixture.owner.client.rpc('debt_snapshot'));
  accountState = snapshot.accounts.find(account => account.accountId === card.id);
  rows = snapshot.rows.filter(row => row.groupId === purchase.operationId);
  assert.deepEqual([accountState.totalOutstanding, accountState.reconciliation,
    rows.map(row => [row.ordinal, row.correctedAmount, row.remainingAmount])],
  ['60.00', 'balanced', [[1, '0.00', '30.00'], [2, '30.00', '0.00'], [3, '0.00', '30.00']]]);
});

test('the metadata helper stays private, the dispatcher grants stay stable, and direct transaction updates stay denied', async t => {
  const fixture = await setup(t);
  const purchase = await transact(fixture, fixture.owner.account.id, { description: 'Read only' });
  const { queryAdmin } = await databaseRuntime();
  const [permissions] = await queryAdmin(`SELECT
    p.prosecdef,
    p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
    has_function_privilege('anon','public.goal_transaction_description_apply(uuid,jsonb,jsonb)','EXECUTE') AS anon_execute,
    has_function_privilege('authenticated','public.goal_transaction_description_apply(uuid,jsonb,jsonb)','EXECUTE') AS authenticated_execute,
    has_function_privilege('service_role','public.goal_transaction_description_apply(uuid,jsonb,jsonb)','EXECUTE') AS service_execute,
    has_function_privilege('authenticated','public.goal_finance_apply(uuid,jsonb,jsonb)','EXECUTE') AS authenticated_dispatch,
    has_function_privilege('service_role','public.goal_finance_apply(uuid,jsonb,jsonb)','EXECUTE') AS service_dispatch,
    has_function_privilege('anon','public.goal_finance_apply(uuid,jsonb,jsonb)','EXECUTE') AS anon_dispatch,
    has_table_privilege('authenticated','public.transactions','UPDATE') AS direct_update
    FROM pg_proc p WHERE p.oid='public.goal_transaction_description_apply(uuid,jsonb,jsonb)'::regprocedure`);
  assert.deepEqual(permissions, {
    prosecdef: true, proconfig: ['search_path=pg_catalog, public'], public_execute: false, anon_execute: false,
    authenticated_execute: false, service_execute: false, authenticated_dispatch: true, service_dispatch: true,
    anon_dispatch: false, direct_update: false,
  });
  const direct = await fixture.owner.client.from('transactions').update({ description: 'Bypass' })
    .eq('id', purchase.transactionIds[0]).select();
  assert.ok(direct.error);
});
