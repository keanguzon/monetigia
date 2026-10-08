import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

before(async () => {
  await applyMigration('202610060004_goal_transaction_operations.sql');
  await applyMigration('202610060005_goal_lifecycle_operations.sql');
  await applyMigration('202610080001_archived_goal_restore.sql');
});

async function setup(t) {
  const f = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(f));
  return f;
}

const applyFinance = (f, command, requestId = randomUUID(), quote = null) =>
  f.owner.client.rpc('goal_finance_apply', { p_request_id: requestId, p_command: command, p_quote: quote });
const restore = (client, requestId, goalId) =>
  client.rpc('goal_restore_archived', { p_request_id: requestId, p_goal_id: goalId });

async function archivedGoal(f, status) {
  requireSuccess(await applyFinance(f, {
    kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '3000.00',
  }));
  const draft = {
    type: 'expense', accountId: f.owner.account.id, transferToAccountId: null, categoryId: null,
    goalId: f.owner.goal.id, amount: '2000.00', description: null, date: '2026-10-01',
    installments: null, reservationMoves: [],
  };
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  requireSuccess(await applyFinance(f, { kind: 'transaction', draft }, randomUUID(), quote));
  requireSuccess(await applyFinance(f, {
    kind: 'close', goalId: f.owner.goal.id, status, leftovers: { mode: 'release' },
  }));
  const archive = requireSuccess(await applyFinance(f, { kind: 'archive', goalId: f.owner.goal.id }));
  return archive;
}

async function state(f) {
  const tables = ['goals', 'accounts', 'financial_operations', 'goal_allocation_events', 'transactions'];
  return Object.fromEntries(await Promise.all(tables.map(async table => [table,
    requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id')),
  ])));
}

async function goalRow(f, goalId = f.owner.goal.id) {
  return requireSuccess(await f.admin.from('goals').select('*').eq('user_id', f.owner.id).eq('id', goalId).single());
}

test('owner restore preserves completed status, spending, balances, and allocation history', async t => {
  const f = await setup(t);
  await archivedGoal(f, 'completed');
  const before = await state(f);
  const archived = before.goals.find(goal => goal.id === f.owner.goal.id);
  const accountBefore = before.accounts.find(account => account.id === f.owner.account.id);
  assert.ok(archived.archived_at);
  const requestId = randomUUID();

  const result = requireSuccess(await restore(f.owner.client, requestId, f.owner.goal.id));
  assert.deepEqual(result.transactionIds, []);
  assert.equal(result.replayed, false);
  assert.ok(result.operationId);

  const after = await state(f);
  const restored = after.goals.find(goal => goal.id === f.owner.goal.id);
  const accountAfter = after.accounts.find(account => account.id === f.owner.account.id);
  assert.equal(restored.archived_at, null);
  assert.equal(restored.status, 'completed');
  assert.equal(restored.is_completed, archived.is_completed);
  assert.equal(restored.completed_at, archived.completed_at);
  assert.equal(accountAfter.balance, accountBefore.balance);
  assert.deepEqual(after.transactions, before.transactions);
  assert.deepEqual(after.goal_allocation_events, before.goal_allocation_events);
  assert.equal(after.financial_operations.length, before.financial_operations.length + 1);
  for (const operation of before.financial_operations) {
    assert.deepEqual(after.financial_operations.find(row => row.id === operation.id), operation);
  }
  const restoreOperation = after.financial_operations.find(row => row.id === result.operationId);
  assert.deepEqual(restoreOperation.command, { kind: 'restore', goalId: f.owner.goal.id });
  assert.match(restoreOperation.command_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(restoreOperation.result, result);

  const snapshot = requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
  const snapshotGoal = snapshot.goals.find(goal => goal.goalId === f.owner.goal.id);
  assert.equal(snapshotGoal.spent, '2000.00');
  assert.equal(snapshotGoal.reserved, '0.00');
});

test('owner restore preserves cancelled status and null completion time', async t => {
  const f = await setup(t);
  await archivedGoal(f, 'cancelled');
  const archived = await goalRow(f);
  const result = requireSuccess(await restore(f.owner.client, randomUUID(), f.owner.goal.id));
  const restored = await goalRow(f);

  assert.equal(result.replayed, false);
  assert.equal(restored.archived_at, null);
  assert.equal(restored.status, 'cancelled');
  assert.equal(restored.completed_at, archived.completed_at);
  assert.equal(restored.is_completed, archived.is_completed);
  const snapshot = requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
  const snapshotGoal = snapshot.goals.find(goal => goal.goalId === f.owner.goal.id);
  assert.equal(snapshotGoal.spent, '2000.00');
  assert.equal(snapshotGoal.reserved, '0.00');
});

test('restore denies anonymous and cross-user callers without creating operations', async t => {
  const f = await setup(t);
  await archivedGoal(f, 'completed');
  const before = await state(f);
  const requestId = randomUUID();
  const { url, options } = await databaseRuntime();
  const anonymous = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);

  assert.equal((await restore(f.other.client, requestId, f.owner.goal.id)).error?.message, 'NOT_ALLOWED');
  assert.ok((await restore(anonymous, randomUUID(), f.owner.goal.id)).error);
  assert.deepEqual(await state(f), before);
});

