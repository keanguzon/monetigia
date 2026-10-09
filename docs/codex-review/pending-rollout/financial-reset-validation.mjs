import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const adminUrl = new URL(process.env.RESET_TEST_ADMIN_URL || '');
if (!['postgres:', 'postgresql:'].includes(adminUrl.protocol)
  || !['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname)
  || adminUrl.pathname !== '/postgres' || adminUrl.search !== '') throw new Error('Use a loopback PostgreSQL administrative URL ending in /postgres.');
if (!process.env.RESET_TEST_PG_MODULE || !process.env.RESET_TEST_BOOTSTRAP) throw new Error('Supply RESET_TEST_PG_MODULE and RESET_TEST_BOOTSTRAP from the local harness.');
const { default: pg } = await import(pathToFileURL(process.env.RESET_TEST_PG_MODULE));
const database = `reset_validation_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
let client;
let created = false;
const here = new URL('./', import.meta.url);
const root = new URL('../../../', here);
const resetTemplate = await readFile(new URL('financial-reset-owner.sql', here), 'utf8');
const tables = ['accounts', 'goals', 'categories', 'budgets', 'user_preferences', 'users',
  'transactions', 'financial_operations', 'goal_allocation_events', 'debt_items', 'debt_due_rows',
  'debt_settlement_events', 'debt_correction_events'];
const history = tables.slice(6);
const guardsSql = `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
async function snapshot() {
  const result = {};
  for (const table of tables) result[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows;
  result.auth = (await client.query('SELECT to_jsonb(t) AS row FROM auth.users t ORDER BY id')).rows;
  result.guards = (await client.query(guardsSql)).rows;
  result.schema = (await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
  result.functions = (await client.query(`SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,p.proacl::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY signature`)).rows;
  result.policies = (await client.query('SELECT * FROM pg_policies WHERE schemaname=\'public\' ORDER BY tablename,policyname')).rows;
  result.constraints = (await client.query("SELECT conrelid::regclass::text AS relation,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY relation,conname")).rows;
  return result;
}
async function expectAbort(sql, pattern) {
  await assert.rejects(() => client.query(sql), pattern);
  await client.query('ROLLBACK');
}
async function seed(owner) {
  const ids = Object.fromEntries(['cash', 'credit', 'goal', 'category', 'operation', 'purchase', 'payment', 'item', 'due', 'settlement', 'correction'].map(key => [key, randomUUID()]));
  await client.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [owner, `${owner}@example.test`, { username: `fixture_${owner}` }]);
  await client.query(`INSERT INTO public.accounts(id,user_id,name,type,balance) VALUES($1,$3,'Cash','cash',321),($2,$3,'Credit','credit_card',-80)`, [ids.cash, ids.credit, owner]);
  await client.query(`INSERT INTO public.goals(id,user_id,name,target_amount,current_amount,is_completed,status,review_state,completed_at,archived_at)
    VALUES($1,$2,'Preserved completed goal',500,17,true,'completed','needs_review',now(),now())`, [ids.goal, owner]);
  await client.query(`INSERT INTO public.categories(id,user_id,name,type) VALUES($1,$2,'Food','expense')`, [ids.category, owner]);
  await client.query(`INSERT INTO public.budgets(user_id,category_id,amount,start_date) VALUES($1,$2,50,'2026-10-01')`, [owner, ids.category]);
  await client.query(`INSERT INTO public.user_preferences(user_id,theme) VALUES($1,'dark') ON CONFLICT(user_id) DO UPDATE SET theme=EXCLUDED.theme`, [owner]);
  await client.query(`INSERT INTO public.financial_operations(id,user_id,request_id,command_hash,command,result,completed_at)
    VALUES($1,$2,$3,$4,'{"kind":"transaction"}','{}',now())`, [ids.operation, owner, randomUUID(), 'a'.repeat(64)]);
  await client.query(`INSERT INTO public.transactions(id,user_id,account_id,type,amount,date,goal_id,installment_group_id,purchase_date)
    VALUES($1,$3,$4,'expense',80,'2026-11-01',$6,$7,'2026-10-01'),($2,$3,$5,'transfer',10,'2026-10-02',NULL,NULL,NULL)`,
  [ids.purchase, ids.payment, owner, ids.credit, ids.cash, ids.goal, ids.operation]);
  await client.query(`INSERT INTO public.goal_allocation_events(user_id,goal_id,account_id,operation_id,kind,reserved_delta)
    VALUES($1,$2,$3,$4,'reserve',17)`, [owner, ids.goal, ids.cash, ids.operation]);
  await client.query(`INSERT INTO public.debt_items(id,user_id,account_id,operation_id,client_id,name,source,mode,original_amount,first_due_date,remaining_months)
    VALUES($1,$2,$3,$4,'fixture','Opening','opening','single',20,'2026-11-01',1)`, [ids.item, owner, ids.credit, ids.operation]);
  await client.query(`INSERT INTO public.debt_due_rows(id,user_id,debt_item_id,ordinal,due_date,original_amount)
    VALUES($1,$2,$3,1,'2026-11-01',20)`, [ids.due, owner, ids.item]);
  await client.query('BEGIN');
  try {
    await client.query(`ALTER TABLE public.debt_settlement_events DISABLE TRIGGER debt_settlement_validate;
      ALTER TABLE public.debt_correction_events DISABLE TRIGGER debt_correction_validate`);
    await client.query(`INSERT INTO public.debt_settlement_events(id,user_id,account_id,operation_id,amount,kind,payment_operation_id,payment_transaction_id,opening_due_row_id)
      VALUES($1,$2,$3,$4,10,'settlement',$4,$5,$6)`, [ids.settlement, owner, ids.credit, ids.operation, ids.payment, ids.due]);
    await client.query(`INSERT INTO public.debt_correction_events(id,user_id,account_id,operation_id,amount,purchase_transaction_id)
      VALUES($1,$2,$3,$4,5,$5)`, [ids.correction, owner, ids.credit, ids.operation, ids.purchase]);
    await client.query(`SET CONSTRAINTS ALL IMMEDIATE;
      ALTER TABLE public.debt_settlement_events ENABLE TRIGGER debt_settlement_validate;
      ALTER TABLE public.debt_correction_events ENABLE TRIGGER debt_correction_validate; COMMIT`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  return ids;
}
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${database}`;
  client = new pg.Client({ connectionString: isolatedUrl.href });
  await client.connect();
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, database);
  const bootstrap = (await readFile(process.env.RESET_TEST_BOOTSTRAP, 'utf8'))
    .replace(/^CREATE ROLE[^;]+;\s*$/gm, '').replace(/^GRANT anon, authenticated, service_role TO authenticator;\s*$/gm, '');
  assert.ok(!/CREATE ROLE|TO authenticator/i.test(bootstrap));
  await client.query(bootstrap);
  const migrationDir = new URL('supabase/migrations/', root);
  const migrations = (await readdir(migrationDir)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of migrations) await client.query((await readFile(new URL(name, migrationDir), 'utf8')).replace(/\r\n/g, '\n'));
  const owner = randomUUID();
  const other = randomUUID();
  const ownerIds = await seed(owner);
  const otherIds = await seed(other);
  await client.query("INSERT INTO public.categories(name,type,is_default) VALUES('Shared category','expense',true)");
  await client.query('ALTER TABLE public.goal_allocation_events ENABLE ALWAYS TRIGGER allocation_history_immutable');
  await client.query('ALTER TABLE public.debt_correction_events ENABLE REPLICA TRIGGER debt_correction_immutable');
  const before = await snapshot();
  const reset = resetTemplate.replace('REPLACE_WITH_EXPLICIT_OWNER_UUID', owner);
  assert.match(reset, /ROLLBACK;\s*$/);
  await expectAbort(resetTemplate, /invalid input syntax for type uuid/);
  await expectAbort(reset.replace(owner, randomUUID()), /Owner must exist/);
  await client.query('CREATE TABLE public.unreviewed_checkpoint(id uuid PRIMARY KEY)');
  await expectAbort(reset, /Unreviewed public tables/);
  await client.query('DROP TABLE public.unreviewed_checkpoint');
  await client.query(reset);
  assert.deepEqual(await snapshot(), before, 'complete dry-run restores all rows and catalog protection');
  const restoreMarker = 'DO $$ DECLARE v_guard record; BEGIN\n  FOR v_guard IN SELECT g.*';
  assert.ok(reset.includes(restoreMarker));
  await client.query(reset.slice(0, reset.indexOf(restoreMarker)));
  const disabled = (await client.query(guardsSql)).rows.filter(row => row.tgenabled === 'D');
  assert.equal(disabled.length, 3, 'only three immutable-history guards are disabled');
  await client.query('ROLLBACK');
  assert.deepEqual(await snapshot(), before, 'rollback before guard restore restores trigger DDL and rows');
  await expectAbort(reset.slice(0, reset.indexOf(restoreMarker)) + "DO $$ BEGIN RAISE EXCEPTION 'forced reset failure'; END $$;", /forced reset failure/);
  assert.deepEqual(await snapshot(), before, 'forced exception restores trigger modes and data');
  await client.query(reset.replace(/ROLLBACK;\s*$/, 'COMMIT;'));
  const after = await snapshot();
  for (const table of tables) {
    const ownerColumn = table === 'users' ? 'id' : 'user_id';
    assert.deepEqual(after[table].filter(({ row }) => row[ownerColumn] !== owner), before[table].filter(({ row }) => row[ownerColumn] !== owner), `${table}: other owners unchanged`);
    const ownedAfter = after[table].filter(({ row }) => row[ownerColumn] === owner);
    if (history.includes(table)) assert.equal(ownedAfter.length, 0, `${table}: owner history cleared`);
    else {
      const normalize = ({ row }) => Object.fromEntries(Object.entries(row).filter(([key]) => !((table === 'accounts' && key === 'balance') || (table === 'goals' && key === 'current_amount'))));
      assert.deepEqual(ownedAfter.map(normalize), before[table].filter(({ row }) => row[ownerColumn] === owner).map(normalize), `${table}: definitions preserved`);
      if (table === 'accounts') assert.ok(ownedAfter.every(({ row }) => row.balance === 0));
      if (table === 'goals') assert.ok(ownedAfter.every(({ row }) => row.current_amount === 0));
    }
  }
  for (const key of ['auth', 'guards', 'schema', 'functions', 'policies', 'constraints']) assert.deepEqual(after[key], before[key], `${key} preserved after commit`);
  await client.query(reset.replace(/ROLLBACK;\s*$/, 'COMMIT;'));
  assert.deepEqual(await snapshot(), after, 'committed reset replay is idempotent');
  await assert.rejects(() => client.query('DELETE FROM public.debt_settlement_events WHERE id=$1', [otherIds.settlement]), /append-only/);
  await client.query("BEGIN; SET LOCAL session_replication_role='replica'");
  await assert.rejects(() => client.query('DELETE FROM public.debt_correction_events WHERE id=$1', [otherIds.correction]), /append-only/);
  await client.query('ROLLBACK');
  await assert.rejects(() => client.query('DELETE FROM public.goal_allocation_events WHERE user_id=$1', [other]), /append-only/);
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [owner]);
  const goalSnapshot = (await client.query('SELECT public.goal_finance_snapshot() AS value')).rows[0].value;
  assert.ok(goalSnapshot.wallets.every(row => Number(row.actual) === 0 && Number(row.reserved) === 0 && Number(row.available) === 0));
  assert.ok(goalSnapshot.goals.every(row => Number(row.reserved) === 0 && Number(row.spent) === 0 && Number(row.progressAmount) === 0 && row.walletReservations.length === 0));
  assert.equal((await client.query("SELECT count(*)::integer AS total FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'reset_%'" )).rows[0].total, 0);
  await client.query('SET ROLE authenticated');
  async function transact(overrides) {
    const draft = { type: 'income', accountId: ownerIds.cash, transferToAccountId: null,
      categoryId: null, goalId: null, amount: '1000.00', description: 'Post-reset smoke',
      date: '2026-10-09', installments: null, reservationMoves: [], ...overrides };
    const quote = (await client.query('SELECT public.goal_transaction_quote($1::jsonb) AS value', [draft])).rows[0].value;
    await client.query('SELECT public.goal_finance_apply($1,$2::jsonb,$3::jsonb)',
      [randomUUID(), { kind: 'transaction', draft }, quote]);
  }
  await transact({});
  await transact({ type: 'expense', accountId: ownerIds.credit, amount: '100.00' });
  await transact({ type: 'transfer', transferToAccountId: ownerIds.credit, amount: '100.00' });
  const debtSnapshot = (await client.query('SELECT public.debt_snapshot() AS value')).rows[0].value;
  assert.ok(debtSnapshot.accounts.every(row => row.reconciliation === 'balanced' && Number(row.totalOutstanding) === 0));
  await client.query('RESET ROLE');
  assert.equal(Number((await client.query('SELECT balance FROM public.accounts WHERE id=$1', [ownerIds.cash])).rows[0].balance), 900);
  assert.equal(Number((await client.query('SELECT balance FROM public.accounts WHERE id=$1', [ownerIds.credit])).rows[0].balance), 0);
  console.log('PASS: owner-scoped commit, dry-run rollback, interrupted guard rollback, other-owner preservation, definitions and database protections, immutable guards and derived goal snapshot.');
  console.log('PASS: authenticated post-reset income, credit purchase and full debt payment; cash 900, credit debt 0, balanced debt snapshot.');
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  await admin.end();
}
