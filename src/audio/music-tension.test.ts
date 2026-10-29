import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicTension, type MusicView } from './music-tension';
import type { Fleet } from '../game/simulation';

function view(overrides: Partial<MusicView> = {}): MusicView {
  return { hour: 10, version: 2, rocks: [
    { id: 'a', x: 0, y: 0, owner: 'you', drones: 10, known: true },
    { id: 'b', x: 80, y: 0, owner: 'vesper', drones: 10, known: true },
    { id: 'c', x: 0, y: 80, owner: null, drones: 0, known: true },
  ], fleets: [], eliminated: [], winner: null, ...overrides };
}
function fleet(overrides: Partial<Fleet> = {}): Fleet {
  return { id: 1, owner: 'vesper', from: 'b', to: 'a', drones: 5, departed: 8, arrives: 11, ...overrides };
}

test('calm without live conflict, including distant hostile activity', () => {
  assert.equal(musicTension(view(), 'you'), 'calm');
  assert.equal(musicTension(view({ fleets: [fleet({ arrives: 17 })] }), 'you'), 'calm');
  assert.equal(musicTension(view({ fleets: [fleet({ to: 'c' })] }), 'you'), 'calm');
});

test('incoming and outgoing battles rise at six hours and one hour', () => {
  for (const route of [{}, { owner: 'you' as const, from: 'a', to: 'b' }]) {
    assert.equal(musicTension(view({ fleets: [fleet({ ...route, arrives: 16 })] }), 'you'), 'moderate');
    assert.equal(musicTension(view({ fleets: [fleet({ ...route, arrives: 11.01 })] }), 'you'), 'moderate');
    assert.equal(musicTension(view({ fleets: [fleet({ ...route, arrives: 11 })] }), 'you'), 'tense');
  }
});

test('friendly transfers, gifts, and empty neutral expansion stay calm', () => {
  for (const f of [fleet({ owner: 'you' }), fleet({ giftAt: 10.5 }), fleet({ owner: 'you', from: 'a', to: 'c' }), fleet({ arrives: 9 })]) {
    assert.equal(musicTension(view({ fleets: [f] }), 'you'), 'calm');
  }
  assert.equal(musicTension(view({ fleets: [fleet({ giftAt: 12 })] }), 'you'), 'tense', 'gifts not active by contact are still hostile');
});

test('neutral defenders count, hidden destinations and other players battles do not', () => {
  const v = view({ fleets: [fleet({ owner: 'you', from: 'a', to: 'c' })] });
  v.rocks[2]!.drones = 4;
  assert.equal(musicTension(v, 'you'), 'tense');
  v.rocks[2] = { id: 'c', x: 0, y: 80, known: false };
  assert.equal(musicTension(v, 'you'), 'calm');
  assert.equal(musicTension(view({ fleets: [fleet()] }), 'null'), 'calm');
});

test('visible interception and passing-hauler battles use contact rather than arrival', () => {
  const a = fleet({ id: 1, owner: 'you', from: 'a', to: 'b', departed: 10, arrives: 12 });
  const b = fleet({ id: 2, departed: 10, arrives: 12 });
  assert.equal(musicTension(view({ fleets: [a, b] }), 'you'), 'tense');
  assert.equal(musicTension(view({ fleets: [{ ...a, giftAt: 10 }, { ...b, giftAt: 10 }] }), 'you'), 'calm');
  assert.equal(musicTension(view({ fleets: [{ ...a, to: 'c', arrives: 15 }, { ...b, intercept: { home: 'b', target: 1 }, arrives: 10.5 }] }), 'you'), 'tense');
  assert.equal(musicTension(view({ fleets: [{ ...b, intercept: { home: 'b' }, arrives: 10.5 }] }), 'you'), 'calm');
});

test('preparation counts toward arrival, highest tension wins, outcomes settle to calm', () => {
  const v = view({ fleets: [fleet({ preparing: true, departed: 10.1 }), fleet({ id: 2, arrives: 15 })] });
  assert.equal(musicTension(v, 'you'), 'tense');
  for (const end of [{ winner: 'you' as const }, { draw: true as const }, { eliminated: ['you' as const] }]) {
    assert.equal(musicTension({ ...v, ...end }, 'you'), 'calm');
  }
  assert.equal(musicTension(view(), undefined), null);
  assert.equal(musicTension(undefined, 'you'), null);
});
