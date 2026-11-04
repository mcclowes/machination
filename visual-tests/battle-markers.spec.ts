import { expect, test } from '@playwright/test';
import { createConfiguredGame } from '../src/game/world';
import { advance, dispatch } from '../src/game/simulation';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';
import { waitForChartLayout } from './chart-layout';
import { freezeWallTime } from './wall-time';

const epoch = Date.parse('2026-10-13T12:00:00Z');
let game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, epoch, 42);
const source = game.rocks.find(site => site.owner === 'you' && site.drones >= 20)!;
const target = game.rocks.find(site => !site.owner)!;
game = dispatch(game, source.id, target.id, 20, 'you');
game = advance(game, game.fleets[0]!.arrives, { rivals: false });
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('recent battles appear on the chart and expire in forecast', async ({ page }, info) => {
  const battle = game.events.find(event => event.battle?.site === target.id)!.battle!;
  expect(battle.toward).toBeDefined();
  expect(game.rocks.find(site => site.id === target.id)!.shield).toBe(0);
  const contact = { x: battle.toward!.x * 18, y: battle.toward!.y * 18 };
  await freezeWallTime(page, epoch);
  await page.addInitScript(raw => {
    if (location.protocol.startsWith('http')) localStorage.setItem('machination.game.v1', raw);
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/');
  expect(await page.evaluate(() => [Date.now(), new Date().getTime()])).toEqual([epoch, epoch]);
  await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
  await page.getByRole('button', { name: /^(Open|Resume) solo operation$/ }).click();
  await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
  await waitForChartLayout(page);
  const marker = page.locator('[id^="battle-marker-"]').first();
  await expect(marker).toBeVisible();
  await expect(marker).toHaveAttribute('aria-label', 'Battle, just now');
  await expect(page.locator('[id^="battle-marker-"] text')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(({ name, contact }) => {
    const boxes = Array.from(document.querySelectorAll('[aria-label]')).filter(element => element.getAttribute('aria-label')?.startsWith(name + ','))
      .map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; });
    const map = document.querySelector('[data-testid="belt-map"]')!.getBoundingClientRect();
    const markers = Array.from(document.querySelectorAll('[id^="battle-marker-"] circle')).map(element => {
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      return { x, y, distance: Math.min(...boxes.map(box => Math.hypot(box.x + contact.x - x, box.y + contact.y - y))) };
    }).filter(point => point.x >= map.left && point.x <= map.right && point.y >= map.top && point.y <= map.bottom);
    return markers.length > 0 && markers.every(point => point.distance < 1);
  }, { name: target.name, contact })).toBe(true);
  await page.screenshot({ path: `.fettle/shots/recent-battle-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Time Machine', exact: true }).click();
  await page.getByRole('button', { name: '+6h', exact: true }).click();
  await expect(page.locator('[id^="battle-marker-"]')).toHaveCount(0);
  expect(await page.evaluate(() => [Date.now(), new Date().getTime()])).toEqual([epoch, epoch]);
});
