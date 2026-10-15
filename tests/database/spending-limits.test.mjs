import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { applyMigration, cleanupFinanceFixture, createFinanceFixture, databaseRuntime, requireSuccess } from './helpers.mjs';

const migration = '202610140002_spending_limits.sql';
before(async () => {
  await applyMigration(migration);
  await new Promise(resolve => setTimeout(resolve, 400));
});

async function setup(t) {
  const fixture = await createFinanceFixture();
  t.after(() => cleanupFinanceFixture(fixture));
  return fixture;
}

function limitInput(userId, overrides = {}) {
  return { user_id: userId, amount: '25000.00', cadence: 'month', ...overrides };
}

async function migrationSnapshot(queryAdmin) {
  const [columns] = await queryAdmin(`SELECT json_agg(json_build_object(
      'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin,d.adrelid)
    ) ORDER BY a.attnum) AS value
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.spending_limits'::regclass AND a.attnum > 0 AND NOT a.attisdropped`);
  const [constraints] = await queryAdmin(`SELECT json_agg(json_build_object('name', conname, 'definition', pg_get_constraintdef(oid)) ORDER BY conname) AS value
    FROM pg_constraint WHERE conrelid='public.spending_limits'::regclass`);
  const [policies] = await queryAdmin(`SELECT json_agg(json_build_object('name', policyname, 'command', cmd, 'roles', roles, 'using', qual, 'check', with_check) ORDER BY policyname) AS value
    FROM pg_policies WHERE schemaname='public' AND tablename='spending_limits'`);
  const [table] = await queryAdmin(`SELECT c.relrowsecurity AS rls,
      json_build_object(
        'authenticated', json_build_object('select', has_table_privilege('authenticated',c.oid,'SELECT'), 'insert', has_table_privilege('authenticated',c.oid,'INSERT'), 'update', has_table_privilege('authenticated',c.oid,'UPDATE'), 'delete', has_table_privilege('authenticated',c.oid,'DELETE')),
        'anon', json_build_object('select', has_table_privilege('anon',c.oid,'SELECT'), 'insert', has_table_privilege('anon',c.oid,'INSERT'), 'update', has_table_privilege('anon',c.oid,'UPDATE'), 'delete', has_table_privilege('anon',c.oid,'DELETE')),
        'service_role', json_build_object('select', has_table_privilege('service_role',c.oid,'SELECT'), 'insert', has_table_privilege('service_role',c.oid,'INSERT'), 'update', has_table_privilege('service_role',c.oid,'UPDATE'), 'delete', has_table_privilege('service_role',c.oid,'DELETE')),
        'public', EXISTS (SELECT 1 FROM aclexplode(c.relacl) acl WHERE acl.grantee=0)
      ) AS grants
    FROM pg_class c WHERE c.oid='public.spending_limits'::regclass`);
  const [trigger] = await queryAdmin(`SELECT pg_get_triggerdef(t.oid) AS definition, t.tgenabled AS enabled,
      replace(p.prosrc,E'\\r\\n',E'\\n') AS function_source, p.prosecdef AS security_definer, p.proconfig AS config
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.spending_limits'::regclass AND NOT t.tgisinternal`);
  return { columns: columns.value, constraints: constraints.value, policies: policies.value, table, trigger };
}

test('owner can create, update and delete their one spending limit', async t => {
  const f = await setup(t);
  const created = requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id)).select().single());
  assert.equal(created.user_id, f.owner.id);
  assert.equal(created.amount, 25000);
  assert.equal(created.cadence, 'month');
  assert.ok(created.created_at);
  assert.equal(created.updated_at, created.created_at);

  const duplicate = await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { amount: '100.00' }));
  assert.ok(duplicate.error);

  await new Promise(resolve => setTimeout(resolve, 2));
  const updated = requireSuccess(await f.owner.client.from('spending_limits').update({ amount: '30000.50', cadence: 'cutoff' }).eq('user_id', f.owner.id).select().single());
  assert.equal(updated.amount, 30000.5);
  assert.equal(updated.cadence, 'cutoff');
  assert.ok(Date.parse(updated.updated_at) > Date.parse(created.updated_at));

  requireSuccess(await f.owner.client.from('spending_limits').delete().eq('user_id', f.owner.id));
  assert.deepEqual(requireSuccess(await f.owner.client.from('spending_limits').select()), []);
});

