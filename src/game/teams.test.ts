import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { validateOptions, validateRules, victoryProgress } from './rules';
import { allied, teamMembers } from './teams';
import { advance, dispatch, operationStatus, type Game } from './simulation';
import { observe, forecastObservation } from './visibility';
import { drillMine, mineCost, setShields } from './economy';
import { dispatchSpecialistIntercept } from './specialist-interception';
import { scheduleTransfer, cancelTransfer, editScheduledLaunch } from './orders';
import { scheduleAction } from './future-actions';
import { decodeSave } from './save-format';
import { applyCommand, createArchive, exportArchive, replayTo } from './replay';
import { decodeReplay } from './replay-save';
import { resignInactive } from './retirement';
import { generateSharedReplay } from '../replay/generate';
import { decodeSharedReplay, encodeSharedReplay } from '../replay/codec';
import { observationIntervals } from '../replay/observation-intervals';
const teamGame = (format: '4v4' | '3v3v3' = '4v4', mode: 'mining' | 'domination' = 'mining') => createConfiguredGame({ playerCount: format === '4v4' ? 8 : 9, mode, teamFormat: format }, 0, 471);
const site = (g: Game, f: 'you' | 'vesper' | 'umbra', core = false) => g.rocks.find(r => r.owner === f && (core ? r.coreOf === f : !r.coreOf && r.kind !== 'mine'))!;

test('formats are explicit, strict, immutable, and never alter classic defaults', () => {
  const classic = createConfiguredGame({ playerCount: 3, mode: 'mining' }, 0, 471);
  assert.equal(classic.rules!.teams, undefined); assert.equal(classic.rules!.victoryTarget, 300);
  for (const format of ['4v4', '3v3v3'] as const) {
    const g = teamGame(format); assert.equal(g.rules!.victoryTarget, 300);
    assert.deepEqual(validateRules(g.rules), g.rules);
    assert.equal(teamMembers(g, 'you').length, format === '4v4' ? 4 : 3);
    assert.equal(allied(g, 'you', 'vesper'), true);
    for (const change of [ { casual: false }, { format: '1v1' }, { members: [...g.rules!.teams!.members].reverse() }, { captain: 'you' } ]) assert.throws(() => validateRules({ ...g.rules, teams: { ...g.rules!.teams, ...change } }));
    assert.throws(() => validateRules({ ...g.rules, mechanicsVersion: 12 }));
  }
  assert.throws(() => validateOptions({ playerCount: 3, mode: 'mining', teamFormat: '4v4' }));
  assert.throws(() => validateOptions({ playerCount: 8, mode: 'mining', teamFormat: '2v2' }));
});

test('mine costs count allied lifetime builds while payment and authority stay local', () => {
  let g = teamGame(); g.minesDrilled = Object.fromEntries(g.rules!.players.map(f => [f, 0])); const a = site(g, 'you'), b = site(g, 'vesper'); a.drones = b.drones = 1000;
  g = drillMine(g, a.id, 'you'); assert.equal(mineCost(g, 'vesper'), 100); assert.equal(mineCost(g, 'umbra'), 50);
  g = drillMine(g, b.id, 'vesper'); assert.equal(mineCost(g, 'you'), 200);
  assert.equal(g.rocks.find(r => r.id === b.id)!.drones, 900);
  assert.equal(mineCost(observe(g, 'you'), 'you'), 200);
  assert.throws(() => drillMine(g, site(g, 'vesper').id, 'you'));
  assert.throws(() => setShields(g, b.id, 'you', true));
});

test('pooled mining and domination win for every teammate; same-instant teams draw', () => {
  const g = teamGame(); g.cargo.you = 150; g.cargo.vesper = 150;
  let end = advance(g, 0.1, { rivals: false }); assert.equal(end.winner, 'you');
  assert.equal(operationStatus(end, 'vesper'), 'victory'); assert.equal(operationStatus(end, 'umbra'), 'defeat');
  g.cargo.umbra = 300; end = advance(g, 0.1, { rivals: false }); assert.equal(end.winner, null); assert.equal(end.draw, true);
  assert.equal(decodeSave(JSON.stringify({ savedAt: 0, game: end })).game.draw, true);
  const domination = teamGame('3v3v3', 'domination');
  domination.rocks.slice(0, 45).forEach((r, i) => { r.owner = i % 2 ? 'you' : 'vesper'; });
  assert.ok(victoryProgress(domination, 'you') >= 45);
  assert.equal(advance(domination, 0.1, { rivals: false }).winner, 'you');
});

