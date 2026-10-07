const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

const source = readFileSync(require.resolve('../next.config.js'), 'utf8');
const baselinePolicy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://avatars.githubusercontent.com https://lh3.googleusercontent.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests";
const baselineConnect = "connect-src 'self' https://*.supabase.co wss://*.supabase.co";
async function headers(mode, url) {
  const loaded = { exports: {} };
  runInNewContext(source, { module: loaded, URL, process: { env: { NODE_ENV: mode, NEXT_PUBLIC_SUPABASE_URL: url } } });
  return JSON.parse(JSON.stringify(await loaded.exports.headers()));
}
const policy = result => result[0].headers.find(header => header.key === 'Content-Security-Policy').value;

test('development allows only the configured normalized HTTP(S) loopback API origin', async () => {
  for (const [url, origin] of [
    ['http://127.0.0.1:55440/rest/v1?x=test', 'http://127.0.0.1:55440'],
    ['https://LOCALHOST:55440/auth/v1', 'https://localhost:55440'],
    ['http://[::1]:55440/rest/v1', 'http://[::1]:55440'],
    ['http://127.1:55440', 'http://127.0.0.1:55440'],
    ['http://localhost:80/', 'http://localhost'],
  ]) {
    const actual = policy(await headers('development', url));
    const expected = baselinePolicy.replace(baselineConnect, `${baselineConnect} ${origin}`);
    assert.equal(actual, url.startsWith('http:') ? expected.replace('; upgrade-insecure-requests', '') : expected);
  }
});

test('only a configured HTTP loopback API suppresses upgrade-insecure-requests in development', async () => {
  const http = policy(await headers('development', 'http://127.0.0.1:55440/auth/v1'));
  assert.equal(http, baselinePolicy
    .replace(baselineConnect, `${baselineConnect} http://127.0.0.1:55440`)
    .replace('; upgrade-insecure-requests', ''));
  assert.doesNotMatch(http, /upgrade-insecure-requests/);

  const https = policy(await headers('development', 'https://localhost:55440/auth/v1'));
  assert.equal(https, baselinePolicy.replace(baselineConnect, `${baselineConnect} https://localhost:55440`));
  assert.match(https, /upgrade-insecure-requests/);

  assert.equal(policy(await headers('development', undefined)), baselinePolicy);
});

test('production and nondevelopment headers remain byte-equivalent even with a loopback API configured', async () => {
  const baseline = await headers('production', undefined);
  assert.equal(policy(baseline), baselinePolicy);
  for (const mode of ['production','test',undefined]) for (const url of ['http://127.0.0.1:55440','http://[::1]:55440','https://localhost:443','https://project.supabase.co']) {
    assert.deepEqual(await headers(mode, url), baseline);
  }
});

test('development rejects nonloopback, unsupported protocols, credentials, malformed URLs and control-character injection', async () => {
  const baseline = await headers('production', undefined);
  for (const url of [
    undefined, '', 'invalid', '/api', 'https://project.supabase.co', 'http://localhost.evil.test:55440',
    'http://127.0.0.1.evil.test:55440', 'http://127.0.0.2:55440', 'http://192.168.1.2:55440',
    'ftp://localhost:55440', 'ws://127.0.0.1:55440', 'file:///localhost',
    'http://user:password@localhost:55440', 'http://user@127.0.0.1:55440',
    'http://127.0.0.1:invalid', 'http://[::1', 'http://localhost:55440\r\nconnect-src *',
    'http://local\thost:55440', 'http://localhost:55440/\u0000',
  ]) assert.deepEqual(await headers('development', url), baseline, String(url));
});

test('a configured loopback URL cannot add path, query, fragment or encoded header directives to CSP', async () => {
  const baseline = await headers('production', undefined);
  for (const url of ['http://localhost:55440/;script-src%20*?x=connect-src%20*#frame-src%20*', 'http://localhost:55440/%0d%0aContent-Security-Policy%3A%20default-src%20*']) {
    const actual = await headers('development', url);
    assert.equal(policy(actual), baselinePolicy
      .replace(baselineConnect, `${baselineConnect} http://localhost:55440`)
      .replace('; upgrade-insecure-requests', ''));
    assert.deepEqual(actual[0].headers.filter(header => header.key !== 'Content-Security-Policy'), baseline[0].headers.filter(header => header.key !== 'Content-Security-Policy'));
  }
});