test('another user and anon cannot read or write the owner limit', async t => {
  const f = await setup(t);
  requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id)));

  assert.deepEqual(requireSuccess(await f.other.client.from('spending_limits').select()), []);
  requireSuccess(await f.other.client.from('spending_limits').update({ amount: '1.00' }).eq('user_id', f.owner.id));
  requireSuccess(await f.other.client.from('spending_limits').delete().eq('user_id', f.owner.id));
  const foreignInsert = await f.other.client.from('spending_limits').insert(limitInput(f.owner.id));
  assert.equal(foreignInsert.error?.code, '42501');
  const ownerRow = requireSuccess(await f.owner.client.from('spending_limits').select().single());
  assert.equal(ownerRow.amount, 25000);

  const { url, options, queryAdmin } = await databaseRuntime();
  const anon = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
  assert.ok((await anon.from('spending_limits').select()).error);
  assert.ok((await anon.from('spending_limits').insert(limitInput(f.owner.id))).error);
  const [permissions] = await queryAdmin(`SELECT has_table_privilege('service_role','public.spending_limits','SELECT') AS service_select,
      has_table_privilege('service_role','public.spending_limits','INSERT') AS service_insert`);
  assert.deepEqual(permissions, { service_select: false, service_insert: false });
});

test('rejects invalid amounts and cadence while preserving the exact supported range', async t => {
  const f = await setup(t);
  for (const amount of ['0', '-0.01', 'NaN', 'Infinity', '-Infinity', '10000000000000.00']) {
    assert.ok((await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { amount }))).error, `accepted ${amount}`);
  }
  for (const cadence of ['weekly', 'year', '']) {
    assert.ok((await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { cadence }))).error, `accepted ${cadence}`);
  }

  const smallest = requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { amount: '0.01' })).select().single());
  assert.equal(smallest.amount, 0.01);
  requireSuccess(await f.owner.client.from('spending_limits').delete().eq('user_id', f.owner.id));

  const rounded = requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { amount: '1.005' })).select().single());
  assert.equal(rounded.amount, 1.01);
  requireSuccess(await f.owner.client.from('spending_limits').delete().eq('user_id', f.owner.id));

  const maximum = requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id, { amount: '9999999999999.99' })).select().single());
  assert.equal(maximum.amount, Number('9999999999999.99'));
  const { queryAdmin } = await databaseRuntime();
  const [exactMaximum] = await queryAdmin('SELECT amount::text AS amount FROM public.spending_limits WHERE user_id=$1', [f.owner.id]);
  assert.equal(exactMaximum.amount, '9999999999999.99');
});

test('reinstalls raw LF and CRLF migration text with identical table semantics and grants', async t => {
  const f = await setup(t);
  const { queryAdmin } = await databaseRuntime();
  const sql = (await readFile(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  requireSuccess(await f.owner.client.from('spending_limits').insert(limitInput(f.owner.id)));

  let baseline;
  for (const raw of [sql.replace(/\n/g, '\r\n'), sql]) {
    await queryAdmin(raw);
    await queryAdmin(raw);
    const snapshot = await migrationSnapshot(queryAdmin);
    if (baseline) assert.deepEqual(snapshot, baseline);
    else baseline = snapshot;
    assert.equal(requireSuccess(await f.owner.client.from('spending_limits').select().single()).amount, 25000);
  }

  assert.deepEqual(baseline.columns.map(column => [column.name, column.type, column.notNull]), [
    ['user_id', 'uuid', true],
    ['amount', 'numeric(15,2)', true],
    ['cadence', 'text', true],
    ['created_at', 'timestamp with time zone', true],
    ['updated_at', 'timestamp with time zone', true],
  ]);
  assert.equal(baseline.table.rls, true);
  assert.deepEqual(baseline.table.grants, {
    authenticated: { select: true, insert: true, update: true, delete: true },
    anon: { select: false, insert: false, update: false, delete: false },
    service_role: { select: false, insert: false, update: false, delete: false },
    public: false,
  });
  assert.equal(baseline.policies.length, 4);
  assert.deepEqual(baseline.policies.map(policy => [policy.command.toUpperCase(), policy.roles, policy.using, policy.check]), [
    ['DELETE', ['authenticated'], '(auth.uid() = user_id)', null],
    ['INSERT', ['authenticated'], null, '(auth.uid() = user_id)'],
    ['SELECT', ['authenticated'], '(auth.uid() = user_id)', null],
    ['UPDATE', ['authenticated'], '(auth.uid() = user_id)', '(auth.uid() = user_id)'],
  ]);
  assert.ok(baseline.constraints.some(constraint => /FOREIGN KEY \(user_id\) REFERENCES (public\.)?users\(id\) ON DELETE CASCADE/.test(constraint.definition)), JSON.stringify(baseline.constraints));
  assert.ok(baseline.constraints.some(constraint => /9999999999999\.99/.test(constraint.definition)));
  assert.match(baseline.trigger.definition, /BEFORE UPDATE ON public\.spending_limits/);
  assert.equal(baseline.trigger.enabled, 'O');
  assert.match(baseline.trigger.function_source, /clock_timestamp/);
});
