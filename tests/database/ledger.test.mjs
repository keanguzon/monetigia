import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanupFinanceFixture, createFinanceFixture, databaseRuntime, eventInput, insertOperation, requireSuccess } from './helpers.mjs';

let fixture;
before(async () => { fixture = await createFinanceFixture(); });
after(async () => { if (fixture) await cleanupFinanceFixture(fixture); });

test('owner-scoped allocation reads', async () => {
  const operation = await insertOperation(fixture);
  const inserted = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
  const ownerEvents = requireSuccess(await fixture.owner.client.from('goal_allocation_events').select('*').eq('id', inserted.id));
  const otherUserEvents = requireSuccess(await fixture.other.client.from('goal_allocation_events').select('*').eq('id', inserted.id));
  assert.equal(ownerEvents.length, 1);
  assert.equal(otherUserEvents.length, 0);
  const otherOperations = requireSuccess(await fixture.other.client.from('financial_operations').select('*').eq('id', operation.id));
  assert.equal(otherOperations.length, 0);
});

test('allocation references enforce the same owner', async () => {
  const operation = await insertOperation(fixture);
  const otherOperation = await insertOperation(fixture, fixture.other.id);
  for (const overrides of [{ goal_id: fixture.other.goal.id }, { account_id: fixture.other.account.id }, { operation_id: otherOperation.id }]) {
    const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, overrides));
    assert.equal(result.error?.code, '23503');
  }
});

test('invalid precision, zero values, and unknown kinds are rejected', async () => {
  const operation = await insertOperation(fixture);
  for (const overrides of [{ reserved_delta: '0.001' }, { spent_delta: '0.001' }, { reserved_delta: '10000000000000.00' }, { reserved_delta: '0.00' }, { reserved_delta: 'NaN' }, { kind: 'unknown' }]) {
    const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, overrides));
    assert.equal(result.error?.code, '23514', JSON.stringify(overrides));
  }
  const result = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { reserved_delta: '0.01' })).select().single();
  assert.equal(requireSuccess(result).reserved_delta, 0.01);
});

test('request IDs are unique per owner', async () => {
  const requestId = randomUUID();
  await insertOperation(fixture, fixture.owner.id, { request_id: requestId });
  const duplicate = await fixture.admin.from('financial_operations').insert({ user_id: fixture.owner.id, request_id: requestId, command_hash: 'a'.repeat(64), command: {} });
  assert.equal(duplicate.error?.code, '23505');
  await insertOperation(fixture, fixture.other.id, { request_id: requestId });
});

test('allocation writes are restricted and history is immutable', async () => {
  const operation = await insertOperation(fixture);
  const blocked = await fixture.owner.client.from('goal_allocation_events').insert(eventInput(fixture, operation));
  assert.equal(blocked.error?.code, '42501');
  const blockedOperation = await fixture.owner.client.from('financial_operations').insert({ user_id: fixture.owner.id, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: {} });
  assert.equal(blockedOperation.error?.code, '42501');
  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
  const update = await fixture.admin.from('goal_allocation_events').update({ reserved_delta: '20.00' }).eq('id', event.id);
  const deletion = await fixture.admin.from('goal_allocation_events').delete().eq('id', event.id);
  assert.equal(update.error?.code, '55000');
  assert.equal(deletion.error?.code, '55000');
  const accountDeletion = await fixture.admin.from('accounts').delete().eq('id', fixture.owner.account.id);
  assert.equal(accountDeletion.error?.code, '23503');
  const goalDeletion = await fixture.admin.from('goals').delete().eq('id', fixture.owner.goal.id);
  assert.equal(goalDeletion.error?.code, '23503');
});

test('transaction deletion retains the original event reference', async () => {
  const operation = await insertOperation(fixture);
  const transaction = requireSuccess(await fixture.admin.from('transactions').insert({ user_id: fixture.owner.id, account_id: fixture.owner.account.id, type: 'expense', amount: '10.00', date: '2026-10-06' }).select().single());
  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { kind: 'spend', reserved_delta: '-10.00', spent_delta: '10.00', transaction_id: transaction.id })).select().single());
  requireSuccess(await fixture.admin.from('transactions').delete().eq('id', transaction.id));
  const retained = requireSuccess(await fixture.owner.client.from('goal_allocation_events').select('*').eq('id', event.id).single());
  assert.equal(retained.transaction_id, transaction.id);
  const reversal = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, {
    kind: 'reversal', reserved_delta: '10.00', spent_delta: '-10.00', transaction_id: transaction.id, reversal_of: event.id,
  })).select().single());
  assert.equal(reversal.transaction_id, transaction.id);
  const invented = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: randomUUID() }));
  assert.equal(invented.error?.code, '23503');
  const otherTransaction = requireSuccess(await fixture.admin.from('transactions').insert({ user_id: fixture.other.id, account_id: fixture.other.account.id, type: 'expense', amount: '10.00', date: '2026-10-06' }).select().single());
  const wrongOwner = await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation, { transaction_id: otherTransaction.id }));
  assert.equal(wrongOwner.error?.code, '23503');
});

