import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanupFinanceFixture, createFinanceFixture, databaseRuntime, installLatestMigrations, requireSuccess } from './helpers.mjs';

before(installLatestMigrations);
after(installLatestMigrations);

async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}

const credit = overrides => ({ name: 'Credit', type: 'credit_card', currency: 'PHP', color: '#00aa99', icon: null,
  is_savings: false, interest_rate: 0, include_in_networth: true, display_order: 0, ...overrides });
const opening = (clientId, amount, name = clientId) => ({ clientId, name, mode: 'single', amount,
  firstDueDate: '2026-11-15', count: 1 });
const createDebtWithClient = (client, items = [], details = credit()) => client.rpc('debt_account_create', {
  p_request_id: randomUUID(), p_account: details, p_opening_debts: items,
});
const createDebt = (fixture, items = [], details = credit()) => createDebtWithClient(fixture.owner.client, items, details);
const apply = (fixture, command, request = randomUUID(), quote = null) => fixture.owner.client.rpc('goal_finance_apply', {
  p_request_id: request, p_command: command, p_quote: quote,
});

async function privateState(fixture, accountId) {
  const { queryAdmin } = await databaseRuntime();
  const [row] = await queryAdmin(`SELECT public.debt_account_state('${fixture.owner.id}'::uuid,'${accountId}'::uuid) AS state`);
  return row.state;
}

async function transact(fixture, draft, request = randomUUID()) {
  const quote = requireSuccess(await fixture.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  return requireSuccess(await apply(fixture, { kind: 'transaction', draft }, request, quote));
}

const purchaseDraft = (accountId, amount, overrides = {}) => ({ type: 'expense', accountId,
  transferToAccountId: null, categoryId: null, goalId: null, amount, description: 'Laptop purchase',
  date: '2026-11-15', installments: null, reservationMoves: [], ...overrides });
const paymentDraft = (fixture, cardId, amount) => ({ type: 'transfer', accountId: fixture.owner.account.id,
  transferToAccountId: cardId, categoryId: null, goalId: null, amount, description: 'Card payment',
  date: '2026-12-20', installments: null, reservationMoves: [] });

async function payment(fixture, cardId, amount) {
  return transact(fixture, paymentDraft(fixture, cardId, amount));
}

async function readRows(fixture, table, accountId) {
  return requireSuccess(await fixture.owner.client.from(table).select('*').eq('account_id', accountId).order('id'));
}

async function hasOperation(fixture, requestId) {
  return requireSuccess(await fixture.admin.from('financial_operations').select('id')
    .eq('user_id', fixture.owner.id).eq('request_id', requestId));
}

test('correction writes selected rows once and replays the completed result before checking its stale fingerprint', async t => {
  const fixture = await setup(t);
  const created = requireSuccess(await createDebt(fixture, [
    { ...opening('laptop', '800.00', 'Laptop'), mode: 'installments', count: 2 },
  ]));
  const before = await privateState(fixture, created.accountId);
  const rowIds = before.rows.map(row => row.id);
  const command = { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [...rowIds].reverse(), fingerprint: before.account.fingerprint };
  const requestId = randomUUID();

  const concurrent = await Promise.all([apply(fixture, command, requestId), apply(fixture, command, requestId)]);
  const concurrentResults = concurrent.map(result => requireSuccess(result));
  const corrected = concurrentResults.find(result => !result.replayed);
  const after = await privateState(fixture, created.accountId);
  const events = requireSuccess(await fixture.owner.client.from('debt_correction_events').select('*')
    .eq('operation_id', corrected.operationId).order('id'));
  const card = requireSuccess(await fixture.owner.client.from('accounts').select('balance').eq('id', created.accountId).single());

  assert.deepEqual([corrected.transactionIds, corrected.replayed], [[], false]);
  assert.equal(concurrentResults.filter(result => result.replayed).length, 1);
  assert.deepEqual(after.rows.map(row => [row.correctedAmount, row.remainingAmount]), [
    ['400.00', '0.00'], ['400.00', '0.00'],
  ]);
  assert.deepEqual([after.account.totalOutstanding, card.balance, events.map(event => event.amount)],
    ['0.00', 0, [400, 400]]);

  const replayed = requireSuccess(await apply(fixture, { ...command, rowIds }, requestId));
  assert.deepEqual([replayed.operationId, replayed.transactionIds, replayed.replayed], [corrected.operationId, [], true]);
  assert.deepEqual(await readRows(fixture, 'debt_correction_events', created.accountId), events);
  assert.equal((await apply(fixture, { ...command, rowIds: [rowIds[0]] }, requestId)).error?.message, 'REQUEST_CONFLICT');
  const fullyCorrectedRequest = randomUUID();
  const fullyCorrected = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [rowIds[0]], fingerprint: after.account.fingerprint }, fullyCorrectedRequest);
  assert.equal(fullyCorrected.error?.message, 'INVALID_STATE');
  assert.deepEqual(await hasOperation(fixture, fullyCorrectedRequest), []);
});

