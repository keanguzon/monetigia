import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';
before(async () => {
    try {
        await applyMigration('202610060004_goal_transaction_operations.sql');
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
    }
    const { admin } = await databaseRuntime();
    for (let i = 0; i < 50; i++) {
        const r = await admin.rpc('goal_transaction_quote', { p_draft: {} });
        if (r.error?.code !== 'PGRST202')
            return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Quote schema readiness timeout');
});
async function setup(t) {
    const f = await createFinanceFixture();
    t.after(() => cleanupFinanceFixture(f));
    return f;
}
const apply = (f, c, q = null, id = randomUUID()) => f.owner.client.rpc('goal_finance_apply', { p_request_id: id, p_command: c, p_quote: q });
const draft = (f, o = {}) => ({
    type: 'expense', accountId: f.owner.account.id, transferToAccountId: null, categoryId: null, goalId: null, amount: '28000.00', description: null, date: '2026-10-01', installments: null, reservationMoves: [], ...o
});
const quote = (f, d, r = null) => f.owner.client.rpc('goal_transaction_quote', { p_draft: d, p_releases: r });
const snap = async (f) => requireSuccess(await f.owner.client.rpc('goal_finance_snapshot'));
async function reserve(f, amount = '5000.00', goalId = f.owner.goal.id) {
    requireSuccess(await apply(f, {
        kind: 'reserve', goalId, accountId: f.owner.account.id, amount
    }));
}
async function rows(f) {
    return Promise.all(['accounts', 'financial_operations', 'goal_allocation_events', 'transactions'].map(async (table) => requireSuccess(await f.admin.from(table).select('*').eq('user_id', f.owner.id).order('id'))));
}
async function save(f, d) {
    const q = requireSuccess(await quote(f, d));
    return requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q));
}
test('confirmed overspend releases only its shortfall', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const d = draft(f);
    const initial = await rows(f);
    const q = requireSuccess(await quote(f, d));
    assert.equal(q.releases[0].amount, '3000.00');
    assert.deepEqual(await rows(f), initial);
    assert.equal((await apply(f, { kind: 'transaction', draft: d })).error?.message, 'INVALID_STATE');
    const id = randomUUID();
    const result = requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id));
    const s = await snap(f);
    const w = s.wallets.find(w => w.accountId === f.owner.account.id);
    assert.equal(w.actual, '2000.00');
    assert.equal(w.reserved, '2000.00');
    assert.equal(w.available, '0.00');
    assert.equal(s.goals[0].spent, '0.00');
    const tx = (await rows(f))[3];
    assert.equal(tx.length, 1);
    assert.equal(tx[0].amount, 28000);
    assert.equal(requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id)).operationId, result.operationId);
});
test('goal expense consumes its own reservation and income has no allocation', async (t) => {
    const f = await setup(t);
    await reserve(f);
    await save(f, draft(f, { goalId: f.owner.goal.id, amount: '1000.00' }));
    let s = await snap(f);
    assert.equal(s.goals[0].reserved, '4000.00');
    assert.equal(s.goals[0].spent, '1000.00');
    assert.equal(s.wallets[0].actual, '29000.00');
    await save(f, draft(f, { type: 'income', amount: '1000.00' }));
    s = await snap(f);
    assert.equal(s.goals[0].spent, '1000.00');
    assert.equal(s.wallets[0].actual, '30000.00');
    assert.equal((await quote(f, draft(f, { type: 'income', goalId: f.owner.goal.id }))).error?.message, 'INVALID_STATE');
    assert.equal((await quote(f, draft(f, { goalId: f.owner.goal.id, amount: '5000.00' }))).error?.message, 'INSUFFICIENT_RESERVATION');
});
test('cash transfer carries backing and preserves progress', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const dst = requireSuccess(await f.owner.client.from('accounts').insert({
        user_id: f.owner.id, name: 'Bank', type: 'bank', balance: 0
    }).select().single());
    const d = draft(f, {
        type: 'transfer', amount: '5000.00', transferToAccountId: dst.id, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5000.00' }]
    });
    await save(f, d);
    const s = await snap(f);
    assert.equal(s.goals[0].progressAmount, '5000.00');
    assert.equal(s.goals[0].spent, '0.00');
    assert.deepEqual(s.goals[0].walletReservations, [{ accountId: dst.id, amount: '5000.00' }]);
    assert.equal((await rows(f))[3].length, 1);
    assert.equal((await quote(f, { ...d, reservationMoves: [{ goalId: f.owner.goal.id, amount: '5001.00' }] })).error?.message, 'INSUFFICIENT_RESERVATION');
});
test('custom release must match exact shortfall from paying wallet', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const g = requireSuccess(await f.owner.client.from('goals').insert({
        user_id: f.owner.id, name: 'Trip', target_amount: 10000, is_priority: true
    }).select().single());
    await reserve(f, '5000.00', g.id);
    const d = draft(f, { amount: '23000.00' });
    const q = requireSuccess(await quote(f, d));
    assert.equal(q.releases[0].goalId, f.owner.goal.id);
    const custom = [{ goalId: g.id, accountId: f.owner.account.id, amount: '3000.00' }];
    requireSuccess(await quote(f, d, custom));
    for (const r of [[{ ...custom[0], amount: '3001.00' }], [{ ...custom[0], accountId: f.other.account.id }], [{ ...custom[0], goalId: f.other.goal.id }]])
        assert.ok((await quote(f, d, r)).error);
    assert.equal((await quote(f, draft(f, { amount: '30001.00' }))).error?.message, 'INSUFFICIENT_ACTUAL');
});
test('stale funds and ordering metadata roll back every write', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const d = draft(f);
    let q = requireSuccess(await quote(f, d));
    await reserve(f, '1.00');
    let baseline = await rows(f);
    assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'STALE_QUOTE');
    assert.deepEqual(await rows(f), baseline);
    q = requireSuccess(await quote(f, d));
    requireSuccess(await f.owner.client.from('goals').update({ is_priority: true }).eq('id', f.owner.goal.id));
    baseline = await rows(f);
    assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'STALE_QUOTE');
    assert.deepEqual(await rows(f), baseline);
});
test('foreign references and insert failure preserve balances events and operations', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const cat = requireSuccess(await f.other.client.from('categories').insert({ user_id: f.other.id, name: 'Private', type: 'expense' }).select().single());
    assert.equal((await quote(f, draft(f, { categoryId: cat.id }))).error?.message, 'NOT_ALLOWED');
    assert.equal((await quote(f, draft(f, { accountId: f.other.account.id }))).error?.message, 'NOT_ALLOWED');
    const d = draft(f);
    const q = requireSuccess(await quote(f, d));
    const baseline = await rows(f);
    const { queryAdmin } = await databaseRuntime();
    await queryAdmin(`CREATE OR REPLACE FUNCTION public.test_reject_transaction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${f.owner.id}'::uuid THEN RAISE EXCEPTION 'forced insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_transaction BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.test_reject_transaction();`);
    try {
        assert.equal((await apply(f, { kind: 'transaction', draft: d }, q)).error?.message, 'forced insert failure');
        assert.deepEqual(await rows(f), baseline);
    }
    finally {
        await queryAdmin('DROP TRIGGER test_reject_transaction ON public.transactions; DROP FUNCTION public.test_reject_transaction()');
    }
});
test('simultaneous reserve and expense serialize without overbooking', async (t) => {
    const f = await setup(t);
    const d = draft(f);
    const q = requireSuccess(await quote(f, d));
    const transactionRequestId = randomUUID();
    const reserveRequestId = randomUUID();
    const [transactionResult, reserveResult] = await Promise.all([
        apply(f, { kind: 'transaction', draft: d }, q, transactionRequestId),
        apply(f, { kind: 'reserve', goalId: f.owner.goal.id, accountId: f.owner.account.id, amount: '5000.00' }, null, reserveRequestId),
    ]);
    assert.equal(Number(!transactionResult.error) + Number(!reserveResult.error), 1);
    const persisted = await rows(f);
    const s = await snap(f);
    const wallet = s.wallets.find(w => w.accountId === f.owner.account.id);
    assert.ok(wallet);
    assert.equal(persisted[0].length, 1);

    if (!transactionResult.error) {
        const result = requireSuccess(transactionResult);
        assert.equal(reserveResult.error?.message, 'INSUFFICIENT_AVAILABLE');
        assert.equal(wallet.actual, '2000.00');
        assert.equal(wallet.reserved, '0.00');
        assert.equal(wallet.available, '2000.00');
        assert.equal(s.goals[0].reserved, '0.00');
        assert.equal(s.goals[0].spent, '0.00');
        assert.equal(persisted[1].length, 1);
        assert.equal(persisted[1][0].id, result.operationId);
        assert.equal(persisted[1][0].request_id, transactionRequestId);
        assert.equal(persisted[1][0].command.kind, 'transaction');
        assert.deepEqual(result.transactionIds, persisted[3].map(tx => tx.id));
        assert.equal(result.transactionIds.length, 1);
        assert.equal(persisted[3][0].amount, 28000);
        assert.equal(persisted[3][0].account_id, f.owner.account.id);
        assert.equal(persisted[3][0].type, 'expense');
        assert.equal(persisted[2].length, 0);
        assert.equal(persisted[1].some(op => op.request_id === reserveRequestId), false);
    }
    else {
        assert.equal(transactionResult.error.message, 'STALE_QUOTE');
        const result = requireSuccess(reserveResult);
        assert.equal(wallet.actual, '30000.00');
        assert.equal(wallet.reserved, '5000.00');
        assert.equal(wallet.available, '25000.00');
        assert.equal(s.goals[0].reserved, '5000.00');
        assert.equal(s.goals[0].spent, '0.00');
        assert.equal(persisted[1].length, 1);
        assert.equal(persisted[1][0].id, result.operationId);
        assert.equal(persisted[1][0].request_id, reserveRequestId);
        assert.deepEqual(result.transactionIds, []);
        assert.equal(persisted[2].length, 1);
        assert.equal(persisted[2][0].operation_id, result.operationId);
        assert.equal(persisted[2][0].goal_id, f.owner.goal.id);
        assert.equal(persisted[2][0].account_id, f.owner.account.id);
        assert.equal(persisted[2][0].kind, 'reserve');
        assert.equal(persisted[2][0].reserved_delta, 5000);
        assert.equal(persisted[2][0].spent_delta, 0);
        assert.equal(persisted[2][0].transaction_id, null);
        assert.equal(persisted[3].length, 0);
        assert.equal(persisted[1].some(op => op.request_id === transactionRequestId), false);
        assert.equal(persisted[2].some(event => event.operation_id === transactionResult.data?.operationId), false);
    }
});
test('credit installments distribute centavos and book debt once; debt goal payment spends once', async (t) => {
    const f = await setup(t);
    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
    }).select().single());
    const d = draft(f, { accountId: credit.id, amount: '1000.01', installments: { count: 3 } });
    const result = await save(f, d);
    assert.equal(result.transactionIds.length, 3);
    const tx = (await rows(f))[3];
    assert.deepEqual(tx.sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.amount, t.date]), [[333.34, '2026-10-01'], [333.34, '2026-11-01'], [333.33, '2026-12-01']]);
    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 1000.01);
    assert.deepEqual(requireSuccess(await quote(f, { ...d, goalId: f.owner.goal.id })).releases, []);
    requireSuccess(await f.owner.client.from('goals').update({ category: 'debt' }).eq('id', f.owner.goal.id));
    await reserve(f);
    await save(f, draft(f, {
        type: 'transfer', amount: '333.34', transferToAccountId: credit.id, goalId: f.owner.goal.id
    }));
    const s = await snap(f);
    assert.equal(s.goals[0].spent, '333.34');
    assert.equal(s.goals[0].reserved, '4666.66');
    assert.equal((await quote(f, draft(f, { type: 'transfer', amount: '1.00', transferToAccountId: credit.id }))).error?.message, 'INVALID_STATE');
});
test('equivalent normalized requests replay across release ordering and UUID casing', async (t) => {
    const f = await setup(t);
    await reserve(f, '5000.00');
    const g = requireSuccess(await f.owner.client.from('goals').insert({ user_id: f.owner.id, name: 'Trip', target_amount: 5000 }).select().single());
    await reserve(f, '5000.00', g.id);
    const d = draft(f);
    const q = requireSuccess(await quote(f, d));
    assert.equal(q.releases.length, 2);
    const id = randomUUID();
    const result = requireSuccess(await apply(f, { kind: 'transaction', draft: d }, q, id));
    const before = await rows(f);
    const retry = { ...q, releases: [...q.releases].reverse().map(r => ({ ...r, goalId: r.goalId.toUpperCase(), accountId: r.accountId.toUpperCase() })) };
    const replay = requireSuccess(await apply(f, { kind: 'transaction', draft: { ...d, accountId: d.accountId.toUpperCase() } }, retry, id));
    assert.equal(replay.operationId, result.operationId);
    assert.equal(replay.replayed, true);
    assert.deepEqual(await rows(f), before);
    assert.equal((await apply(f, { kind: 'transaction', draft: { ...d, amount: '27999.00' } }, q, id)).error?.message, 'REQUEST_CONFLICT');
});
test('authentication expiry and private helper grants prevent writes', async (t) => {
    const f = await setup(t);
    const { adapter, url, options, queryAdmin } = await databaseRuntime();
    const { createClient } = await import('@supabase/supabase-js');
    const baseline = await rows(f);
    const expired = adapter?.signTestJwt ? adapter.signTestJwt({ sub: f.owner.id, role: 'authenticated', exp: 1 }) : 'expired';
    const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, { ...options, global: { headers: { Authorization: `Bearer ${expired}` } } });
    assert.ok((await client.rpc('goal_transaction_quote', { p_draft: draft(f) })).error);
    assert.ok((await client.rpc('goal_finance_apply', { p_request_id: randomUUID(), p_command: { kind: 'transaction', draft: draft(f) }, p_quote: {} })).error);
    assert.deepEqual(await rows(f), baseline);
    const permissions = await queryAdmin("SELECT p.proname,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('goal_normalize_transaction','goal_reservation_apply')");
    assert.equal(permissions.length, 2);
    for (const p of permissions) {
        assert.equal(p.authenticated, false);
        assert.equal(p.anon, false);
        assert.equal(p.service, false);
    }
});
test('invalid boundaries, carrying excess transfer, and other credit goal transfers fail without writes', async (t) => {
    const f = await setup(t);
    await reserve(f);
    const bank = requireSuccess(await f.owner.client.from('accounts').insert({
        user_id: f.owner.id, name: 'Bank', type: 'bank', balance: 0
    }).select().single());
    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
    }).select().single());
    const baseline = await rows(f);
    for (const o of [{ amount: 1000 }, { amount: '01.00' }, { amount: '1.001' }, { date: '2026-02-30' }, { installments: { count: 13 } }, {
            type: 'transfer', transferToAccountId: bank.id, amount: '1000.00', reservationMoves: [{ goalId: f.owner.goal.id, amount: '1001.00' }]
        }, { type: 'transfer', transferToAccountId: credit.id, goalId: f.owner.goal.id }, {
            type: 'transfer', accountId: credit.id, transferToAccountId: bank.id, goalId: f.owner.goal.id
        }, { accountId: credit.id, installments: { count: 12 }, amount: '0.01' }])
        assert.ok((await quote(f, draft(f, o))).error);
    for (const kind of ['close', 'archive', 'delete_transaction', 'adopt_legacy'])
        assert.equal((await apply(f, { kind })).error?.message, 'INVALID_STATE');
    assert.deepEqual(await rows(f), baseline);
});
test('credit signs and negative month credits carry forward authoritatively', async (t) => {
    const f = await setup(t);
    const credit = requireSuccess(await f.owner.client.from('accounts').insert({
        user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0
    }).select().single());
    await save(f, draft(f, { accountId: credit.id, amount: '1000.00', date: '2026-09-01' }));
    await save(f, draft(f, { accountId: credit.id, amount: '1000.00', date: '2026-10-01' }));
    await save(f, draft(f, {
        accountId: credit.id, type: 'income', amount: '1500.00', date: '2026-09-01'
    }));
    const baseline = await rows(f);
    assert.equal((await quote(f, draft(f, { type: 'transfer', transferToAccountId: credit.id, amount: '500.01' }))).error?.message, 'INVALID_STATE');
    assert.deepEqual(await rows(f), baseline);
    await save(f, draft(f, { type: 'transfer', transferToAccountId: credit.id, amount: '500.00' }));
    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 0);
    await save(f, draft(f, {
        type: 'transfer', accountId: credit.id, transferToAccountId: f.owner.account.id, amount: '10.00'
    }));
    const s = await snap(f);
    assert.equal(s.wallets.find(w => w.accountId === credit.id).actual, '10.00');
    assert.equal(s.wallets.find(w => w.accountId === f.owner.account.id).actual, '29510.00');
});