test('simultaneous final mining ticks resolve as a draw without seat-order bias', () => {
  const g = teamGame(); for (const f of g.rules!.players) g.cargo[f] = 0; for (const r of g.rocks.filter(r => r.kind === 'mine')) { r.miningAt = 24; r.miningInterval = 4; } g.cargo.you = g.cargo.umbra = 299;
  for (const f of ['you', 'umbra'] as const) { const r = site(g, f); r.kind = 'mine'; r.miningAt = 1; r.miningInterval = 24 / 6; }
  const end = advance(g, 1, { rivals: false }); assert.equal(end.draw, true); assert.equal(end.winner, null);
  assert.equal(end.cargo.you, 300); assert.equal(end.cargo.umbra, 300);
});

test('shared intelligence and plans forecast together, but opponent hidden state cannot interfere', () => {
  let g = teamGame(); const a = site(g, 'vesper'), b = site(g, 'vesper', true);
  g = scheduleTransfer(g, { id: 'teammate-plan-0001', owner: 'vesper', from: a.id, to: b.id, drones: 3, executeAt: 1 });
  const v = observe(g, 'you'); assert.ok(v.rocks.find(r => r.id === a.id)!.known);
  assert.equal(v.scheduled[0]!.owner, 'vesper');
  const predicted = forecastObservation(v, 'you', 1.1);
  assert.equal(predicted.scheduled.length, 0); assert.ok(predicted.fleets.some(f => f.owner === 'vesper' && f.drones === 3));
  assert.throws(() => cancelTransfer(g, 'teammate-plan-0001', 'you'));
  assert.throws(() => editScheduledLaunch(g, 'you', { planId: 'teammate-plan-0001', drones: 2 }));
  assert.throws(() => dispatch(g, a.id, b.id, 1, 'you'));
  const hidden = v.rocks.find(r => !r.known && r.owner === 'umbra'); assert.ok(hidden);
  let altered = structuredClone(g); altered.rocks.find(r => r.id === hidden.id)!.drones += 9999;
  altered = scheduleAction(altered, { id: 'opponent-plan-0001', owner: 'umbra', executeAt: 2, action: { type: 'shields', rock: site(g, 'umbra').id, disabled: true } });
  assert.deepEqual(observe(altered, 'you'), v);
  assert.deepEqual(forecastObservation(observe(altered, 'you'), 'you', 1.1), predicted);
});

test('Pirates refuse ally targets immediately and when scheduled', () => {
  const g = teamGame(); const from = site(g, 'you');
  from.specialists!.push({ id: 'team-pirate', owner: 'you', kind: 'pirate' });
  const friend = site(g, 'vesper');
  g.fleets.push({ id: g.nextId++, owner: 'vesper', from: friend.id, to: from.id, drones: 1, departed: 0, arrives: 10, specialists: [] });
  assert.throws(() => dispatchSpecialistIntercept(g, from.id, 1, 1, 'you', false));
  assert.throws(() => scheduleAction(g, { id: 'pirate-ally-plan-001', owner: 'you', executeAt: 1, action: { type: 'intercept', from: from.id, target: 1, drones: 1 } }));
});

test('retirement keeps seat elimination semantics and finishes only on last active team', () => {
  const g = teamGame(); const end = resignInactive(g, ['umbra', 'orbit', 'prism', 'echo']);
  assert.deepEqual(end.eliminated, ['umbra', 'orbit', 'prism', 'echo']); assert.equal(end.winner, 'you');
  assert.equal(operationStatus(end, 'aether'), 'victory');
  const one = resignInactive(g, ['you']); assert.equal(one.winner, null); assert.equal(one.cargo.you, 0);
  assert.equal(operationStatus({ ...one, winner: 'you' }, 'you'), 'victory');
});

test('strict saves and canonical/observed replays retain profile without leaking future plans', () => {
  const baseline = teamGame(); const a = site(baseline, 'vesper'), b = site(baseline, 'vesper', true);
  const result = applyCommand(createArchive(baseline), { type: 'schedule', owner: 'vesper', plan: { id: 'canonical-team-0001', from: a.id, to: b.id, drones: 2, executeAt: 1 } }, { rivals: false, knownThrough: 0 });
  const live = advance(result.game, 1.1, { rivals: false });
  const restored = decodeReplay(exportArchive(result.archive), live, false);
  assert.deepEqual(replayTo(restored, 1.1, { rivals: false, knownThrough: 1.1 }), live);
  assert.deepEqual(decodeSave(JSON.stringify({ savedAt: 0, game: live })).game, live);
  const replay = generateSharedReplay({ game: live, archive: result.archive }, 'you', 0, 1.1);
  const raw = encodeSharedReplay(replay); assert.deepEqual(decodeSharedReplay(raw), replay);
  assert.equal(raw.includes('canonical-team-0001'), false); assert.equal(raw.includes('"seed"'), false);
  assert.ok(replay.groups.every(g => g.states.every(s => s.rules!.teams!.format === '4v4')));
  assert.ok(replay.groups.some(g => g.states.some(s => s.fleets.some(f => f.owner === 'vesper'))));
  const spans = observationIntervals(baseline, 'you', 1); assert.deepEqual(spans.sites.get(a.id), [{ from: 0, through: 1 }]);
});

