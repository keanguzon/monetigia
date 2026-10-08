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
const apply = (f, command, request = randomUUID(), quote = null) => f.owner.client.rpc('goal_finance_apply', {
  p_request_id: request, p_command: command, p_quote: quote,
});
async function state(f) {
  const snapshot = requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
  return {
    goal: snapshot.goals.find(row => row.goalId === f.owner.goal.id),
    wallet: snapshot.wallets.find(row => row.accountId === f.owner.account.id),
  };
}
function assertMoney(current, actual, reserved, spent) {
  assert.equal(current.wallet.actual, actual);
  assert.equal(current.wallet.reserved, reserved);
  assert.equal(current.wallet.available, (Number(actual) - Number(reserved)).toFixed(2));
  assert.equal(current.goal.reserved, reserved);
  assert.equal(current.goal.spent, spent);
  assert.equal(current.goal.progressAmount, (Number(reserved) + Number(spent)).toFixed(2));
}
const reserve = f => apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '3000.00' });
async function spend(f, request = randomUUID()) {
  const draft = {
    type: 'expense', accountId: f.owner.account.id, transferToAccountId: null,
    categoryId: null, goalId: f.owner.goal.id, amount: '2000.00',
    description: 'Final migration cash acceptance', date: '2026-10-01',
    installments: null, reservationMoves: [],
  };
  const quote = requireSuccess(await f.owner.client.rpc('goal_transaction_quote', { p_draft: draft }));
  const command = { kind: 'transaction', draft };
  const result = requireSuccess(await apply(f, command, request, quote));
  return { result, replay: () => apply(f, command, request, quote) };
}
async function events(f) {
  return requireSuccess(await f.owner.client.from('goal_allocation_events').select('*').eq('goal_id', f.owner.goal.id).order('id'));
}

test('final migration reserves cash and spends once; active expense deletion restores cash and reservation', async t => {
  const f = await setup(t);
  requireSuccess(await reserve(f));
  assertMoney(await state(f), '30000.00', '3000.00', '0.00');
  const purchase = await spend(f);
  assertMoney(await state(f), '28000.00', '1000.00', '2000.00');
  const spentEvents = await events(f);
  assert.equal(spentEvents.filter(row => row.kind === 'spend').length, 1);
  assert.deepEqual(spentEvents.filter(row => row.kind === 'spend').map(row => [row.reserved_delta, row.spent_delta]), [[-2000, 2000]]);
  assert.equal(requireSuccess(await purchase.replay()).replayed, true);
  assertMoney(await state(f), '28000.00', '1000.00', '2000.00');
  assert.deepEqual(await events(f), spentEvents);

  const command = { kind: 'delete_transaction', transactionId: purchase.result.transactionIds[0] };
  const request = randomUUID();
  requireSuccess(await apply(f, command, request));
  const restored = await state(f);
  assertMoney(restored, '30000.00', '3000.00', '0.00');
  assert.equal(restored.goal.status, 'active');
  assert.deepEqual(requireSuccess(await f.owner.client.from('transactions').select('id').eq('user_id', f.owner.id)), []);
  const restoredEvents = await events(f);
  assert.deepEqual(restoredEvents.filter(row => row.kind === 'reversal').map(row => [row.reserved_delta, row.spent_delta]), [[2000, -2000]]);
  assert.equal(requireSuccess(await apply(f, command, request)).replayed, true);
  assert.deepEqual(await state(f), restored);
  assert.deepEqual(await events(f), restoredEvents);
});

test('final migration completion releases leftovers; completed expense deletion restores cash and explicit reopen stays unreserved', async t => {
  const f = await setup(t);
  requireSuccess(await reserve(f));
  const purchase = await spend(f);
  requireSuccess(await apply(f, { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: { mode: 'release' } }));
  const completed = await state(f);
  assertMoney(completed, '28000.00', '0.00', '2000.00');
  assert.equal(completed.goal.status, 'completed');
  assert.equal(completed.goal.is_completed, true);
  assert.ok(completed.goal.completed_at);

  requireSuccess(await apply(f, { kind: 'delete_transaction', transactionId: purchase.result.transactionIds[0] }));
  const deleted = await state(f);
  assertMoney(deleted, '30000.00', '0.00', '0.00');
  assert.equal(deleted.goal.status, 'completed');
  assert.equal(deleted.goal.is_completed, true);
  assert.equal(deleted.goal.completed_at, completed.goal.completed_at);
  assert.deepEqual(deleted.goal.walletReservations, []);
  assert.deepEqual((await events(f)).filter(row => row.kind === 'reversal').map(row => [row.reserved_delta, row.spent_delta]), [[0, -2000]]);

  const command = { kind: 'reopen', goalId: f.owner.goal.id }, request = randomUUID();
  requireSuccess(await apply(f, command, request));
  const reopened = await state(f);
  assertMoney(reopened, '30000.00', '0.00', '0.00');
  assert.equal(reopened.goal.status, 'active');
  assert.equal(reopened.goal.is_completed, false);
  assert.equal(reopened.goal.completed_at, null);
  assert.equal(reopened.goal.archived_at, null);
  assert.deepEqual(reopened.goal.walletReservations, []);
  assert.equal(requireSuccess(await apply(f, command, request)).replayed, true);
  assert.deepEqual(await state(f), reopened);
});

test('final chronological state keeps debt event storage owner-readable and the account adapter private', async () => {
  await installLatestMigrations();
  const { queryAdmin } = await databaseRuntime();
  const [paymentIntegration] = await queryAdmin(`SELECT
    pg_get_functiondef('public.goal_transaction_quote(jsonb,jsonb)'::regprocedure) AS quote_definition,
    pg_get_functiondef('public.goal_transaction_apply(uuid,jsonb,jsonb)'::regprocedure) AS apply_definition,
    (SELECT count(*)::integer FROM pg_trigger WHERE tgname='debt_settlement_payment_delete_reverse' AND NOT tgisinternal) AS delete_trigger_count`);
  assert.ok(paymentIntegration.quote_definition.includes('debt_account_state'));
  assert.ok(paymentIntegration.quote_definition.includes('totalOutstanding'));
  assert.ok(paymentIntegration.apply_definition.includes('debt_settlement_events'));
  assert.equal(paymentIntegration.delete_trigger_count, 1);
  const [helper] = await queryAdmin(`SELECT p.prosecdef,p.proconfig,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='debt_account_state'`);
  assert.equal(helper.prosecdef, true);
  assert.ok(helper.proconfig.includes('search_path=pg_catalog, public'));
  assert.deepEqual([helper.authenticated, helper.anon, helper.service, helper.public_execute], [false, false, false, false]);
  for (const table of ['debt_settlement_events', 'debt_correction_events']) {
    const [permissions] = await queryAdmin(`SELECT relrowsecurity AS rls,
      has_table_privilege('authenticated',oid,'SELECT') AS select_allowed,
      has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') AS write_allowed,
      has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_allowed,
      has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE') AS service_allowed
      FROM pg_class WHERE oid='public.${table}'::regclass`);
    assert.deepEqual(permissions, { rls: true, select_allowed: true, write_allowed: false, anon_allowed: false, service_allowed: false });
    assert.deepEqual(await queryAdmin(`SELECT cmd,roles::text AS roles FROM pg_policies WHERE schemaname='public' AND tablename='${table}'`),
      [{ cmd: 'SELECT', roles: '{authenticated}' }]);
  }
});