test('restore is a pinned SECURITY DEFINER granted only to authenticated users', async () => {
  const { queryAdmin } = await databaseRuntime();
  const [functionInfo] = await queryAdmin(`
    SELECT p.prosecdef,p.proconfig,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service,
      EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ) AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='goal_restore_archived'
  `);

  assert.equal(functionInfo.prosecdef, true);
  assert.ok(functionInfo.proconfig.includes('search_path=pg_catalog, public'));
  assert.equal(functionInfo.authenticated, true);
  assert.equal(functionInfo.anon, false);
  assert.equal(functionInfo.service, false);
  assert.equal(functionInfo.public_execute, false);
});

test('restore rejects archived goals outside the confirmed closed states', async t => {
  const f = await setup(t);
  await archivedGoal(f, 'completed');
  const requestId = randomUUID();
  const operationCount = (await state(f)).financial_operations.length;

  requireSuccess(await f.admin.from('goals').update({ status: 'active', is_completed: false, completed_at: null })
    .eq('user_id', f.owner.id).eq('id', f.owner.goal.id));
  assert.equal((await restore(f.owner.client, requestId, f.owner.goal.id)).error?.message, 'INVALID_STATE');

  requireSuccess(await f.admin.from('goals').update({ status: 'completed', is_completed: true, review_state: 'needs_review' })
    .eq('user_id', f.owner.id).eq('id', f.owner.goal.id));
  assert.equal((await restore(f.owner.client, requestId, f.owner.goal.id)).error?.message, 'INVALID_STATE');

  const after = await state(f);
  assert.equal(after.financial_operations.length, operationCount);
  assert.ok(after.goals.find(goal => goal.id === f.owner.goal.id).archived_at);
});

test('same request replays its saved result after the goal is archived again', async t => {
  const f = await setup(t);
  await archivedGoal(f, 'completed');
  const requestId = randomUUID();
  const first = requireSuccess(await restore(f.owner.client, requestId, f.owner.goal.id));
  requireSuccess(await applyFinance(f, { kind: 'archive', goalId: f.owner.goal.id }));
  const beforeReplay = await state(f);

  const replay = requireSuccess(await restore(f.owner.client, requestId, f.owner.goal.id));
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.deepEqual(await state(f), beforeReplay);
  assert.ok((await goalRow(f)).archived_at);

  const secondGoal = requireSuccess(await f.owner.client.from('goals').insert({
    user_id: f.owner.id, name: 'Trip', target_amount: '10000.00',
  }).select().single());
  assert.equal((await restore(f.owner.client, requestId, secondGoal.id)).error?.message, 'REQUEST_CONFLICT');
});

test('restore rejects nonzero reservation totals on each account even when they cancel overall', async t => {
  const f = await setup(t);
  const archive = await archivedGoal(f, 'completed');
  const secondAccount = requireSuccess(await f.owner.client.from('accounts').insert({
    user_id: f.owner.id, name: 'Bank', type: 'bank', balance: '1000.00',
  }).select().single());
  requireSuccess(await f.admin.from('goal_allocation_events').insert([
    { user_id: f.owner.id, goal_id: f.owner.goal.id, account_id: f.owner.account.id, operation_id: archive.operationId, kind: 'reserve', reserved_delta: '1.00', spent_delta: '0.00' },
    { user_id: f.owner.id, goal_id: f.owner.goal.id, account_id: secondAccount.id, operation_id: archive.operationId, kind: 'release', reserved_delta: '-1.00', spent_delta: '0.00' },
  ]));
  const before = await state(f);

  assert.equal((await restore(f.owner.client, randomUUID(), f.owner.goal.id)).error?.message, 'INVALID_STATE');
  assert.deepEqual(await state(f), before);
  assert.ok((await goalRow(f)).archived_at);
});
