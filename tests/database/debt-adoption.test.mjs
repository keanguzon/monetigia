import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanupFinanceFixture, createFinanceFixture, installLatestMigrations, requireSuccess } from './helpers.mjs';

before(installLatestMigrations); after(installLatestMigrations);
async function setup(t) { const f = await createFinanceFixture(); t.after(() => cleanupFinanceFixture(f)); return f; }
const snap = async f => requireSuccess(await f.owner.client.rpc('debt_snapshot'));
const apply = (f, command, request = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', { p_request_id: request, p_command: command, p_quote: quote });
const item = (clientId, amount) => ({ clientId, name: clientId, mode: 'single', amount, firstDueDate: '2026-11-30', count: 1 });
async function legacy(f, balance = '5000.00') { return requireSuccess(await f.admin.from('accounts').insert({ user_id: f.owner.id, name: 'Legacy', type: 'credit_card', balance, currency: 'PHP' }).select().single()); }
async function command(f, card, items = [item('first', '3000.00'), item('second', '2000.00')]) { return { kind: 'adopt_opening_debt', accountId: card.id, fingerprint: (await snap(f)).accounts.find(a => a.accountId === card.id).fingerprint, items }; }
async function unchanged(f) { return Promise.all(['accounts','goals','transactions','goal_allocation_events','debt_settlement_events','debt_correction_events'].map(async table => requireSuccess(await f.owner.client.from(table).select('*').eq('user_id', f.owner.id).order('id')))); }
async function payment(f, card, amount) { const draft = { type: 'transfer', accountId: f.owner.account.id, transferToAccountId: card.id, categoryId: null, goalId: null, amount, description: 'Payment', date: '2026-11-30', installments: null, reservationMoves: [] }; const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft })); return requireSuccess(await apply(f, { kind: 'transaction', draft }, randomUUID(), quote)); }

test('adoption dates the entire residual once without changing balances cash goals or history and replays before stale validation', async t => {
  const f = await setup(t); const card = await legacy(f); const c = await command(f, card); const request = randomUUID(); const before = await unchanged(f);
  const results = (await Promise.all([apply(f,c,request),apply(f,c,request)])).map(r => requireSuccess(r));
  assert.equal(results.filter(r => r.replayed).length, 1); assert.deepEqual(results[0].transactionIds, []);
  assert.deepEqual(await unchanged(f), before);
  let s = await snap(f); assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding,s.accounts[0].reconciliation], ['5000.00','0.00','balanced']);
  assert.deepEqual(s.rows.map(r => r.originalAmount).sort(), ['2000.00','3000.00']); assert.ok(s.rows.every(r => r.source === 'opening' && r.transactionId === null && r.dueDate === '2026-11-30'));
  await payment(f,card,'100.00'); s = await snap(f); assert.equal(s.accounts[0].totalOutstanding,'4900.00'); assert.equal(s.accounts[0].reconciliation,'balanced');
  assert.deepEqual(requireSuccess(await apply(f,c,request)), { ...results[0], replayed: true });
  assert.equal((await apply(f,{ ...c,items: [item('changed','5000.00')] },request)).error?.message,'REQUEST_CONFLICT');
  assert.equal((await apply(f,c)).error?.message,'STALE_QUOTE');
});

