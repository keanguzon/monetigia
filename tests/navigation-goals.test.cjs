const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(pathname) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(pathname, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = name => name.startsWith('.') ? load(path.resolve(path.dirname(pathname), name) + '.ts') : require(name);
  new Function('module', 'exports', 'require', code)(module, module.exports, localRequire);
  return module.exports;
}
test('navigation ignores same route, fragments, external links and modified clicks', () => {
  const { navigationDestination } = load('src/lib/navigation.ts');
  const current = 'https://app.test/dashboard';
  assert.equal(navigationDestination('/accounts', current, {}), '/accounts');
  for (const href of ['/dashboard', '#summary', 'https://other.test/accounts', 'mailto:a@test.com']) {
    assert.equal(navigationDestination(href, current, {}), null);
  }
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }, { target: '_blank' }, { download: true }]) {
    assert.equal(navigationDestination('/accounts', current, event), null);
  }
});
test('allocation events preserve combined progress and never infer legacy funding', () => {
  const { summarizeGoal } = load('src/lib/goals/summary.ts');
  const goalId = '10000000-0000-4000-8000-000000000001';
  const accountId = '20000000-0000-4000-8000-000000000001';
  const base = { id: goalId, user_id: goalId, goal_id: goalId, account_id: accountId, operation_id: goalId, transaction_id: null, reversal_of: null, created_at: '2026-10-06T00:00:00Z' };
  const events = [
    { ...base, kind: 'reserve', reserved_delta: '3000.00', spent_delta: '0.00' },
    { ...base, kind: 'spend', reserved_delta: '-2000.00', spent_delta: '2000.00' },
  ];
  assert.deepEqual(summarizeGoal(goalId, '3000.00', events), { goalId, reserved: '1000.00', spent: '2000.00', progressAmount: '3000.00', remaining: '0.00', progressPercent: 100, walletReservations: [{ accountId, amount: '1000.00' }], legacyTaggedAmount: null });
  assert.equal(summarizeGoal(goalId, '5000.00', []).progressAmount, '0.00');
  assert.throws(() => summarizeGoal(goalId, '5000.00', [{ goal_id: goalId, type: 'expense', amount: 5000 }]));
});
