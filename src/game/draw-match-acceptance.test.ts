import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfiguredGame } from './world';
import { advance as advanceEngine, type Game } from './simulation';
import { observe } from './visibility';
import { nextRouteEncounter } from './route-encounters';
import { createArchive, executeCommand, exportArchive, replayTo, restoreArchive, type GameCommand, type ReplayEntry } from './replay';
import { decodeSave } from './save-format';
import { decodeReplay } from './replay-save';

function advance(game: Game, hour: number): Game {
  let steps = 0;
  return advanceEngine(game, hour, { rivals: false, stopWhen: () => {
    assert.ok(++steps <= 100_000, 'draw acceptance event budget exceeded');
    return false;
  } });
}

for (const mode of ['mining', 'domination'] as const) {
  test(`configured stationary two-seat ${mode} match draws through recruited Martyr convoy contact`, () => {
    // Seed selection consults only this seat's public offers, never its private deck.
    let seed = 1;
    while (seed <= 100 && !observe(createConfiguredGame({ playerCount: 2, mode, driftingBases: false, gravity: false }, 0, seed), 'you').recruitment!.you!.offers.includes('martyr')) seed++;
    assert.ok(seed <= 100, 'bounded seed search must find an offered Martyr');
    const baseline = createConfiguredGame({ playerCount: 2, mode, driftingBases: false, gravity: false }, 0, seed);
    const untouched = JSON.stringify(baseline);
    const retained = createArchive(baseline);
    const players = baseline.rules!.players;
    assert.equal(players.length, 2);
    assert.ok(baseline.rocks.every(r => !r.drift));
    // Each consenting seat discloses its own Queen's location to arrange the battle.
    const cores = new Map(players.map(owner => [owner, observe(baseline, owner).rocks.find(r =>
      r.known && r.specialists?.some(u => u.owner === owner && u.kind === 'queen'))!.id]));
    const entries: ReplayEntry[] = [];
    let game = advance(baseline, 4);
    const submit = (command: GameCommand) => {
      const next = executeCommand(game, command);
      entries.push({ hour: game.hour, command });
      game = next;
    };
    assert.ok(observe(game, 'you').recruitment!.you!.offers.includes('martyr'));
    submit({ type: 'hire', owner: 'you', kind: 'martyr' });
    const hired = observe(game, 'you').rocks.find(r => r.id === cores.get('you'))!.specialists!.find(u => u.kind === 'martyr')!;
    assert.ok(hired);
    for (const owner of players) {
      const donor = observe(game, owner).rocks.find(r => r.known && r.owner === owner && r.drones! >= 40)!;
      assert.ok(donor);
      submit({ type: 'dispatch', owner, from: donor.id, to: cores.get(owner)!, drones: 40 });
    }
    game = advance(game, Math.max(...game.fleets.map(f => f.arrives)));
    for (const owner of players) {
      const source = observe(game, owner).rocks.find(r => r.id === cores.get(owner))!;
      const queen = source.specialists!.find(u => u.kind === 'queen' && u.owner === owner)!;
      assert.ok(source.known && source.drones! >= 1);
      submit({ type: 'dispatch', owner, from: source.id, to: cores.get(players.find(p => p !== owner)!)!, drones: 1,
        specialists: owner === 'you' ? [queen.id, hired.id] : [queen.id] });
    }
    const departure = Math.max(...game.fleets.map(f => f.departed));
    game = advance(game, departure);
    assert.equal(game.fleets.length, 2);
    assert.ok(game.fleets.every(f => f.specialists?.some(u => u.kind === 'queen' && !u.captive)));
    assert.ok(game.fleets.some(f => f.specialists?.some(u => u.id === hired.id)));
    const contact = nextRouteEncounter(game);
    assert.ok(Number.isFinite(contact) && contact > game.hour);
    assert.ok(game.fleets.every(f => contact < f.arrives));
    const beforeContact = advance(game, game.hour + (contact - game.hour) / 2);
    assert.equal(beforeContact.draw, undefined);
    assert.equal(beforeContact.winner, null);
    assert.deepEqual(beforeContact.eliminated, []);
    game = advance(game, contact + 24);
    assert.equal(game.hour, contact);
    assert.equal(game.draw, true);
    assert.equal(game.winner, null);
    assert.deepEqual(new Set(game.eliminated), new Set(players));
    assert.ok(![...game.rocks, ...game.fleets].some(a => a.specialists?.some(u => u.kind === 'queen')));
    assert.equal(game.fleets.length, 0);
    for (const owner of players) {
      const view = observe(game, owner);
      assert.equal(view.draw, true);
      assert.equal(view.winner, null);
      assert.deepEqual(new Set(view.eliminated), new Set(players));
      const source = view.rocks.find(r => r.known && r.owner === owner && !r.destroyed && r.drones! >= 1)!;
      assert.ok(source, 'postgame dispatch otherwise has a valid owned source');
      assert.throws(() => executeCommand(game, { type: 'dispatch', owner, from: source.id, to: cores.get(owner)!, drones: 1 }), /no longer operational/);
      assert.throws(() => executeCommand(game, { type: 'hire', owner, kind: 'martyr' }), /active intelligence/);
      assert.equal(game.cargo[owner], 0);
      assert.ok(game.rocks.filter(r => r.owner === owner).length < game.rules!.victoryTarget);
    }
    assert.deepEqual(advance(game, contact + 100), game);
    assert.equal(JSON.stringify(baseline), untouched, 'commands and advancement preserve the generated baseline');
    assert.deepEqual(exportArchive(retained).baseline, baseline);
    assert.deepEqual(exportArchive(retained).entries, []);
    const data = { ...exportArchive(retained), entries };
    const archive = restoreArchive(data);
    const options = { rivals: false, knownThrough: contact + 100 };
    assert.deepEqual(replayTo(archive, contact, options), game);
    assert.deepEqual(replayTo(archive, contact + 100, options), game);
    const saved = decodeSave(JSON.stringify({ savedAt: 0, game, replay: data }));
    assert.deepEqual(saved.game, game);
    assert.deepEqual(replayTo(decodeReplay(JSON.parse(JSON.stringify(data)), saved.game, false), contact, options), game);
    let partitioned = baseline;
    const move = (hour: number) => {
      if (hour > partitioned.hour) partitioned = advance(partitioned, partitioned.hour + (hour - partitioned.hour) * 0.371);
      if (hour > partitioned.hour) partitioned = advance(partitioned, hour);
    };
    for (const entry of entries) {
      move(entry.hour);
      partitioned = executeCommand(partitioned, entry.command);
    }
    move(departure);
    move(beforeContact.hour);
    move(contact + 24);
    assert.deepEqual(partitioned, game);
    // Official Martyr destruction and Queen elimination rules don't specify draw UI.
    // This asserts the local engine contract, not current original-client presentation parity.
  });
}
