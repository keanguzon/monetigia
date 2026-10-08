import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { cleanupFinanceFixture, createFinanceFixture, databaseRuntime, installLatestMigrations, requireSuccess } from './helpers.mjs';

before(installLatestMigrations);
after(installLatestMigrations);
export async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
export const snapshot = async f => requireSuccess(await f.owner.client.rpc('debt_snapshot'));
export const apply = (f, command, requestId = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', { p_request_id: requestId, p_command: command, p_quote: quote });
export const legacy = async (f, balance = '5000.00', overrides = {}) => requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Legacy', type: 'credit_card', balance, currency: 'PHP', ...overrides }).select().single());
export async function transact(f, accountId, amount, overrides = {}) {
  const draft = { type: 'expense', accountId, transferToAccountId: null, categoryId: null, goalId: null, amount, description: 'Actual purchase', date: '2026-11-30', installments: null, reservationMoves: [], ...overrides };
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  return requireSuccess(await apply(f, { kind: 'transaction', draft }, randomUUID(), quote));
}
export const payment = (f, card, amount) => transact(f, f.owner.account.id, amount, { type: 'transfer', transferToAccountId: card, description: 'Actual payment' });

test('snapshot returns initial5000 plus purchase2000 minus proven400 once with stable provenance and owner isolation', async t => {
  const f = await setup(t); const card = await legacy(f);
  const purchase = await transact(f, card.id, '2000.00'); await payment(f, card.id, '400.00');
  await legacy(f, '12.00', { user_id: f.other.id });
  const s = await snapshot(f);
  assert.equal(s.accounts.length, 1); assert.equal(s.rows.length, 1);
  assert.deepEqual([s.accounts[0].totalOutstanding, s.accounts[0].undatedOutstanding, s.accounts[0].reconciliation, s.accounts[0].reconciliationDelta], ['6600.00', '5000.00', 'balanced', '0.00']);
  assert.deepEqual([s.rows[0].id, s.rows[0].transactionId, s.rows[0].groupId, s.rows[0].dueDate, s.rows[0].remainingAmount, s.rows[0].ordinal, s.rows[0].name], [purchase.transactionIds[0], purchase.transactionIds[0], purchase.transactionIds[0], '2026-11-30', '1600.00', 1, 'Actual purchase']);
  assert.deepEqual(await snapshot(f), s);
});

test('snapshot includes zero and inactive debt accounts and flags unsupported currency and unproven dates honestly', async t => {
  const f = await setup(t); const zero = await legacy(f, '0.00'); const inactive = await legacy(f, '20.00', { is_active: false });
  const usd = await legacy(f, '30.00', { currency: 'USD' }); const broken = await legacy(f, '50.00');
  const tx = requireSuccess(await f.admin.from('transactions').insert({ user_id: f.owner.id, account_id: broken.id, type: 'expense', amount: '70.00', date: '2026-11-30', description: 'Legacy expense' }).select().single());
  const s = await snapshot(f); const a = id => s.accounts.find(a => a.accountId === id);
  assert.equal(a(zero.id).totalOutstanding, '0.00'); assert.equal(a(inactive.id).totalOutstanding, '20.00');
  assert.equal(a(usd.id).reconciliation, 'needs_review');
  assert.deepEqual([a(broken.id).totalOutstanding, a(broken.id).undatedOutstanding, a(broken.id).reconciliationDelta, a(broken.id).reconciliation], ['50.00', '0.00', '-20.00', 'needs_review']);
  assert.equal(s.rows.find(row => row.id === tx.id).dueDate, null);
});

test('snapshot and its private dependencies deny public and service execution and pin definer search path', async () => {
  const { queryAdmin, url, options } = await databaseRuntime();
  const [s] = await queryAdmin("SELECT has_function_privilege('authenticated','public.debt_snapshot()','EXECUTE') AS authenticated, has_function_privilege('anon','public.debt_snapshot()','EXECUTE') AS anonymous,has_function_privilege('service_role','public.debt_snapshot()','EXECUTE') AS service, has_function_privilege('authenticated','public.debt_account_state(uuid,uuid)','EXECUTE') AS helper");
  assert.deepEqual(s, { authenticated: true, anonymous: false, service: false, helper: false });
  const [definition] = await queryAdmin("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.debt_snapshot()'::regprocedure");
  assert.equal(definition.prosecdef, true); assert.deepEqual(definition.proconfig, ['search_path=pg_catalog, public']);
  const anonymous = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  assert.ok((await anonymous.rpc('debt_snapshot')).error);
});

test('snapshot retains installment ordinals and paid corrected audit rows through payment reversal', async t => {
  const f = await setup(t); const card = await legacy(f, '0.00');
  const purchase = await transact(f, card.id, '100.01', { installments: { count: 3, firstDueDate: '2026-11-30' } });
  const paid = await payment(f, card.id, '33.34');
  let s = await snapshot(f); assert.deepEqual(s.rows.map(r => [r.transactionId,r.ordinal,r.originalAmount,r.remainingAmount]), [
    [purchase.transactionIds[0],1,'33.34','0.00'], [purchase.transactionIds[1],2,'33.34','33.34'], [purchase.transactionIds[2],3,'33.33','33.33'],
  ]);
  requireSuccess(await apply(f,{ kind:'correct_debt_rows',accountId:card.id,rowIds:[purchase.transactionIds[1]],fingerprint:s.accounts[0].fingerprint }));
  requireSuccess(await apply(f,{ kind:'delete_transaction',transactionId:paid.transactionIds[0] }));
  s = await snapshot(f); assert.equal(s.rows.length,3);
  assert.deepEqual(s.rows.map(r => [r.paidAmount,r.correctedAmount,r.remainingAmount]), [['0.00','0.00','33.34'],['0.00','33.34','0.00'],['0.00','0.00','33.33']]);
  assert.equal(s.accounts[0].totalOutstanding,'66.67'); assert.equal(s.accounts[0].reconciliation,'balanced');
});

test('credit advances stay undated and proven refund-like income flags review without changing the authoritative balance', async t => {
  const f = await setup(t); const card = await legacy(f,'0.00');
  await transact(f,card.id,'100.00',{ type:'transfer',transferToAccountId:f.owner.account.id,description:'Advance' });
  let s = await snapshot(f); assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding,s.rows.length,s.accounts[0].reconciliation],['100.00','100.00',0,'balanced']);
  await transact(f,card.id,'20.00',{ type:'income',description:'Refund' });
  s = await snapshot(f); assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding,s.accounts[0].reconciliation],['80.00','80.00','needs_review']);
  const balance = requireSuccess(await f.owner.client.from('accounts').select('balance').eq('id',card.id).single()); assert.equal(balance.balance,80);
});

