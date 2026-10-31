import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance as advanceEngine, type Game } from './simulation';
import { observe } from './visibility';
import { fleetPosition, flightEndpoints } from './flight';
import { worldDistance } from './geometry';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import { decodeReplay } from './replay-save';
import { recruitmentStatus } from './specialists';

function advance(game: Game, hour: number): Game {
  let steps = 0;
  return advanceEngine(game, hour, { rivals: false, stopWhen: () => {
    assert.ok(++steps <= 100_000, 'succession acceptance event budget exceeded');
    return false;
  } });
}

// Both offers and the distinguishing geometry were found through public observations.
const scenario = { seed: 670, recruitmentSeed: 607, movingDestination: 's', parkedDestination: 'p', opponentDeparture: 'g' };

for (const mode of ['mining', 'domination'] as const) for (const reverse of [false, true]) {
  test(`nearest moving Princess succeeds a captured Queen: ${mode}, reverse=${reverse}`, () => {
    const baseline = createConfiguredGame({ playerCount: 2, mode, driftingBases: false, gravity: false }, 0, scenario.seed, { you: scenario.recruitmentSeed });
    const untouched = JSON.stringify(baseline);
    const retained = createArchive(baseline);
    const core = observe(baseline, 'you').rocks.find(r => r.known && r.specialists?.some(u => u.kind === 'queen' && u.owner === 'you'))!;
    // The opponent voluntarily discloses its own departure site for arranged combat.
    assert.equal(observe(baseline, 'vesper').rocks.find(r => r.id === scenario.opponentDeparture)!.owner, 'vesper');
    const entries: ReplayEntry[] = [];
    let game = advance(baseline, 4);
    const submit = (command: GameCommand) => {
      const next = executeCommand(game, command);
      entries.push({ hour: game.hour, command });
      game = next;
    };
    const hirePrincess = () => {
      assert.ok(observe(game, 'you').recruitment!.you!.offers.includes('princess'));
      submit({ type: 'hire', owner: 'you', kind: 'princess' });
      return observe(game, 'you').rocks.find(r => r.id === core.id)!.specialists!.find(u => u.kind === 'princess')!;
    };
    const parked = hirePrincess();
    submit({ type: 'dispatch', owner: 'you', from: core.id, to: scenario.parkedDestination, drones: 0, specialists: [parked.id] });
    game = advance(game, 22);
    assert.ok(game.rocks.find(r => r.id === scenario.parkedDestination)!.specialists!.some(u => u.id === parked.id));
    const moving = hirePrincess();
    game = advance(game, 40);
    submit({ type: 'dispatch', owner: 'you', from: core.id, to: scenario.movingDestination, drones: 0, specialists: [moving.id] });
    const queen = observe(game, 'you').rocks.find(r => r.id === core.id)!.specialists!.find(u => u.kind === 'queen')!;
    const convoys: GameCommand[] = [
      { type: 'dispatch', owner: 'you', from: core.id, to: scenario.opponentDeparture, drones: 0, specialists: [queen.id] },
      { type: 'dispatch', owner: 'vesper', from: scenario.opponentDeparture, to: core.id, drones: 1 },
    ];
    for (const command of reverse ? [...convoys].reverse() : convoys) submit(command);
    const departure = Math.max(...game.fleets.map(f => f.departed));
    game = advance(game, departure);
    const contact = nextRouteEncounter(game);
    assert.ok(Number.isFinite(contact) && contact > departure);
    const queenFlight = game.fleets.find(f => f.specialists?.some(u => u.id === queen.id))!;
    const endpoints = flightEndpoints(game, queenFlight);
    const fraction = (contact - queenFlight.departed) / (queenFlight.arrives - queenFlight.departed);
    const lossPoint = { x: endpoints.from.x + (endpoints.to.x - endpoints.from.x) * fraction,
      y: endpoints.from.y + (endpoints.to.y - endpoints.from.y) * fraction };
    const approaching = advance(game, departure + (contact - departure) / 2);
    assert.deepEqual(approaching.eliminated, []);
    assert.ok(approaching.fleets.some(f => f.specialists?.some(u => u.id === queen.id && !u.captive)));

    game = advance(game, contact);
    const fallback = game.fleets.find(f => f.specialists?.some(u => u.id === moving.id))!;
    assert.ok(fallback && !fallback.preparing && fallback.departed < contact && fallback.arrives > contact);
    const movingDistance = worldDistance(game, fleetPosition(game, fallback), lossPoint);
    const parkedDistance = worldDistance(game, game.rocks.find(r => r.id === scenario.parkedDestination)!, lossPoint);
    const originDistance = worldDistance(game, core, lossPoint);
    assert.ok(movingDistance < parkedDistance && parkedDistance < originDistance,
      'the in-flight position must win; comparing its departure site would choose the parked Princess');
    assert.equal(fallback.specialists!.find(u => u.id === moving.id)!.kind, 'queen');
    assert.equal(game.rocks.find(r => r.id === scenario.parkedDestination)!.specialists!.find(u => u.id === parked.id)!.kind, 'princess');
    assert.ok(game.fleets.some(f => f.owner === 'vesper' && f.specialists?.some(u => u.id === queen.id && u.captive && u.owner === 'you')));
    assert.deepEqual(game.eliminated, []);
    assert.equal(game.winner, null);
    assert.equal(game.draw, undefined);
    assert.deepEqual([...game.rocks, ...game.fleets].flatMap(a => a.specialists ?? [])
      .filter(u => u.owner === 'you' && u.kind === 'queen' && !u.captive).map(u => u.id), [moving.id]);
    assert.equal(recruitmentStatus(game, 'you').at, undefined, 'the new Queen is still traveling');
    assert.equal(recruitmentStatus(game, 'you').credits, 1);
    assert.throws(() => executeCommand(game, { type: 'hire', owner: 'you', kind: recruitmentStatus(game, 'you').offers[0]! }), /active core at a controlled site/);
    assert.equal(observe(game, 'you').eliminated.includes('you'), false);

    const atCapture = game;
    const destination = game.rocks.find(r => r.id === scenario.movingDestination)!;
    const arrival = fallback.arrives;
    game = advance(game, arrival);
    assert.equal(game.rocks.find(r => r.id === destination.id)!.coreOf, 'you');
    assert.ok(game.rocks.find(r => r.id === destination.id)!.specialists!.some(u => u.id === moving.id && u.kind === 'queen' && !u.captive));
    assert.equal(game.rocks.find(r => r.id === core.id)!.coreOf, undefined);
    assert.equal(recruitmentStatus(game, 'you').at, destination.id);
    assert.deepEqual(game.eliminated, []);
    assert.equal(JSON.stringify(baseline), untouched);
    assert.deepEqual(exportArchive(retained).baseline, baseline);
    assert.deepEqual(exportArchive(retained).entries, []);
    const data = { ...exportArchive(retained), entries };
    const archive = restoreArchive(data);
    const options = { rivals: false, knownThrough: arrival };
    for (const checkpoint of [atCapture, game]) {
      assert.deepEqual(replayTo(archive, checkpoint.hour, options), checkpoint);
      const saved = decodeSave(JSON.stringify({ savedAt: 0, game: checkpoint, replay: data }));
      assert.deepEqual(saved.game, checkpoint);
      assert.deepEqual(replayTo(decodeReplay(JSON.parse(JSON.stringify(data)), saved.game, false), checkpoint.hour, options), checkpoint);
    }
    let partitioned = baseline;
    const move = (hour: number) => {
      if (hour > partitioned.hour) partitioned = advance(partitioned, partitioned.hour + (hour - partitioned.hour) * 0.371);
      if (hour > partitioned.hour) partitioned = advance(partitioned, hour);
    };
    for (const entry of entries) { move(entry.hour); partitioned = executeCommand(partitioned, entry.command); }
    move(contact);
    assert.deepEqual(partitioned, atCapture);
    move(arrival);
    assert.deepEqual(partitioned, game);
    const available = recruitmentStatus(game, 'you');
    const hired = executeCommand(game, { type: 'hire', owner: 'you', kind: available.offers[0]! });
    assert.equal(recruitmentStatus(hired, 'you').credits, 0);
    const priorUnits = new Set(game.rocks.find(r => r.id === destination.id)!.specialists!.map(u => u.id));
    assert.ok(hired.rocks.find(r => r.id === destination.id)!.specialists!.some(u => !priorUnits.has(u.id) && u.kind === available.offers[0]));
  });
}