test('service role cannot truncate allocation history', async () => {
  const operation = await insertOperation(fixture);
  requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)));
  const before = requireSuccess(await fixture.admin.from('goal_allocation_events').select('*').order('id'));
  const { queryAdmin } = await databaseRuntime();
  let failure;
  try {
    // Either permission failure or the sentinel rolls back this single implicit transaction.
    await queryAdmin(`DO $$ BEGIN
      SET LOCAL ROLE service_role;
      TRUNCATE public.goal_allocation_events;
      RAISE EXCEPTION 'Allocation TRUNCATE unexpectedly succeeded' USING ERRCODE='P0001';
    END $$;`);
  } catch (error) { failure = error; }
  const after = requireSuccess(await fixture.admin.from('goal_allocation_events').select('*').order('id'));
  assert.deepEqual(after, before);
  const denied = failure?.code === '42501'
    || String(failure?.stderr).includes('permission denied for table goal_allocation_events');
  assert.equal(denied, true, failure?.message ?? 'TRUNCATE did not fail');
});

test('one event can be reversed once by the same owner', async () => {
  const operation = await insertOperation(fixture);
  const event = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, operation)).select().single());
  const reversal = eventInput(fixture, operation, { kind: 'reversal', reserved_delta: '-10.00', reversal_of: event.id });
  requireSuccess(await fixture.admin.from('goal_allocation_events').insert(reversal));
  assert.equal((await fixture.admin.from('goal_allocation_events').insert(reversal)).error?.code, '23505');
  const otherOp = await insertOperation(fixture, fixture.other.id);
  const otherEvent = requireSuccess(await fixture.admin.from('goal_allocation_events').insert(eventInput(fixture, otherOp, { user_id: fixture.other.id, goal_id: fixture.other.goal.id, account_id: fixture.other.account.id })).select().single());
  assert.equal((await fixture.admin.from('goal_allocation_events').insert({ ...reversal, reversal_of: otherEvent.id })).error?.code, '23503');
});

test('new goals default to confirmed active lifecycle', async () => {
  const goal = requireSuccess(await fixture.owner.client.from('goals').select('*').eq('id', fixture.owner.goal.id).single());
  assert.equal(goal.status, 'active');
  assert.equal(goal.review_state, 'confirmed');
  assert.equal(goal.completed_at, null);
  assert.equal(goal.archived_at, null);
});

test('upgrade preserves legacy finances', async () => {
  const { queryAdmin } = await databaseRuntime();
  // An isolated schema exercises first upgrade and reapplication without resetting public tables.
  const schema = `ledger_upgrade_${randomUUID().replaceAll('-', '')}`;
  const owner = fixture.owner.id;
  await queryAdmin(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.users (LIKE public.users INCLUDING ALL); INSERT INTO ${schema}.users SELECT * FROM public.users WHERE id='${owner}';`);
  try {
    const baseline = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../supabase/migrations/202610060001_runtime_baseline.sql', import.meta.url), 'utf8'));
    const ledger = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../supabase/migrations/202610060002_goal_allocation_ledger.sql', import.meta.url), 'utf8'));
    // The migration only uses explicit public references; rewrite them for this disposable schema.
    const inSchema = (sql) => sql.replaceAll('public.', `${schema}.`).replaceAll("'public'", `'${schema}'`).replaceAll('SCHEMA public', `SCHEMA ${schema}`);
    await queryAdmin(inSchema(baseline));
    await queryAdmin(`INSERT INTO ${schema}.accounts(id,user_id,name,type,balance) VALUES ('00000000-0000-0000-0000-000000000001','${owner}','Legacy wallet','cash',30000.37); INSERT INTO ${schema}.goals(id,user_id,name,target_amount,current_amount,is_completed) VALUES ('00000000-0000-0000-0000-000000000002','${owner}','Legacy completed',5000,2345.67,true); INSERT INTO ${schema}.transactions(user_id,account_id,goal_id,type,amount,date) VALUES ('${owner}','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','expense',123.45,'2026-10-06');`);
    const snapshot = async () => {
      const result = await queryAdmin(`SELECT jsonb_build_object('balances',(SELECT jsonb_agg(balance::text ORDER BY id) FROM ${schema}.accounts),'tags',(SELECT jsonb_agg(jsonb_build_object('goal_id',goal_id,'amount',amount::text) ORDER BY id) FROM ${schema}.transactions),'legacy',(SELECT jsonb_agg(jsonb_build_object('current_amount',current_amount::text,'is_completed',is_completed) ORDER BY id) FROM ${schema}.goals)) AS snapshot;`);
      if (!Array.isArray(result)) throw new Error('Upgrade test needs queryAdmin returning row arrays; use TEST_DATABASE_ADAPTER.');
      return result[0].snapshot;
    };
    const before = await snapshot();
    await queryAdmin(inSchema(baseline));
    assert.deepEqual(await snapshot(), before);
    await queryAdmin(inSchema(ledger));
    const after = await snapshot();
    assert.deepEqual(after.balances, before.balances);
    assert.deepEqual(after.tags, before.tags);
    assert.deepEqual(after.legacy, before.legacy);
    let rows = await queryAdmin(`SELECT review_state,status FROM ${schema}.goals;`);
    assert.deepEqual(rows, [{ review_state: 'needs_review', status: 'completed' }]);
    await queryAdmin(`UPDATE ${schema}.goals SET review_state='confirmed',status='cancelled';`);
    await queryAdmin(inSchema(ledger));
    rows = await queryAdmin(`SELECT review_state,status FROM ${schema}.goals;`);
    assert.deepEqual(rows, [{ review_state: 'confirmed', status: 'cancelled' }]);
    assert.deepEqual((await snapshot()).balances, before.balances);
    const events = await queryAdmin(`SELECT count(*)::int AS count FROM ${schema}.goal_allocation_events;`);
    assert.equal(events[0].count, 0);
  } finally { await queryAdmin(`DROP SCHEMA ${schema} CASCADE;`); }
});
