import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createGame, dispatch, installModule } from './simulation';
import { createLegacyGame } from './legacy';
import { observe } from './visibility';
import { hireSpecialist, promoteSpecialist } from './specialists';
import { releaseSpecialist } from './specialist-travel';
import { drillMine, setShields } from './economy';
import { setFunding } from './funding';
import { dispatchIntercept } from './interception';
import { giftTransfer } from './gifts';
import { commandHauler } from './transport';
import { applyCommand, createArchive, executeCommand, replayTo, type GameCommand } from './replay';

const at = (knownThrough: number, rivals = false) => ({ knownThrough, rivals });
function session(baseline = createGame(0), rivals = false) {
  let archive = createArchive(baseline, { rivals });
  return {
    submit(command: GameCommand, hour = baseline.hour) {
      const result = applyCommand(archive, command, at(hour, rivals));
      archive = result.archive;
      return result.game;
    },
    replay(hour: number, frontier = hour) { return replayTo(archive, hour, at(frontier, rivals)); },
    get archive() { return archive; },
  };
}

test('travel and combat reconstruct before launch, during flight, and after capture', () => {
  const base = createGame(0);
  const s = session(base);
  const sent = s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 30 }, 1);
  const arrival = sent.fleets[0]!.arrives;
  const direct = dispatch(advance(base, 1, { rivals: false }), 'm', 'b', 30, 'you');
  assert.deepEqual(s.replay(0.5, arrival), advance(base, 0.5, { rivals: false }));
  assert.deepEqual(s.replay(1, arrival), direct);
  assert.equal(s.replay(arrival - 0.001).rocks.find(r => r.id === 'b')!.owner, null);
  assert.equal(s.replay(arrival).rocks.find(r => r.id === 'b')!.owner, 'you');
  assert.deepEqual(s.replay(12), advance(direct, 12, { rivals: false }));
});

test('queued transfers execute once, preserve queue order, and cancellation removes only its plan', () => {
  const s = session();
  const plan = { from: 'm', to: 'b', drones: 10, executeAt: 2 };
  for (const id of ['first-plan-00001', 'second-plan-0002', 'cancel-plan-0003']) s.submit({ type: 'schedule', owner: 'you', plan: { ...plan, id } });
  s.submit({ type: 'cancel-schedule', owner: 'you', id: 'cancel-plan-0003' }, 1);
  assert.equal(s.replay(1).scheduled!.length, 2);
  const launched = s.replay(2);
  assert.equal(launched.scheduled!.length, 0);
  assert.deepEqual(launched.fleets.map(f => f.id), [1, 2]);
  assert.equal(launched.rocks.find(r => r.id === 'm')!.drones, 20);
  assert.equal(s.replay(2.01).nextId, 3);
});

test('recruitment preserves seeded offers, unit IDs, promotions, and captive releases', () => {
  const base = createGame(123, { you: 42, vesper: 43, null: 44 });
  base.rocks.find(r => r.id === 'c')!.specialists!.push(
    { id: 'foreman', owner: 'you', kind: 'foreman' },
    { id: 'captive', owner: 'vesper', kind: 'helmsman', captive: true },
  );
  const s = session(base);
  const ready = advance(base, 4, { rivals: false });
  const kind = ready.recruitment!.you.offers[0]!;
  const hired = s.submit({ type: 'hire', owner: 'you', kind }, 4);
  assert.deepEqual(hired, hireSpecialist(ready, 'you', kind));
  const promoted = s.submit({ type: 'promote', owner: 'you', id: 'foreman' }, 22);
  const expected = promoteSpecialist(advance(hired, 22, { rivals: false }), 'you', 'foreman');
  assert.deepEqual(promoted, expected);
  assert.deepEqual(s.submit({ type: 'release', owner: 'you', id: 'captive' }, 22), releaseSpecialist(expected, 'you', 'captive'));
  assert.deepEqual(s.replay(4, 22), hired);
  assert.deepEqual(s.replay(30).recruitment, promoted.recruitment);
});

test('funding, per-unit mining, and shields reproduce the authoritative economy', () => {
  const base = createGame(0); base.cargo.you = 20;
  base.rocks.find(r => r.id === 'c')!.drones = 50;
  const s = session(base);
  s.submit({ type: 'funding', owner: 'you', to: 'vesper', enabled: true });
  s.submit({ type: 'drill-mine', owner: 'you', rock: 'c' });
  s.submit({ type: 'shields', owner: 'you', rock: 'm', disabled: true });
  const direct = setShields(drillMine(setFunding(base, 'you', 'vesper', true), 'c', 'you'), 'm', 'you', true);
  assert.equal(s.replay(4.799).cargo.you, 20);
  assert.equal(s.replay(4.8).cargo.you, 21);
  assert.deepEqual(s.replay(24), advance(direct, 24, { rivals: false }));
});