test('adoption rejects partial overfull malformed and cross-owner commands with no partial rows or operation', async t => {
  const f = await setup(t); const card = await legacy(f); const c = await command(f,card);
  const cases = [ { items: [item('partial','4000.00')] }, { items: [item('over','6000.00')] }, { items: [] }, { items: [item('same','2500.00'),item('same','2500.00')] },
    { items: [{ ...item('bad','5000.00'), firstDueDate: '2026-02-30' }] }, { items: [{ ...item('bad','5000.00'), name: ' ' }] },
    { items: [{ ...item('bad','5000.00'), count: 2 }] }, { items: [{ ...item('bad','5000.00'), amount: '5000' }] }, { items: [{ ...item('bad','5000.00'), mode: 'installments', count: 601 }] }, { fingerprint: '0'.repeat(64) },
    { items: Array.from({length:101},(_,i)=>item(String(i),'1.00')) },
    { items: Array.from({length:11},(_,i)=>({...item(String(i),'600.00'),mode:'installments',count:600})) },
    { items: [item('huge','9999999999999.99'),item('extra','0.01')] },
    { items: [{...item('endpoint','5000.00'),mode:'installments',count:2,firstDueDate:'9999-12-31'}] },
    { items: [{...item('range','10000000000000.00')}] }, { items: [{...item('name','5000.00'),name:'x'.repeat(61)}] },
    { items: [{...item('count','5000.00'),mode:'installments',count:1.5}] }, { extra:true } ];
  for (const changes of cases) { const request = randomUUID(); assert.ok((await apply(f,{ ...c,...changes },request)).error); assert.deepEqual(requireSuccess(await f.admin.from('financial_operations').select('id').eq('request_id',request)),[]); }
  assert.deepEqual(requireSuccess(await f.admin.from('debt_items').select('id').eq('account_id',card.id)),[]);
  assert.equal((await f.other.client.rpc('goal_finance_apply',{ p_request_id:randomUUID(),p_command:c,p_quote:null })).error?.message,'NOT_ALLOWED');
  assert.equal((await apply(f,c,randomUUID(),{})).error?.message,'INVALID_STATE');
});

test('adoption preserves actual purchases and uses the same 600-row final-remainder schedule as creation', async t => {
  const f = await setup(t); const card = await legacy(f,'600.01');
  const draft = {type:'expense',accountId:card.id,transferToAccountId:null,categoryId:null,goalId:null,amount:'20.00',description:'Actual purchase',date:'2026-11-30',installments:null,reservationMoves:[]};
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote',{p_draft:draft}));
  const purchase = requireSuccess(await apply(f,{kind:'transaction',draft},randomUUID(),quote));
  const before = await snap(f); const original = before.rows[0];
  requireSuccess(await apply(f,await command(f,card,[{...item('schedule','600.01'),mode:'installments',count:600}])));
  const s = await snap(f); assert.deepEqual(s.rows.find(r=>r.transactionId===purchase.transactionIds[0]),original);
  const opening = s.rows.filter(r=>r.source==='opening').sort((a,b)=>a.ordinal-b.ordinal);
  assert.equal(opening.length,600); assert.equal(opening[0].originalAmount,'1.00'); assert.equal(opening[599].originalAmount,'1.01');
  assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding,s.accounts[0].reconciliation],['620.01','0.00','balanced']);
});

test('a formerly undated payment reversal returns residual without rewriting adopted principal', async t => {
  const f = await setup(t); const card = await legacy(f); const paid = await payment(f,card,'400.00');
  requireSuccess(await apply(f,await command(f,card,[item('remaining','4600.00')])));
  const rows = (await snap(f)).rows;
  requireSuccess(await apply(f,{ kind:'delete_transaction',transactionId:paid.transactionIds[0] }));
  const s = await snap(f); assert.deepEqual(s.rows,rows); assert.deepEqual([s.accounts[0].totalOutstanding,s.accounts[0].undatedOutstanding],['5000.00','400.00']);
});

test('adoption denies zero residual inactive unsupported and review accounts and stale correction fingerprints', async t => {
  const f = await setup(t);
  const zero = await legacy(f,'0.00'); const c0 = await command(f,zero,[item('zero','1.00')]); assert.equal((await apply(f,c0)).error?.message,'INVALID_STATE');
  for (const changes of [{is_active:false},{currency:'USD'}]) {
    const card = await legacy(f); requireSuccess(await f.admin.from('accounts').update(changes).eq('id',card.id));
    assert.equal((await apply(f,await command(f,card))).error?.message,'INVALID_STATE');
  }
  const card = await legacy(f); const first = await command(f,card);
  requireSuccess(await apply(f,first)); const s = await snap(f); const a = s.accounts.find(a => a.accountId===card.id);
  requireSuccess(await apply(f,{kind:'correct_debt_rows',accountId:card.id,rowIds:[s.rows.find(r=>r.accountId===card.id).id],fingerprint:a.fingerprint}));
  assert.equal((await apply(f,{...first,fingerprint:a.fingerprint})).error?.message,'STALE_QUOTE');
  const review = await legacy(f);
  requireSuccess(await f.admin.from('transactions').insert({user_id:f.owner.id,account_id:review.id,type:'income',amount:1,date:'2026-11-30'}));
  assert.equal((await apply(f,await command(f,review))).error?.message,'INVALID_STATE');
});
