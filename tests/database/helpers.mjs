import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const executeFile = promisify(execFile);
let runtime;

export async function databaseRuntime() {
  if (runtime) return runtime;
  const required = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Disposable database tests require ${missing.join(', ')}. Never use a live project.`);
  if (process.env.TEST_DATABASE_DISPOSABLE !== 'true') {
    throw new Error('Set TEST_DATABASE_DISPOSABLE=true only for an isolated disposable database. Tests create users and apply migrations.');
  }
  const adapter = process.env.TEST_DATABASE_ADAPTER
    ? await import(pathToFileURL(resolve(process.env.TEST_DATABASE_ADAPTER)).href)
    : null;
  const url = process.env.TEST_SUPABASE_URL;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY, options);
  const queryAdmin = adapter?.queryAdmin ?? (async (sql, params = []) => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('Migration tests require TEST_DATABASE_URL and psql, or TEST_DATABASE_ADAPTER with queryAdmin.');
    if (params.length) throw new Error('The psql adapter accepts complete migration SQL only.');
    const isQuery = /^\s*SELECT\b/i.test(sql);
    const command = isQuery ? `SELECT COALESCE(json_agg(result), '[]'::json) FROM (${sql.trim().replace(/;$/, '')}) result` : sql;
    let connection;
    try { connection = new URL(process.env.TEST_DATABASE_URL); }
    catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URI.'); }
    if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://.');
    const sqlEnvironment = {
      ...process.env,
      PGHOST: connection.hostname,
      PGPORT: connection.port || '5432',
      PGDATABASE: decodeURIComponent(connection.pathname.slice(1)),
      PGUSER: decodeURIComponent(connection.username),
      PGPASSWORD: decodeURIComponent(connection.password),
    };
    const connectionOptions = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT', options: 'PGOPTIONS', application_name: 'PGAPPNAME' };
    for (const [parameter, variable] of Object.entries(connectionOptions)) {
      if (connection.searchParams.has(parameter)) sqlEnvironment[variable] = connection.searchParams.get(parameter);
    }
    const { stdout } = await executeFile(process.env.TEST_PSQL_PATH || 'psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', command], {
      env: sqlEnvironment, maxBuffer: 4 * 1024 * 1024,
    });
    return { rows: isQuery ? JSON.parse(stdout.trim()) : [] };
  });
  runtime = { adapter, admin, queryAdmin: async (...args) => {
    const result = await queryAdmin(...args);
    return result.rows ?? result;
  }, url, options };
  return runtime;
}

export async function applyMigration(filename) {
  const { queryAdmin } = await databaseRuntime();
  const sql = await readFile(new URL(`../../supabase/migrations/${filename}`, import.meta.url), 'utf8');
  await queryAdmin(sql);
  await queryAdmin("NOTIFY pgrst, 'reload schema'");
  // PostgREST reloads its schema asynchronously after the transaction commits.
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
}

export async function installLatestMigrations() {
  const names = await readdir(new URL('../../supabase/migrations/', import.meta.url));
  for (const name of names.filter(name => /^\d+_.*\.sql$/.test(name)).sort()) await applyMigration(name);
}

export function requireSuccess(result, context = 'Database request') {
  if (result.error) throw new Error(`${context}: ${result.error.code}: ${result.error.message}`);
  return result.data;
}

export async function createFinanceFixture() {
  const { adapter, admin, url, options } = await databaseRuntime();
  const fixture = { admin, users: [], owner: null, other: null };
  try {
    for (const label of ['owner', 'other']) {
      const email = `goal-ledger-${randomUUID()}@example.test`;
      let identity;
      if (adapter) identity = await adapter.createUser(email);
      else {
        const password = `${randomUUID()}Aa1!`;
        const created = requireSuccess(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create disposable user');
        fixture.users.push(created.user.id);
        const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, options);
        const signedIn = requireSuccess(await client.auth.signInWithPassword({ email, password }), 'Sign in disposable user');
        identity = { id: created.user.id, accessToken: signedIn.session.access_token };
      }
      if (!fixture.users.includes(identity.id)) fixture.users.push(identity.id);
      const client = createClient(url, process.env.TEST_SUPABASE_ANON_KEY, {
        ...options, global: { headers: { Authorization: `Bearer ${identity.accessToken}` } },
      });
      requireSuccess(await admin.from('users').upsert({ id: identity.id, email, username: `test_${identity.id}`, name: label }), 'Create profile');
      const account = requireSuccess(await client.from('accounts').insert({ user_id: identity.id, name: 'Cash', type: 'cash', balance: '30000.00' }).select().single());
      const goal = requireSuccess(await client.from('goals').insert({ user_id: identity.id, name: 'Laptop', target_amount: '5000.00' }).select().single());
      fixture[label] = { ...identity, client, account, goal };
    }
    return fixture;
  } catch (error) {
    await cleanupFinanceFixture(fixture);
    throw error;
  }
}

export async function cleanupFinanceFixture(fixture) {
  const { adapter, admin } = await databaseRuntime();
  for (const userId of [...fixture.users].reverse()) {
    if (adapter) await adapter.deleteUser(userId);
    else requireSuccess(await admin.auth.admin.deleteUser(userId), 'Delete disposable user');
  }
}

export async function insertOperation(fixture, userId = fixture.owner.id, overrides = {}) {
  return requireSuccess(await fixture.admin.from('financial_operations').insert({
    user_id: userId, request_id: randomUUID(), command_hash: 'a'.repeat(64), command: { kind: 'reserve' }, ...overrides,
  }).select().single());
}

export function eventInput(fixture, operation, overrides = {}) {
  return { user_id: fixture.owner.id, goal_id: fixture.owner.goal.id, account_id: fixture.owner.account.id,
    operation_id: operation.id, kind: 'reserve', reserved_delta: '10.00', spent_delta: '0.00', ...overrides };
}
