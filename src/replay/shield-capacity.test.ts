import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from '../game/world';
import { withUnitEffects } from '../game/specialist-effects';
import { observe, type GameView } from '../game/visibility';
import { createArchive } from '../game/replay';
import { presentObservation } from './presentation';
import { generateSharedReplay } from './generate';
import { decodeSharedReplay, encodeSharedReplay } from './codec';
import { seekReplay } from './playback';

for (const [name, base, bonus, core, destroyed, expected] of [
  ['ordinary', 10, 0, false, false, 10],
  ['Queen', 20, 0, true, false, 40],
  ['remote Security Chief', 10, 10, false, false, 20],
  ['local Security Chief', 10, 20, false, false, 30],
  ['single King', 20, -20, false, false, 0],
  ['Queen with Chief and King', 20, -10, true, false, 30],
  ['destroyed', 20, 10, true, true, 0],
] as const) {
  test(`replay projects total observed shield capacity for ${name}`, () => {
    const view: GameView = { version: 2, hour: 0, epoch: 0, rocks: [
      { id: 'a', name: 'Known', x: 0, y: 0, owner: 'you', known: true, kind: 'generator', drones: 0,
        shield: 0, shieldMax: base, shieldBonus: bonus, ...(core ? { coreOf: 'you' as const } : {}), ...(destroyed ? { destroyed: true as const } : {}) },
      { id: 'b', name: 'Hidden', x: 50, y: 50, known: false, kind: 'unknown', owner: 'vesper' },
    ], fleets: [], cargo: {}, eliminated: [], winner: null, scheduled: [], events: [], coverage: [], uncertain: [], interceptionUncertain: false };
    Object.assign(view.rocks[1]!, { shield: 99, shieldMax: 99, shieldBonus: 99, coreOf: 'vesper' });
    const before = structuredClone(view);
    const scene = presentObservation(view);
    assert.equal(scene.rocks[0]!.shieldMax, expected);
    assert.equal(scene.rocks[0]!.coreOf, core ? 'you' : undefined);
    assert.equal('shieldBonus' in scene.rocks[0]!, false);
    assert.equal('shieldMax' in scene.rocks[1]!, false);
    assert.equal('shield' in scene.rocks[1]!, false);
    assert.equal('coreOf' in scene.rocks[1]!, false);
    assert.deepEqual(view, before);
  });
}

for (const kind of ['security', 'king'] as const) {
  test(`actual ${kind} observation retains total capacity through export, codec, and seeking`, () => {
    const baseline = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 2026);
    const own = baseline.rocks.filter(site => site.owner === 'you');
    const core = own.find(site => site.coreOf)!;
    const [caster, factory, wreck] = own.filter(site => !site.coreOf);
    for (const site of own) { site.x = 10; site.y = 10; site.productionAt = 1000; site.shieldAt = 1000; }
    core.shieldMax = 20;
    Object.assign(caster!, { kind: 'factory', shieldMax: 10, specialists: [{ id: 'global-shield-unit', kind, owner: 'you' }] });
    Object.assign(factory!, { kind: 'factory', shieldMax: 10 });
    Object.assign(wreck!, { destroyed: true, drones: 0, shield: 0, specialists: [] });
    const hidden = baseline.rocks.find(site => !site.owner)!;
    Object.assign(hidden, { x: baseline.rules!.map.width / 2 + 10, y: baseline.rules!.map.height / 2 + 10 });
    const game = withUnitEffects(baseline);
    const observed = observe(game, 'you');
    assert.equal(observed.rocks.find(site => site.id === hidden.id)!.known, false);
    const replay = decodeSharedReplay(encodeSharedReplay(generateSharedReplay({ game, archive: createArchive(game) }, 'you', 0, 0)));
    const scene = seekReplay(replay, 0);
    assert.equal(scene.rules!.mechanicsVersion, baseline.rules!.mechanicsVersion);
    assert.equal(scene.rocks.find(site => site.id === core.id)!.shieldMax, kind === 'security' ? 50 : 20);
    assert.equal(scene.rocks.find(site => site.id === caster!.id)!.shieldMax, kind === 'security' ? 30 : 0);
    assert.equal(scene.rocks.find(site => site.id === factory!.id)!.shieldMax, kind === 'security' ? 20 : 0);
    assert.equal(scene.rocks.find(site => site.id === wreck!.id)!.shieldMax, 0);
    assert.equal('shieldMax' in scene.rocks.find(site => site.id === hidden.id)!, false);
    assert.equal(scene.rocks.find(site => site.id === core.id)!.coreOf, 'you');
  });
}
