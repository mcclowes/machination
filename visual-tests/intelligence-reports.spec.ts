import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createConfiguredGame } from '../src/game/world';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';
import { GameService } from '../server/service';
import { createApi } from '../server/http';
import type { Game } from '../src/game/simulation';

const epoch = Date.parse('2026-10-30T12:00:00Z');
const localOnly = async (page: Page) => page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());

async function openSolo(page: Page, game: Game) {
  const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await localOnly(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await page.getByRole('tab', { name: 'Intel', exact: true }).click();
}

test('solo intelligence ranks the race, switches columns, and funds a player', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const game = createConfiguredGame({ playerCount: 6, mode: 'mining' }, epoch, 42);
  game.cargo = { you: 63, vesper: 53, null: 53, aether: 46, umbra: 31, orbit: 0 };
  game.eliminated = ['orbit'];
  for (const [i, site] of game.rocks.entries()) { site.x = 60 + i % 10; site.y = 60 + Math.floor(i / 10); }
  const extraMine = game.rocks.find(r => r.owner === 'vesper' && r.kind === 'factory' && !r.coreOf)!;
  extraMine.kind = 'mine'; extraMine.miningAt = 4; extraMine.miningInterval = 4;
  game.minesDrilled!.vesper = 2;
  await openSolo(page, game);
  const board = page.getByTestId('intelligence-reports');
  await expect(board.getByRole('heading', { name: 'Intelligence reports' })).toBeVisible();
  await expect(board.getByText('Vesper could win in 20.6 days', { exact: true })).toBeVisible();
  const ids = await board.locator('[data-testid^="intelligence-row-"]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-testid')));
  expect(ids).toEqual(['intelligence-row-you', 'intelligence-row-vesper', 'intelligence-row-null', 'intelligence-row-aether', 'intelligence-row-umbra', 'intelligence-row-orbit']);
  await expect(page.getByTestId('intelligence-row-you')).toBeInViewport({ ratio: 0.95 });
  await expect(page.getByTestId('intelligence-row-you').getByText('63', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/intelligence-drones-${info.project.name}.png` });
  await board.getByRole('tab', { name: 'Sites', exact: true }).click();
  await expect(page.getByTestId('intelligence-row-you').getByText('6 sites', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/intelligence-sites-${info.project.name}.png` });
  await board.getByRole('tab', { name: 'Funding', exact: true }).click();
  await expect(board.getByRole('button', { name: 'Fund Vesper', exact: true })).toBeDisabled();
  await board.getByRole('button', { name: 'Fund Umbra', exact: true }).click();
  await expect(board.getByRole('button', { name: 'Withdraw funding from Umbra', exact: true })).toBeEnabled();
  await board.getByRole('heading', { name: 'Intelligence reports' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.fettle/shots/intelligence-funding-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('team domination ranks combined sites and omits funding actions', async ({ page }, info) => {
  const game = createConfiguredGame({ playerCount: 4, teamFormat: '2v2', mode: 'domination' }, epoch, 42);
  await openSolo(page, game);
  const board = page.getByTestId('intelligence-reports');
  await expect(board.getByText('Sites · goal 20 · ranked by team total', { exact: true })).toBeVisible();
  await expect(page.getByTestId('intelligence-row-you').getByText('12', { exact: true })).toBeVisible();
  await expect(board.getByRole('tab', { name: 'Funding', exact: true })).toHaveCount(0);
  await board.getByRole('tab', { name: 'Sites', exact: true }).click();
  await expect(page.getByTestId('intelligence-row-you').getByText('6 sites', { exact: true })).toBeVisible();
  await page.screenshot({ path: `.fettle/shots/intelligence-teams-${info.project.name}.png` });
});

test('online intelligence uses public scores and preserves fog of war', async ({ page }, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-scoreboard-'));
  const service = await GameService.open(join(dir, 'games.json'), () => 1000);
  const token = 'a'.repeat(64), guest = 'b'.repeat(64);
  const room = await service.create(token, { playerCount: 2, mode: 'mining' });
  await service.join(room.invite, guest); await service.start(room.id, token);
  const server = createApi(service, [String(info.project.use.baseURL)]);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.addInitScript(session => {
      if (location.protocol.startsWith('http')) sessionStorage.setItem('machination.online.v1', JSON.stringify(session));
    }, { url, token, id: room.id });
    await localOnly(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await page.getByRole('tab', { name: 'Intel', exact: true }).click();
    const board = page.getByTestId('intelligence-reports');
    await expect(board.getByRole('heading', { name: 'Intelligence reports' })).toBeVisible();
    await expect(page.getByTestId('intelligence-row-vesper').getByText(/observed$/)).toBeVisible();
    await expect(page.getByTestId('intelligence-row-vesper').getByText('Capacity and production unknown', { exact: true })).toBeVisible();
    await expect(board.getByText(/Winner estimate unavailable/)).toBeVisible();
    await page.screenshot({ path: `.fettle/shots/intelligence-online-${info.project.name}.png` });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
