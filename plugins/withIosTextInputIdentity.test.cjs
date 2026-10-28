const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { assertCompatible } = require('./withIosTextInputIdentity.cjs');
const mounting = path.join(path.dirname(require.resolve('react-native/package.json')), 'React/Fabric/Mounting');
const factory = readFileSync(path.join(mounting, 'RCTComponentViewFactory.mm'), 'utf8');
const input = readFileSync(path.join(mounting, 'ComponentViews/TextInput/RCTTextInputComponentView.mm'), 'utf8');
test('the installed native factory supports the input-specific recycling opt-out', () => {
  assert.doesNotThrow(() => assertCompatible(factory, input));
});
test('upstream recycling changes require review instead of silently overriding native behavior', () => {
  assert.throws(() => assertCompatible('', input), /Review/);
  assert.throws(() => assertCompatible(factory, ''), /Review/);
  assert.throws(() => assertCompatible(factory, input + '\n+ (BOOL)shouldBeRecycled { return YES; }'), /Review/);
});