test('same-hour order controls inventory and generated fleet IDs without sorting by command', () => {
  const s = session();
  const first = s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 30 });
  s.submit({ type: 'hauler', owner: 'you', change: { action: 'cancel-launch', fleet: first.fleets[0]!.id } });
  s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'i', drones: 40 });
  const replay = s.replay(0);
  assert.deepEqual(replay.fleets.map(f => [f.id, f.to, f.drones]), [[2, 'i', 40]]);
  assert.equal(replay.rocks.find(r => r.id === 'm')!.drones, 0);
});

test('arbitrary polling splits preserve solo rival decisions and commands do not log them twice', () => {
  const base = createGame(0);
  const s = session(base, true);
  let direct = dispatch(base, 'm', 'b', 20, 'you');
  s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 20 });
  for (let hour = 0.137; hour < 24; hour += 0.137) direct = advance(direct, hour, { rivals: true });
  assert.deepEqual(s.replay(24), advance(direct, 24, { rivals: true }));
  assert.deepEqual(s.replay(24), advance(dispatch(base, 'm', 'b', 20, 'you'), 24, { rivals: true }));
  assert.throws(() => s.submit({ type: 'dispatch', owner: 'vesper', from: 'f', to: 'b', drones: 1 }, 24));
  assert.throws(() => replayTo(s.archive, 24, at(24, false)));
});

test('historical redaction uses past sonar even after later territorial knowledge', () => {
  const base = createGame(0);
  const s = session(base);
  assert.equal(observe(base, 'you').rocks.find(r => r.id === 'k')!.known, false);
  const sent = s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'k', drones: 30 }, 1);
  const frontier = sent.fleets[0]!.arrives;
  assert.equal(observe(s.replay(frontier), 'you').rocks.find(r => r.id === 'k')!.known, true);
  const past = observe(s.replay(0, frontier), 'you');
  const hidden = past.rocks.find(r => r.id === 'k')!;
  assert.equal(hidden.known, false);
  assert.equal(hidden.drones, undefined);
  assert.equal(hidden.owner, undefined);
  assert.equal(past.recruitment!.vesper, undefined);
  assert.deepEqual(past.scheduled, []);
  assert.equal(JSON.stringify(s.archive), '{}');
});

test('baselines, command arrays, executor inputs, and returned games never alias history', () => {
  const base = createGame(0);
  const s = session(base);
  const baseline = createGame(0);
  base.rocks[0]!.drones = 999;
  assert.deepEqual(s.replay(0), baseline);
  const specialists = ['core-you'];
  const command: GameCommand = { type: 'dispatch', owner: 'you', from: 'a', to: 'c', drones: 0, specialists };
  const before = JSON.stringify(command);
  const sent = s.submit(command);
  assert.equal(JSON.stringify(command), before);
  specialists.length = 0;
  sent.fleets[0]!.specialists![0]!.kind = 'martyr';
  sent.events[0]!.audience!.push('null');
  const repeated = s.replay(0);
  assert.equal(repeated.fleets[0]!.specialists![0]!.kind, 'queen');
  const original = JSON.stringify(repeated);
  const result = executeCommand(repeated, { type: 'hauler', owner: 'you', change: { action: 'cancel-launch', fleet: 1 } });
  result.rocks[0]!.specialists![0]!.kind = 'martyr';
  assert.equal(JSON.stringify(repeated), original);
  repeated.recruitment!.you.offers.length = 0;
  assert.equal(s.replay(0).recruitment!.you.offers.length, 3);
});

test('bounds reject missing history, future seeks, backdated submissions, and nonfinite hours', () => {
  const base = advance(createGame(0), 10, { rivals: false });
  const s = session(base);
  assert.throws(() => s.replay(9, 12));
  assert.throws(() => s.replay(13, 12));
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => s.replay(invalid, 12));
    assert.throws(() => s.replay(10, invalid));
  }
  s.submit({ type: 'shields', owner: 'you', rock: 'm', disabled: true }, 12);
  assert.throws(() => s.submit({ type: 'shields', owner: 'you', rock: 'm', disabled: false }, 11));
  assert.throws(() => replayTo({} as ReturnType<typeof createArchive>, 10, at(12)));
  const ended = createGame(0); ended.winner = 'you';
  assert.throws(() => session(ended).submit({ type: 'shields', owner: 'you', rock: 'm', disabled: true }, 1));
});

