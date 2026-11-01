import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressCueFor, pressFeedback, pressText, setPressPlayer } from './press';

const element = (children: unknown) => ({ type: 'Text', props: { children } });

test('reads visible text when a control has no accessibility label', () => {
  assert.equal(pressText([element('Launch '), element(['hauler', ' ↗']), null, false]), 'Launch hauler ↗');
  assert.equal(pressText(() => 'render prop'), '');
});

test('dismissals, time controls, choices, and commitments each sound different', () => {
  assert.equal(pressCueFor({ accessibilityLabel: 'Close site details' }), 'back');
  assert.equal(pressCueFor({ children: element('Cancel selection') }), 'back');
  assert.equal(pressCueFor({ accessibilityLabel: '‹ Games' }), 'back');
  assert.equal(pressCueFor({ accessibilityLabel: 'Advance +15m' }), 'time');
  assert.equal(pressCueFor({ accessibilityLabel: '−1h' }), 'time');
  assert.equal(pressCueFor({ accessibilityLabel: 'Now' }), 'time');
  assert.equal(pressCueFor({ accessibilityRole: 'tab', accessibilityLabel: 'Signals' }), 'select');
  assert.equal(pressCueFor({ accessibilityState: { selected: false }, children: element('Mining') }), 'select');
  assert.equal(pressCueFor({ children: element('Schedule at 14:20') }), 'confirm');
  assert.equal(pressCueFor({ children: element('Plan transfer ↗') }), 'confirm');
  assert.equal(pressCueFor({ accessibilityLabel: 'Inspect' }), 'tap');
  assert.equal(pressCueFor({ children: element('Endurance') }), 'tap');
});

test('feedback is silent until the live audio stack installs a player', () => {
  const heard: string[] = [];
  pressFeedback('tap');
  setPressPlayer(cue => heard.push(cue));
  pressFeedback('confirm');
  pressFeedback(null);
  setPressPlayer(null);
  pressFeedback('back');
  assert.deepEqual(heard, ['confirm']);
});