test('a partial purchase correction preserves the purchase and reverses payment without restoring corrected principal', async t => {
  const fixture = await setup(t);
  requireSuccess(await fixture.admin.from('accounts').update({ balance: '1000.00' }).eq('id', fixture.owner.account.id));
  const created = requireSuccess(await createDebt(fixture));
  const purchase = await transact(fixture, purchaseDraft(created.accountId, '400.00'));
  const purchaseId = purchase.transactionIds[0];
  const original = requireSuccess(await fixture.owner.client.from('transactions').select('*').eq('id', purchaseId).single());
  const paid = await payment(fixture, created.accountId, '100.00');
  const stateBeforeCorrection = await privateState(fixture, created.accountId);
  const row = stateBeforeCorrection.rows.find(item => item.transactionId === purchaseId);
  const correctionCommand = { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [row.id], fingerprint: stateBeforeCorrection.account.fingerprint };
  const correctionRequest = randomUUID();
  const correction = requireSuccess(await apply(fixture, correctionCommand, correctionRequest));

  let state = await privateState(fixture, created.accountId);
  const purchaseAfterCorrection = requireSuccess(await fixture.owner.client.from('transactions').select('*')
    .eq('id', purchaseId).single());
  const cashAfterCorrection = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', fixture.owner.account.id).single());
  const cardAfterCorrection = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', created.accountId).single());
  const failedDeleteRequest = randomUUID();
  const deniedDelete = await apply(fixture, { kind: 'delete_transaction', transactionId: purchaseId }, failedDeleteRequest);

  assert.equal(deniedDelete.error?.message, 'INVALID_STATE');
  assert.deepEqual(await hasOperation(fixture, failedDeleteRequest), []);
  assert.deepEqual([purchaseAfterCorrection.amount, purchaseAfterCorrection.description, purchaseAfterCorrection.date,
    purchaseAfterCorrection.account_id, purchaseAfterCorrection.installment_group_id],
  [original.amount, original.description, original.date, original.account_id, original.installment_group_id]);
  assert.deepEqual([state.rows[0].paidAmount, state.rows[0].correctedAmount, state.rows[0].remainingAmount,
    cashAfterCorrection.balance, cardAfterCorrection.balance], ['100.00', '300.00', '0.00', 900, 0]);
  assert.equal(requireSuccess(await fixture.owner.client.from('transactions').select('id')
    .eq('id', paid.transactionIds[0])).length, 1);

  requireSuccess(await apply(fixture, { kind: 'delete_transaction', transactionId: paid.transactionIds[0] }));
  state = await privateState(fixture, created.accountId);
  assert.deepEqual([state.rows[0].paidAmount, state.rows[0].correctedAmount, state.rows[0].remainingAmount,
    state.account.totalOutstanding], ['0.00', '300.00', '100.00', '100.00']);
  const oldCorrectionReplay = requireSuccess(await apply(fixture, correctionCommand, correctionRequest));
  assert.deepEqual([oldCorrectionReplay.operationId, oldCorrectionReplay.replayed], [correction.operationId, true]);

  const freshCorrection = requireSuccess(await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [row.id], fingerprint: state.account.fingerprint }));
  state = await privateState(fixture, created.accountId);
  const finalCash = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', fixture.owner.account.id).single());
  const finalCard = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', created.accountId).single());
  assert.deepEqual([freshCorrection.transactionIds, state.rows[0].paidAmount, state.rows[0].correctedAmount,
    state.rows[0].remainingAmount, finalCash.balance, finalCard.balance], [[], '0.00', '400.00', '0.00', 1000, 0]);
});