test('credit goal tags are informational for purchases and installments, replay and deletion invent no goal funds', async (t) => {
    const f = await setup(t);
    const credit = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'userPayLater', type: 'credit_card', balance: 0 }).select().single());
    const initial = await snap(f);
    const ordinary = draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '100.00' });
    const first = await save(f, ordinary);
    assert.equal(first.transactionIds.length, 1);
    const installmentDraft = draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '1000.01', installments: { count: 3 } });
    const q = requireSuccess(await quote(f, installmentDraft));
    const requestId = randomUUID();
    const command = { kind: 'transaction', draft: installmentDraft };
    const result = requireSuccess(await apply(f, command, q, requestId));
    assert.equal(result.transactionIds.length, 3);
    assert.equal(requireSuccess(await apply(f, command, q, requestId)).replayed, true);
    const persisted = await rows(f);
    assert.equal(persisted[3].length, 4);
    assert.ok(persisted[3].every(tx => tx.goal_id === f.owner.goal.id));
    assert.equal(persisted[2].length, 0);
    const after = await snap(f);
    assert.equal(after.goals[0].reserved, '0.00');
    assert.equal(after.goals[0].spent, '0.00');
    assert.equal(after.goals[0].progressAmount, '0.00');
    assert.deepEqual(after.wallets.find(wallet => wallet.accountId === f.owner.account.id), initial.wallets.find(wallet => wallet.accountId === f.owner.account.id));
    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 1100.01);
    const baseline = await rows(f);
    assert.equal((await quote(f, { ...ordinary, goalId: f.other.goal.id })).error?.message, 'NOT_ALLOWED');
    assert.equal((await quote(f, { ...ordinary, type: 'income' })).error?.message, 'INVALID_STATE');
    assert.equal((await quote(f, { ...ordinary, type: 'transfer', transferToAccountId: f.owner.account.id })).error?.message, 'INVALID_STATE');
    assert.deepEqual(await rows(f), baseline);
    await applyMigration('202610060005_goal_lifecycle_operations.sql');
    const transactionId = result.transactionIds[0];
    const deleteRequestId = randomUUID();
    const deletion = { kind: 'delete_transaction', transactionId };
    requireSuccess(await apply(f, deletion, null, deleteRequestId));
    assert.equal(requireSuccess(await apply(f, deletion, null, deleteRequestId)).replayed, true);
    const deleted = await rows(f);
    assert.equal(deleted[3].length, 3);
    assert.equal(deleted[2].length, 0);
    assert.equal(requireSuccess(await f.owner.client.from('accounts').select('*').eq('id', credit.id).single()).balance, 766.67);
    const final = await snap(f);
    assert.equal(final.goals[0].reserved, '0.00');
    assert.equal(final.goals[0].spent, '0.00');
    assert.equal(final.goals[0].progressAmount, '0.00');
});

