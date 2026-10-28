import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, advance, dispatch } from './simulation';
import { observe, forecastObservation } from './visibility';
import { setFunding } from './funding';
import { resign } from './retirement';
import { decodeSave } from './save-format';
import { newRecruitment } from './specialists';
import { ALL_PLAYERS } from './players';

function tenPlayers() {
  const g = createGame(0);
  g.rules = { players: [...ALL_PLAYERS], mode: 'mining', victoryTarget: 200, map: { generator: 'balanced.v1', seed: 1, width: 100, height: 100 } };
  g.rocks = ALL_PLAYERS.flatMap((owner, i) => {
    const base = g.rocks.find(r => r.id === 'a')!;
    g.recruitment![owner] = newRecruitment(i); g.cargo[owner] = 0; g.minesDrilled![owner] = 0;
    return Array.from({ length: 10 }, (_, j) => ({ ...base, id: `site-${i}-${j}`, name: `Site ${i}-${j}`, x: 5 + i * 9, y: 5 + j * 9,
      owner: j < 5 ? owner : null, coreOf: j === 0 ? owner : undefined, drones: j > 0 && j < 5 ? 40 : 0,
      specialists: j === 0 ? [{ id: `core-${owner}`, owner, kind: 'queen' as const }] : [] }));
  });
  return g;
}
test('configured participants are active in funding, sensor events, victory, retirement, and scoped forecasts', () => {
  let game = tenPlayers();
  game.cargo.zenith = 40; game.cargo.you = 0;
  game = setFunding(game, 'zenith', 'you', true);
  assert.equal(game.funding!.length, 1);
  game = dispatch(game, 'site-9-1', 'site-9-5', 10, 'zenith');
  const view = observe(game, 'zenith');
  assert.equal(Object.keys(view.standings!).length, 10);
  assert.ok(view.events.some(e => e.message.includes('dispatched')));
  assert.equal(JSON.stringify(view).includes('"seed"'), false);
  assert.deepEqual(forecastObservation(view, 'zenith', 1).rules, view.rules);
  assert.equal(advance(game, 1, { rivals: false }).winner, null);
  const remaining = { ...game, rules: { ...game.rules!, players: ['you', 'zenith'] as const as ['you', 'zenith'] } };
  assert.equal(resign(remaining, 'zenith').winner, 'you');
  assert.throws(() => resign(remaining, 'vesper'), /active|participat/);
});

test('configured saves validate only their participants and bounded generated chart without inventing inactive factions', () => {
  const game = tenPlayers();
  const raw = JSON.stringify({ savedAt: 0, game });
  assert.deepEqual(decodeSave(raw).game, JSON.parse(raw).game);
  for (const edit of [
    (g: any) => { g.rules.players.push('intruder'); },
    (g: any) => { g.rules.players[1] = 'you'; },
    (g: any) => { g.rules.players.reverse(); },
    (g: any) => { g.rules.victoryTarget = 1; },
    (g: any) => { g.rules.map.seed = -1; },
    (g: any) => { g.rocks[0].x = 1000; },
    (g: any) => { g.rocks.pop(); },
    (g: any) => { delete g.cargo.zenith; },
    (g: any) => { delete g.recruitment.zenith; },
  ]) { const broken = JSON.parse(raw); edit(broken.game); assert.throws(() => decodeSave(JSON.stringify(broken))); }
});

test('domination ends at the territorial target, forbids mines, and ignores the mining quota', async () => {
  const { drillMine } = await import('./economy');
  let game = tenPlayers();
  game.rules = { ...game.rules!, mode: 'domination', victoryTarget: 50 };
  let given = 5;
  for (const rock of game.rocks) if (rock.owner === null && given < 49) { rock.owner = 'you'; given++; }
  game.cargo.vesper = 200;
  assert.equal(advance(game, 0.1, { rivals: false }).winner, null);
  assert.throws(() => drillMine(game, 'site-0-1', 'you'), /domination/i);
  const target = game.rocks.find(r => r.owner === null)!;
  const source = game.rocks.find(r => r.owner === 'you' && r.drones === 40)!;
  game = dispatch(game, source.id, target.id, 1, 'you');
  const end = advance(game, game.fleets[0]!.arrives, { rivals: false });
  assert.equal(end.winner, 'you');
  assert.equal(end.rocks.filter(r => r.owner === 'you').length, 50);
  assert.ok(end.events[0]!.message.includes('domination'));
});
