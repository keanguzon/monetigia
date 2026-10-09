const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const postcss = require('postcss');
const tailwind = require('tailwindcss');

test('Tailwind retains the synchronization rules triggered by the theme hook', async () => {
  const result = await postcss([tailwind('./tailwind.config.ts')]).process(
    fs.readFileSync('src/app/globals.css', 'utf8'),
    { from: 'src/app/globals.css' }
  );
  const rules = [];
  result.root.walkRules(rule => {
    if (rule.selector.includes('html.theme-transitioning')) rules.push(rule);
  });
  assert.ok(rules.length > 0, 'Theme synchronization CSS was removed by content scanning');
  assert.ok(rules.some(rule => rule.nodes.some(declaration =>
    declaration.prop === 'transition' && declaration.important &&
    declaration.value.includes('background-color 150ms')
  )));
});