test('snapshot represents more than 5000 proven purchases without a client or RPC cap', async t => {
  const f = await setup(t); const card = await legacy(f,'5001.00'); const { queryAdmin } = await databaseRuntime();
  await queryAdmin(`WITH ids AS (SELECT gen_random_uuid() AS tx,gen_random_uuid() AS op FROM generate_series(1,5001)),
    operations AS (INSERT INTO public.financial_operations(id,user_id,request_id,command_hash,command,result,completed_at)
      SELECT op,'${f.owner.id}'::uuid,gen_random_uuid(),repeat('a',64),
        jsonb_build_object('kind','transaction','draft',jsonb_build_object('type','expense','accountId','${card.id}', 'amount','1.00','installments',NULL)),
        jsonb_build_object('operationId',op,'transactionIds',jsonb_build_array(tx),'replayed',false),now() FROM ids RETURNING id)
    INSERT INTO public.transactions(id,user_id,account_id,type,amount,date,description)
      SELECT tx,'${f.owner.id}'::uuid,'${card.id}'::uuid,'expense',1.00,DATE '2026-11-30','Bulk purchase' FROM ids`);
  const s = await snapshot(f); assert.equal(s.rows.length,5001);
  assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding,s.accounts[0].reconciliation],['5001.00','0.00','balanced']);
  assert.ok(s.rows.every(r => r.originalAmount==='1.00' && r.remainingAmount==='1.00' && r.ordinal===1 && r.dueDate==='2026-11-30'));
});
