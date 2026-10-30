import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredGame } from './world';
import { observe } from './visibility';
import { intelligenceReport } from './intelligence';
import { advance } from './simulation';

test('scoreboard ranks by public score, shares tied ranks, and keeps eliminated players last', () => {
  const game = createConfiguredGame({ playerCount: 4, mode: 'mining' }, 0, 42);
  game.cargo = { you: 12, vesper: 40, null: 40, aether: 90 };
  game.eliminated = ['aether'];
  const report = intelligenceReport(observe(game, 'you'), 'you');
  assert.deepEqual(report.rows.map(r => [r.faction, r.rank, r.score]), [
    ['vesper', 1, 40], ['null', 1, 40], ['you', 3, 12], ['aether', undefined, 90],
  ]);
  assert.equal(report.target, 300);
  assert.equal(report.scoreLabel, 'Cargo');
});

test('drones keep rivals observational and use real specialist and sponsor production', () => {
  let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 42);
  game.hour = 24;
  const core = game.rocks.find(r => r.coreOf === 'you')!;
  core.kind = 'factory'; core.drones = 10; core.productionAt = 32; core.productionInterval = 8;
  core.specialists!.push({ id: 'foreman', owner: 'you', kind: 'foreman' }, { id: 'tycoon', owner: 'you', kind: 'tycoon' });
  game.rocks = [core, ...game.rocks.filter(r => r.owner !== 'you')];
  game.funding = [{ from: 'vesper', to: 'you' }];
  game.cargo = { you: 0, vesper: 30 };
  game = advance(game, game.hour, { rivals: false });
  const report = intelligenceReport(observe(game, 'you'), 'you');
  const own = report.rows.find(r => r.faction === 'you')!;
  assert.equal(own.drones, 10);
  assert.equal(own.observed, false);
  assert.equal(own.capacity, 200);
  assert.equal(own.production, 67.5);
  const cycle = game.rocks.find(r => r.id === core.id)!.productionInterval!;
  const next = advance(game, game.hour + cycle, { rivals: false });
  assert.equal(next.rocks.find(r => r.id === core.id)!.drones - game.rocks.find(r => r.id === core.id)!.drones, own.production * cycle / 24);
  const enemy = report.rows.find(r => r.faction === 'vesper')!;
  assert.equal(enemy.observed, true);
  assert.equal(enemy.capacity, undefined);
  assert.equal(enemy.production, undefined);
});

test('team ranks compare combined cargo once per team and project combined mining income', () => {
  const game = createConfiguredGame({ playerCount: 4, teamFormat: '2v2', mode: 'mining' }, 0, 42);
  game.cargo = { you: 100, vesper: 110, null: 180, aether: 10 };
  const view = observe(game, 'you');
  view.rocks = game.rocks.map(r => ({ ...r, known: true }));
  const report = intelligenceReport(view, 'you');
  assert.deepEqual(report.rows.map(r => [r.faction, r.score, r.rank]), [['you', 210, 1], ['vesper', 210, 1], ['null', 190, 2], ['aether', 190, 2]]);
  assert.equal(report.projection?.team, 1);
  assert.equal(report.projection?.hours, 180);
});

test('mining race uses current income rather than score order, and hides estimates affected by fog', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 42);
  game.hour = 24;
  game.cargo = { you: 290, vesper: 280 };
  const mine = game.rocks.find(r => r.owner === 'you' && r.kind === 'mine')!;
  const rivalMine = game.rocks.find(r => r.owner === 'vesper' && r.kind === 'mine')!;
  game.rocks = [mine, { ...mine, id: 'second-site', kind: 'factory' }, rivalMine,
    ...Array.from({ length: 4 }, (_, i) => ({ ...rivalMine, id: `rival-${i}` }))];
  for (const site of game.rocks) if (site.kind === 'mine') site.miningInterval = site.owner === 'you' ? 12 : 4.8;
  const view = observe(game, 'you');
  view.rocks = game.rocks.map(r => ({ ...r, known: true }));
  const report = intelligenceReport(view, 'you');
  assert.equal(report.rows[0]!.faction, 'you');
  assert.equal(report.rows[0]!.income, 2);
  assert.equal(report.rows[1]!.income, 25);
  assert.deepEqual(report.projection, { faction: 'vesper', team: undefined, hours: 19.2 });
  view.rocks = view.rocks.map(r => r.id === rivalMine.id ? { id: r.id, name: r.name, x: r.x, y: r.y, owner: r.owner, kind: 'mine', known: false } : r);
  const obscured = intelligenceReport(view, 'you');
  assert.equal(obscured.rows[1]!.income, undefined);
  assert.equal(obscured.projection, undefined);
});

test('traveling drones count toward capacity, while empty, disabled, and exhausted mines stop income', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 42);
  const core = game.rocks.find(r => r.coreOf === 'you')!;
  const mine = game.rocks.find(r => r.owner === 'you' && r.kind === 'mine')!;
  const destination = game.rocks.find(r => r.owner === 'vesper')!;
  game.fleets = [{ id: 1, owner: 'you', from: core.id, to: destination.id, drones: 17, departed: 0, arrives: 8 }];
  const inventory = game.rocks.filter(r => r.owner === 'you').reduce((n, r) => n + r.drones, 17);
  const own = () => intelligenceReport(observe(game, 'you'), 'you').rows.find(r => r.faction === 'you')!;
  assert.equal(own().drones, inventory);
  assert.equal(own().income, 6);
  mine.reserves = 0; assert.equal(own().income, 0);
  mine.reserves = 120; mine.pulseDisabled = true; assert.equal(own().income, 0);
  delete mine.pulseDisabled; mine.miningDisabledUntil = 2; assert.equal(own().income, 0);
  game.eliminated = ['you']; assert.equal(own().income, 0);
});

test('domination uses public sites, pulse has no cargo victory projection, and legacy hidden scores stay unknown', () => {
  const game = createConfiguredGame({ playerCount: 2, mode: 'domination' }, 0, 42);
  const report = intelligenceReport(observe(game, 'you'), 'you');
  assert.equal(report.scoreLabel, 'Sites');
  assert.equal(report.target, 10);
  assert.equal(report.rows[0]!.score, 6);
  assert.equal(report.projection, undefined);
  const pulse = createConfiguredGame({ playerCount: 2, mode: 'pulse' }, 0, 42);
  const pulseReport = intelligenceReport(observe(pulse, 'you'), 'you');
  assert.equal(pulseReport.scoreLabel, 'Material');
  assert.equal(pulseReport.target, undefined);
  assert.equal(pulseReport.projection, undefined);
  const legacy = observe(game, 'you');
  legacy.version = 1; delete legacy.standings; legacy.rules!.mode = 'mining';
  legacy.rocks = legacy.rocks.map(r => !r.known ? { id: r.id, name: r.name, x: r.x, y: r.y, kind: 'unknown', known: false } : r);
  const hidden = intelligenceReport(legacy, 'you');
  const rival = hidden.rows.find(r => r.faction === 'vesper')!;
  assert.equal(rival.production, undefined);
  assert.equal(rival.score, undefined);
  assert.equal(rival.rank, undefined);
  assert.equal(rival.sites, undefined);
  assert.equal(rival.mines, undefined);
});