test('ordered transaction and lifecycle reapplication refreshes the private helper; standalone lifecycle remains idempotent', async (t) => {
    const f = await setup(t);
    await applyMigration('202610060004_goal_transaction_operations.sql');
    await applyMigration('202610060005_goal_lifecycle_operations.sql');
    await applyMigration('202610060005_goal_lifecycle_operations.sql');
    const credit = requireSuccess(await f.owner.client.from('accounts').insert({ user_id: f.owner.id, name: 'Credit', type: 'credit_card', balance: 0 }).select().single());
    const result = await save(f, draft(f, { accountId: credit.id, goalId: f.owner.goal.id, amount: '1.00' }));
    assert.equal(result.transactionIds.length, 1);
    assert.equal((await rows(f))[2].length, 0);
    assert.equal((await snap(f)).goals[0].progressAmount, '0.00');
    requireSuccess(await apply(f, { kind: 'close', goalId: f.owner.goal.id, status: 'completed', leftovers: null }));
    assert.equal((await snap(f)).goals[0].status, 'completed');
    const { queryAdmin } = await databaseRuntime();
    const grants = await queryAdmin("SELECT has_function_privilege('authenticated','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS authenticated, has_function_privilege('anon','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS anon, has_function_privilege('service_role','public.goal_transaction_apply(uuid,jsonb,jsonb)','EXECUTE') AS service");
    assert.deepEqual(grants, [{ authenticated: false, anon: false, service: false }]);
});
