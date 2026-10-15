import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { databaseRuntime } from './helpers.mjs';

const migrationUrl = new URL('../../supabase/migrations/202610150002_php_only_currency_retirement.sql', import.meta.url);
let db, sql, owner, other, cash, goal, oldRequest, oldResult, oldOperation, originalSignup;
const details = { name:'Credit',type:'credit_card',color:null,icon:null,is_savings:false,interest_rate:0,include_in_networth:true,display_order:0 };
const item = (clientId, amount) => ({ clientId,name:clientId,mode:'single',amount,firstDueDate:'2026-11-30',count:1 });
const rows = async (query, params=[]) => (await db.queryAdmin(query,params)).rows;
const scalar = async (query, params=[]) => (await rows(query,params))[0].value;
async function asUser(user, query, params=[]) {
  await db.queryAdmin('BEGIN');
  try {
    await db.queryAdmin("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated'})]);
    await db.queryAdmin('SET LOCAL ROLE authenticated');
    const result = await rows(query,params);
    await db.queryAdmin('COMMIT');
    return result;
  } catch (e) { await db.queryAdmin('ROLLBACK'); throw e; }
}
async function rpc(name, args=[], user=owner) {
  return (await asUser(user,`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS value`,args.map(v=>v!==null && typeof v==='object'?JSON.stringify(v):v)))[0].value;
}
const apply = (command, request=randomUUID(), quote=null, user=owner) => rpc('goal_finance_apply',[request,command,quote],user);
const draft = (overrides={}) => ({ type:'expense',accountId:cash,transferToAccountId:null,categoryId:null,goalId:null,amount:'10.00',description:'PHP expense',date:'2026-10-15',installments:null,reservationMoves:[],...overrides });
async function transact(d) { return apply({kind:'transaction',draft:d},randomUUID(),await rpc('goal_transaction_quote',[d])); }
async function migrate(source=sql) {
  try { await db.queryAdmin(source); } catch (e) { await db.queryAdmin('ROLLBACK'); throw e; }
}
async function addUser() {
  const id=randomUUID();
  await db.queryAdmin('INSERT INTO auth.users(id,email,raw_user_meta_data,email_confirmed_at) VALUES($1,$2,$3,now())',[id,`${id}@example.test`,JSON.stringify({username:`php_${id}`})]);
  return id;
}
before(async () => {
  const runtime=await databaseRuntime();
  assert.equal(typeof runtime.adapter?.createIsolatedDatabase,'function','Native retirement coverage requires an adapter.createIsolatedDatabase() factory; it must bootstrap auth on a fresh disposable DB and return queryAdmin/close.');
  db=await runtime.adapter.createIsolatedDatabase();
  const names=await readdir(new URL('../../supabase/migrations/',import.meta.url));
  for(const name of names.filter(n=>/^\d+_.*\.sql$/.test(n) && n<'202610150002').sort()) await db.queryAdmin(await readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8').then(s=>s.replace(/\r\n/g,'\n')));
  owner=await addUser();other=await addUser();
  cash=(await asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Cash','cash',1000) RETURNING id",[owner]))[0].id;
  goal=(await asUser(owner,"INSERT INTO public.goals(user_id,name,target_amount) VALUES($1,'Goal',500) RETURNING id",[owner]))[0].id;
  oldRequest=randomUUID();oldResult=await rpc('debt_account_create',[oldRequest,{...details,currency:'PHP'},[item('old','100.00')]]);
  oldOperation=await scalar('SELECT to_jsonb(o) AS value FROM public.financial_operations o WHERE request_id=$1',[oldRequest]);
  // A deployment may customize signup; the forward migration must leave its entire body alone.
  await db.queryAdmin("COMMENT ON FUNCTION public.handle_new_user() IS 'deployment custom signup';");
  originalSignup=await scalar("SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS value");
  sql=await readFile(migrationUrl,'utf8');
});
after(async () => { if(db) await db.close(); });

test('preflight rejects foreign or null account money and preferences atomically',async () => {
  for(const [table,error] of [['accounts','PHP_RETIREMENT_REQUIRES_PHP_ACCOUNTS'],['user_preferences','PHP_RETIREMENT_REQUIRES_PHP_PREFERENCES']]) {
    for(const currency of ['USD',null]) {
      await db.queryAdmin(`UPDATE public.${table} SET currency=$1 WHERE user_id=$2`,[currency,other]);
      if(table==='accounts' && !(await rows('SELECT id FROM public.accounts WHERE user_id=$1',[other])).length) await db.queryAdmin("INSERT INTO public.accounts(user_id,name,type,currency) VALUES($1,'Foreign','cash',$2)",[other,currency]);
      await assert.rejects(migrate(),new RegExp(error));
      assert.equal(await scalar("SELECT count(*)::int AS value FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('accounts','user_preferences') AND column_name='currency'"),2);
      assert.equal(await scalar('SELECT currency AS value FROM public.'+table+' WHERE user_id=$1',[other]),currency);
      assert.equal(await scalar("SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS value"),originalSignup);
      await db.queryAdmin(`UPDATE public.${table} SET currency='PHP' WHERE user_id=$1`,[other]);
    }
  }
});

test('retirement drops both fields, preserves money and signup, and reapplies with either line ending',async () => {
  const before=await scalar('SELECT jsonb_agg(to_jsonb(a)-\'currency\' ORDER BY id) AS value FROM public.accounts a');
  await migrate();
  assert.deepEqual(await scalar('SELECT jsonb_agg(to_jsonb(a) ORDER BY id) AS value FROM public.accounts a'),before);
  assert.equal(await scalar("SELECT count(*)::int AS value FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('accounts','user_preferences') AND column_name='currency'"),0);
  assert.equal(await scalar("SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) AS value"),originalSignup);
  assert.deepEqual(await rows("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ILIKE '%currency%' AND p.proname<>'debt_account_create'"),[]);
  await migrate(sql.replace(/\r?\n/g,'\r\n'));await migrate(sql.replace(/\r\n/g,'\n'));
  const id=await addUser();
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.user_preferences WHERE user_id=$1',[id]),1);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM public.categories WHERE user_id=$1',[id]),9);
});

test('new debt creation has eight fields while immutable legacy requests replay exactly',async () => {
  assert.deepEqual(await rpc('debt_account_create',[oldRequest,{...details,currency:'PHP'},[item('old','100.00')]]),{...oldResult,replayed:true});
  assert.deepEqual(await scalar('SELECT to_jsonb(o) AS value FROM public.financial_operations o WHERE request_id=$1',[oldRequest]),oldOperation);
  await assert.rejects(rpc('debt_account_create',[randomUUID(),{...details,currency:'PHP'},[]]),/INVALID_STATE/);
  await assert.rejects(rpc('debt_account_create',[randomUUID(),{...details,currency:'USD'},[]]),/INVALID_STATE/);
  await assert.rejects(rpc('debt_account_create',[oldRequest,details,[item('old','100.00')]]),/REQUEST_CONFLICT/);
  const request=randomUUID(),created=await rpc('debt_account_create',[request,details,[item('new','100.00')]]);
  assert.equal(created.replayed,false);
  assert.deepEqual(await rpc('debt_account_create',[request,details,[item('new','100.00')]]),{...created,replayed:true});
  assert.equal(await scalar('SELECT balance::text AS value FROM public.accounts WHERE id=$1',[created.accountId]),'100.00');
});

test('owner grants keep opening, identity, cross-owner and numeric boundaries',async () => {
  const made=await asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'New wallet','bank',20) RETURNING *",[owner]);
  assert.ok(!('currency' in made[0]));
  await assert.rejects(asUser(owner,'UPDATE public.accounts SET balance=500 WHERE id=$1',[cash]),/permission denied/);
  await assert.rejects(asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Bad','cash',-1)",[owner]),/INVALID_STATE/);
  await assert.rejects(asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Bad','cash','NaN')",[owner]),/INVALID_STATE/);
  await assert.rejects(asUser(owner,"INSERT INTO public.accounts(user_id,name,type) VALUES($1,'Other','cash')",[other]),/NOT_ALLOWED/);
  assert.deepEqual(await asUser(other,'SELECT id FROM public.accounts WHERE id=$1',[cash]),[]);
  await assert.rejects(rpc('goal_transaction_quote',[draft()],other),/NOT_ALLOWED/);
  await assert.rejects(rpc('goal_transaction_quote',[draft({amount:'NaN'})]),/INVALID_STATE/);
});

test('reservation, expense quote/apply/replay and transfer maintain balances',async () => {
  const request=randomUUID(),command={kind:'reserve',goalId:goal,accountId:cash,amount:'100.00'};
  const reserved=await apply(command,request);assert.equal(reserved.replayed,false);
  assert.equal((await apply(command,request)).replayed,true);
  const d=draft({goalId:goal,amount:'30.00'}),q=await rpc('goal_transaction_quote',[d]),purchaseRequest=randomUUID();
  const bought=await apply({kind:'transaction',draft:d},purchaseRequest,q);assert.equal(bought.transactionIds.length,1);
  assert.equal((await apply({kind:'transaction',draft:d},purchaseRequest,q)).replayed,true);
  await assert.rejects(db.queryAdmin("UPDATE public.accounts SET type='bank' WHERE id=$1",[cash]),/Wallet identity with financial history cannot change/);
  const stale=draft({goalId:goal,amount:'1.00'});
  const staleQuote=await rpc('goal_transaction_quote',[stale]);
  await apply({kind:'reserve',goalId:goal,accountId:cash,amount:'1.00'});
  await assert.rejects(apply({kind:'transaction',draft:stale},randomUUID(),staleQuote),/STALE_QUOTE/);
  await apply({kind:'release',goalId:goal,accountId:cash,amount:'1.00'});
  const snapshot=await rpc('goal_finance_snapshot');
  const wallet=snapshot.wallets.find(w=>w.accountId===cash);
  assert.deepEqual([wallet.actual,wallet.reserved,wallet.available],['970.00','70.00','900.00']);
  const second=(await asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Second','bank',0) RETURNING id",[owner]))[0].id;
  await transact(draft({type:'transfer',transferToAccountId:second,amount:'20.00'}));
  assert.equal(await scalar('SELECT balance::text AS value FROM public.accounts WHERE id=$1',[second]),'20.00');
  assert.equal(await scalar('SELECT balance::text AS value FROM public.accounts WHERE id=$1',[cash]),'950.00');
});

test('debt payment, adoption, correction and snapshots retain proof and reconciliation',async () => {
  const created=await rpc('debt_account_create',[randomUUID(),details,[item('payment','100.00')]]);
  const paid=await transact(draft({type:'transfer',transferToAccountId:created.accountId,amount:'25.00'}));
  assert.equal(paid.transactionIds.length,1);
  let snap=await rpc('debt_snapshot');
  let account=snap.accounts.find(a=>a.accountId===created.accountId);
  assert.deepEqual([account.totalOutstanding,account.reconciliation],['75.00','balanced']);
  assert.ok(!('currency' in account));
  const legacy=(await asUser(owner,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Legacy','credit_card',40) RETURNING id",[owner]))[0].id;
  snap=await rpc('debt_snapshot');
  const adoption={kind:'adopt_opening_debt',accountId:legacy,fingerprint:snap.accounts.find(a=>a.accountId===legacy).fingerprint,items:[item('adopted','40.00')]};
  await assert.rejects(apply(adoption,randomUUID(),null,other),/NOT_ALLOWED/);
  const request=randomUUID();await apply(adoption,request);assert.equal((await apply(adoption,request)).replayed,true);
  snap=await rpc('debt_snapshot');account=snap.accounts.find(a=>a.accountId===legacy);
  assert.deepEqual([account.totalOutstanding,account.undatedOutstanding,account.reconciliation],['40.00','0.00','balanced']);
  const row=snap.rows.find(r=>r.accountId===legacy);
  await assert.rejects(apply({kind:'correct_debt_rows',accountId:legacy,rowIds:[row.id],fingerprint:'0'.repeat(64)}),/STALE_QUOTE/);
  await apply({kind:'correct_debt_rows',accountId:legacy,rowIds:[row.id],fingerprint:account.fingerprint});
  snap=await rpc('debt_snapshot');assert.equal(snap.accounts.find(a=>a.accountId===legacy).totalOutstanding,'0.00');
});

test('summary and filtered history expose PHP totals without retired fields',async () => {
  const summary=await rpc('spending_summary',['2026-10-01','2026-10-31']);
  assert.equal(summary.expenses,'30.00');assert.equal(summary.debtPayments,'25.00');assert.equal(summary.spent,'55.00');
  assert.ok(!('excludedCurrencyTransactionCount' in summary));
  const history=await rpc('transaction_history_page',[{sort:'amount_desc'}]);
  assert.equal(history.totalMatchingEntries,3);assert.equal(history.entries[0].recordedAmount,'30.00');
  assert.ok(!('excludedCurrencyEntryCount' in history));assert.ok(history.entries.every(e=>!('currency' in e)));
  const otherHistory=await rpc('transaction_history_page',[{}],other);assert.equal(otherHistory.entries.length,0);
  // Invalid imported money remains excluded only in amount mode, and is counted separately.
  await db.queryAdmin("INSERT INTO public.transactions(user_id,account_id,type,amount,date) VALUES($1,$2,'expense','NaN','2026-10-15')",[owner,cash]);
  const invalid=await rpc('transaction_history_page',[{sort:'amount_desc'}]);assert.equal(invalid.invalidAmountEntryCount,1);assert.equal(invalid.totalMatchingEntries,3);
  await assert.rejects(rpc('spending_summary',['2026-10-01','2026-10-31']),/INVALID_AMOUNT/);
});


test('amount history preserves owner-joined account provenance and same-row filters',async () => {
  const foreign=(await asUser(other,"INSERT INTO public.accounts(user_id,name,type,balance) VALUES($1,'Private','bank',0) RETURNING id",[other]))[0].id;
  const bad=randomUUID();
  await db.queryAdmin("INSERT INTO public.transactions(id,user_id,account_id,type,amount,date,description) VALUES($1,$2,$3,'expense',12,'2026-10-15','orphan-provenance')",[bad,owner,foreign]);
  assert.equal((await rpc('transaction_history_page',[{search:'orphan-provenance'}])).totalMatchingEntries,1);
  assert.equal((await rpc('transaction_history_page',[{search:'orphan-provenance',sort:'amount_desc'}])).totalMatchingEntries,0);
  const group=randomUUID();
  await db.queryAdmin("INSERT INTO public.financial_operations(id,user_id,request_id,command_hash,command) VALUES($1,$2,$1,$3,'{}')",[group,owner,'0'.repeat(64)]);
  await db.queryAdmin("INSERT INTO public.transactions(user_id,account_id,type,amount,date,description,installment_group_id) VALUES($1,$2,'expense',0.10,'2026-10-01','needle',$3),($1,$2,'expense',0.20,'2026-11-01','sibling',$3)",[owner,cash,group]);
  assert.equal((await rpc('transaction_history_page',[{search:'needle',start:'2026-11-01',end:'2026-11-01'}])).totalMatchingEntries,0);
  const page=await rpc('transaction_history_page',[{search:'needle',minAmount:'0.30',sort:'amount_desc'}]);
  assert.equal(page.totalMatchingEntries,1);assert.equal(page.entries[0].recordedAmount,'0.30');assert.equal(page.entries[0].rows.length,2);assert.equal(page.entries[0].matchingRowIds.length,1);
});