test('observed replay follows an opponent crossing teammate sonar, with no private motion source', async () => {
  const { seekReplay } = await import('../replay/playback');
  const g = teamGame(); g.rules!.map.width = g.rules!.map.height = 1000;
  for (const r of g.rocks) {
    const friendly = allied(g, 'you', r.owner ?? 'umbra');
    r.x = friendly ? r.owner === 'you' ? 0 : 100 : 700; r.y = friendly ? r.owner === 'you' ? 0 : 100 : 700;
  }
  const enemy = site(g, 'umbra');
  g.fleets.push({ id: g.nextId++, owner: 'umbra', from: enemy.id, to: enemy.id, drones: 1, departed: 0, arrives: 10, specialists: [], route: { from: { x: 50, y: 100 }, to: { x: 150, y: 100 } } });
  const archive = createArchive(g); const live = advance(g, 9, { rivals: false });
  const replay = generateSharedReplay({ game: live, archive }, 'you', 0, 9);
  for (const hour of [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const expected = observe(advance(g, hour, { rivals: false }), 'you').fleets.length;
    assert.equal(seekReplay(replay, hour).fleets.length, expected, `hour ${hour}`);
  }
  assert.equal(seekReplay(replay, 0).fleets.length, 0); assert.equal(seekReplay(replay, 3).fleets.length, 1);
  assert.equal(seekReplay(replay, 9).fleets.length, 0);
  assert.equal(encodeSharedReplay(replay).includes('"source"'), false);
});

test('opposing plans and pending courses stay private while allied preparation is shared and re-aliased', () => {
  let g = teamGame(); const a = site(g, 'vesper'), b = site(g, 'vesper', true);
  a.specialists!.push({ id: 'ally-navigator', kind: 'navigator', owner: 'vesper' });
  g = dispatch(g, a.id, b.id, 1, 'vesper', false, ['ally-navigator']);
  const ally = g.fleets[0]!;
  const observed = observe(g, 'you', id => id + 100, id => `alias-${id}`);
  assert.equal(observed.fleets[0]!.id, ally.id + 100); assert.equal(observed.fleets[0]!.preparing, true);
  assert.equal(observed.fleets[0]!.specialists![0]!.id, 'alias-ally-navigator');
  g = advance(g, 0.2, { rivals: false });
  g.fleets[0]!.pendingCourse = { owner: 'vesper', to: a.id, executeAt: 0.3 };
  assert.ok(observe(g, 'you').fleets[0]!.pendingCourse);
  const enemy = structuredClone(g.fleets[0]!); enemy.id = g.nextId++; enemy.owner = 'umbra'; enemy.specialists = [];
  enemy.pendingCourse = { owner: 'umbra', to: a.id, executeAt: 0.3 }; g.fleets.push(enemy);
  const v = observe(g, 'you'); assert.ok(v.fleets.find(f => f.id === enemy.id)); assert.equal(v.fleets.find(f => f.id === enemy.id)!.pendingCourse, undefined);
});

test('a Pirate mission returns without combat if its target becomes a teammate', async () => {
  const { resolveSpecialistInterceptions } = await import('./specialist-interception');
  const g = teamGame(); const from = site(g, 'you');
  const base = { from: from.id, to: from.id, departed: 0, arrives: 1, route: { from: { x: from.x, y: from.y }, to: { x: from.x, y: from.y } } };
  const pirate = { ...base, id: g.nextId++, owner: 'you' as const, drones: 10, specialists: [{ id: 'returning-pirate', kind: 'pirate' as const, owner: 'you' as const }], intercept: { target: 2, home: from.id } };
  const target = { ...base, id: g.nextId++, owner: 'vesper' as const, drones: 5, specialists: [] };
  g.fleets = [pirate, target]; g.hour = 1;
  resolveSpecialistInterceptions(g); assert.equal(target.drones, 5); assert.ok(g.fleets.includes(target));
  assert.equal(g.fleets.find(f => f.id === pirate.id)!.returning, true);
});
