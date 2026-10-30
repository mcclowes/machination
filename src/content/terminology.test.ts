import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayGameText, resourceName, siteKindLabel } from './terminology';

test('site labels distinguish current power supply from legacy production without changing saved kinds', () => {
  const site = { kind: 'generator' as const };
  assert.equal(siteKindLabel(site.kind), 'Reactor');
  assert.equal(site.kind, 'generator');
  assert.equal(siteKindLabel('reactor'), 'Legacy reactor');
  assert.equal(siteKindLabel('factory'), 'Factory');
  assert.equal(siteKindLabel('mine'), 'Mine');
  assert.equal(siteKindLabel('core'), 'Core site');
  assert.equal(siteKindLabel('unknown'), 'Unknown site');
});

test('the same stored resource has a mode-specific player name', () => {
  assert.equal(resourceName('pulse'), 'pulse material');
  for (const mode of ['mining', 'domination', undefined] as const) {
    assert.equal(resourceName(mode), 'cargo');
  }
});


test('displayed validation errors translate resources and specialists while legacy modules retain their meaning', () => {
  const message = 'Choose a controlled rock with a scavenger rig. Hiring needs 5 cargo.';
  assert.equal(displayGameText(message, { version: 2, rules: { mode: 'pulse' } }), 'Choose a controlled site with an interceptor. Hiring needs 5 pulse material.');
  assert.equal(displayGameText('This rock already has a module.', { version: 1 }), 'This site already has a module.');
  assert.equal(displayGameText('Choose owned modules.', { version: 2 }), 'Choose owned specialists.');
});