test('stale, mixed-group, missing-row and other-owner selections reject without events or operations', async t => {
  const fixture = await setup(t);
  const created = requireSuccess(await createDebt(fixture, [
    { ...opening('paid', '50.00', 'Fully paid'), firstDueDate: '2026-10-15' }, opening('first', '200.00'),
  ]));
  const original = await privateState(fixture, created.accountId);
  const mixedRequest = randomUUID();
  const mixed = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: original.rows.map(row => row.id), fingerprint: original.account.fingerprint }, mixedRequest);
  assert.equal(mixed.error?.message, 'INVALID_STATE');
  assert.deepEqual(await hasOperation(fixture, mixedRequest), []);

  const missingRequest = randomUUID();
  const missingRow = randomUUID();
  const missing = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [original.rows[0].id, missingRow], fingerprint: original.account.fingerprint }, missingRequest);
  assert.equal(missing.error?.message, 'NOT_ALLOWED');
  assert.deepEqual(await hasOperation(fixture, missingRequest), []);

  await payment(fixture, created.accountId, '50.00');
  const afterPayment = await privateState(fixture, created.accountId);
  const paidRow = afterPayment.rows.find(row => row.name === 'Fully paid');
  const paidRequest = randomUUID();
  const fullyPaid = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [paidRow.id], fingerprint: afterPayment.account.fingerprint }, paidRequest);
  assert.equal(fullyPaid.error?.message, 'INVALID_STATE');
  assert.deepEqual(await hasOperation(fixture, paidRequest), []);
  const staleRequest = randomUUID();
  const stale = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [original.rows[0].id], fingerprint: original.account.fingerprint }, staleRequest);
  assert.equal(stale.error?.message, 'STALE_QUOTE');
  assert.deepEqual(await hasOperation(fixture, staleRequest), []);

  const otherDebt = requireSuccess(await createDebtWithClient(fixture.other.client, [opening('other', '100.00')]));
  const otherState = await privateState({ ...fixture, owner: fixture.other }, otherDebt.accountId);
  const current = afterPayment;
  const otherRequest = randomUUID();
  const otherOwnerRow = await apply(fixture, { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [otherState.rows[0].id], fingerprint: current.account.fingerprint }, otherRequest);
  assert.equal(otherOwnerRow.error?.message, 'NOT_ALLOWED');
  assert.deepEqual(await hasOperation(fixture, otherRequest), []);

  assert.deepEqual(await readRows(fixture, 'debt_correction_events', created.accountId), []);
  const card = requireSuccess(await fixture.owner.client.from('accounts').select('balance').eq('id', created.accountId).single());
  assert.equal(card.balance, 200);
});

test('a concurrent payment and correction cannot apply against the same stale debt fingerprint', async t => {
  const fixture = await setup(t);
  requireSuccess(await fixture.admin.from('accounts').update({ balance: '1000.00' }).eq('id', fixture.owner.account.id));
  const created = requireSuccess(await createDebt(fixture));
  const purchase = await transact(fixture, purchaseDraft(created.accountId, '400.00'));
  const stateBefore = await privateState(fixture, created.accountId);
  const row = stateBefore.rows.find(item => item.transactionId === purchase.transactionIds[0]);
  const command = { kind: 'correct_debt_rows', accountId: created.accountId,
    rowIds: [row.id], fingerprint: stateBefore.account.fingerprint };
  const correctionRequest = randomUUID();
  const draft = paymentDraft(fixture, created.accountId, '100.00');
  const quote = requireSuccess(await fixture.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  const paymentRequest = randomUUID();
  const [paymentResult, correctionResult] = await Promise.all([
    apply(fixture, { kind: 'transaction', draft }, paymentRequest, quote),
    apply(fixture, command, correctionRequest),
  ]);
  const paymentApplied = !paymentResult.error;
  const correctionApplied = !correctionResult.error;
  assert.equal(Number(paymentApplied) + Number(correctionApplied), 1);
  const loser = paymentApplied ? correctionResult : paymentResult;
  assert.equal(loser.error?.message, 'STALE_QUOTE');

  const state = await privateState(fixture, created.accountId);
  const cash = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', fixture.owner.account.id).single());
  const card = requireSuccess(await fixture.owner.client.from('accounts').select('balance')
    .eq('id', created.accountId).single());
  assert.ok(Number(state.rows[0].remainingAmount) >= 0);
  assert.deepEqual([state.rows[0].paidAmount, state.rows[0].correctedAmount, state.rows[0].remainingAmount],
    paymentApplied ? ['100.00', '0.00', '300.00'] : ['0.00', '400.00', '0.00']);
  assert.deepEqual([cash.balance, card.balance], paymentApplied ? [900, 300] : [1000, 0]);
});