test('rejected actions leave the archive, payload, state, and next successful ID intact', () => {
  const s = session();
  const old = s.archive;
  const before = s.replay(0);
  const bad: GameCommand = { type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 1000, specialists: [] };
  const payload = JSON.stringify(bad);
  assert.throws(() => s.submit(bad));
  assert.equal(s.archive, old);
  assert.deepEqual(s.replay(0), before);
  assert.equal(JSON.stringify(bad), payload);
  const sent = s.submit({ ...bad, drones: 10 });
  assert.equal(sent.fleets[0]!.id, 1);
  assert.deepEqual(replayTo(old, 0, at(0)), before);
});

test('gifts and hauler edits share canonical execution and preserve payload arrays', () => {
  const base = createGame(0); const s = session(base);
  const gifted = s.submit({ type: 'gift', owner: 'you', from: 'm', to: 'f', drones: 10, recipient: 'vesper' });
  assert.deepEqual(gifted, giftTransfer(base, 'm', 'f', 10, 'you', 'vesper'));
  const change = { action: 'edit-launch' as const, fleet: 1, drones: 20, specialists: [] };
  const edited = s.submit({ type: 'hauler', owner: 'you', change });
  assert.deepEqual(edited, commandHauler(gifted, 'you', change));
  s.submit({ type: 'hauler', owner: 'you', change: { action: 'cancel-gift', fleet: 1 } });
  s.submit({ type: 'hauler', owner: 'you', change: { action: 'gift', fleet: 1 } });
  assert.equal(s.replay(0).fleets[0]!.giftAt, 1 / 6);
  change.specialists.push('mutated' as never);
  assert.deepEqual(s.replay(0).fleets[0]!.specialists, []);
});

test('legacy module installation and internal interception targets replay deterministically', () => {
  const base = createLegacyGame(0); const s = session(base);
  s.submit({ type: 'install-module', owner: 'you', rock: 'a', kind: 'scavenger' });
  s.submit({ type: 'dispatch', owner: 'vesper', from: 'e', to: 'a', drones: 40 });
  const launched = s.submit({ type: 'intercept', owner: 'you', from: 'a', target: 1, drones: 50 }, 4);
  const ready = advance(dispatch(installModule(base, 'a', 'scavenger', 'you'), 'e', 'a', 40, 'vesper'), 4, { rivals: false });
  assert.deepEqual(launched, dispatchIntercept(ready, 'a', 1, 50, 'you'));
  assert.deepEqual(s.replay(8), advance(launched, 8, { rivals: false }));
  assert.equal(s.replay(8).fleets.length, 0);
});

test('player submissions between arbitrary polls preserve the same future world', () => {
  const base = createGame(0);
  const s = session(base, true);
  let direct = base;
  for (const hour of [0.137, 0.419, 1.753, 4.119, 6, 6.137]) direct = advance(direct, hour, { rivals: true });
  direct = setShields(direct, 'm', 'you', true);
  s.submit({ type: 'shields', owner: 'you', rock: 'm', disabled: true }, 6.137);
  for (const hour of [6.219, 7.77, 9.131]) direct = advance(direct, hour, { rivals: true });
  direct = dispatch(direct, 'm', 'b', 10, 'you');
  s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 10 }, 9.131);
  assert.deepEqual(s.replay(18), advance(direct, 18, { rivals: true }));
});

test('specialist unit IDs authorize course changes without altering earlier manifests', () => {
  const base = createGame(0);
  base.rocks.find(r => r.id === 'm')!.specialists!.push({ id: 'navigator', kind: 'navigator', owner: 'you' });
  const s = session(base);
  const sent = s.submit({ type: 'dispatch', owner: 'you', from: 'm', to: 'b', drones: 10, specialists: ['navigator'] });
  const ready = advance(sent, 0.5, { rivals: false });
  const change = { action: 'course' as const, fleet: sent.fleets[0]!.id, to: 'i' };
  const changed = s.submit({ type: 'hauler', owner: 'you', change }, 0.5);
  assert.deepEqual(changed, commandHauler(ready, 'you', change));
  assert.equal(s.replay(0, 0.5).fleets[0]!.to, 'b');
  assert.equal(s.replay(0.5).fleets[0]!.to, 'i');
  assert.deepEqual(s.replay(8), advance(changed, 8, { rivals: false }));
});
