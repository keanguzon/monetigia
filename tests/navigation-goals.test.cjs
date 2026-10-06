const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
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
test('only expense and transfer contributions affect a goal, with exact saved progress', () => {
  const { contributionGoalId, goalFunding } = load('src/lib/goal-funding.ts');
  assert.equal(contributionGoalId('income', 'phone'), null);
  assert.equal(contributionGoalId('expense', ''), null);
  assert.equal(contributionGoalId('transfer', 'phone'), 'phone');
  const tx = [{ goal_id: 'phone', type: 'expense', amount: 200 }, { goal_id: 'phone', type: 'transfer', amount: 300 }, { goal_id: 'phone', type: 'income', amount: 900 }, { goal_id: 'other', type: 'expense', amount: 500 }];
  assert.deepEqual(goalFunding('phone', 5000, tx), { saved: 500, progressPercent: 10 });
  assert.deepEqual(goalFunding('empty', 0, tx), { saved: 0, progressPercent: 0 });
  assert.deepEqual(goalFunding('phone', 5000, [1,2,3].map(() => ({ goal_id: 'phone', type: 'expense', amount: 100 }))), { saved: 300, progressPercent: 6 });
});
