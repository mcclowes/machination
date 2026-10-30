import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createConfiguredGame } from '../src/game/world';
import { DEFAULT_GAME_OPTIONS } from '../src/game/rules';
import { createArchive } from '../src/game/replay';
import { encodeOperation } from '../src/game/operation-save';

const epoch = Date.parse('2026-10-13T12:00:00Z');
const game = createConfiguredGame(DEFAULT_GAME_OPTIONS, epoch, 314159);
const saved = encodeOperation({ game, archive: createArchive(game, { rivals: true }) }, epoch);

test('the visible roller supports direct time travel and retains precise controls', async ({ page, isMobile }, testInfo) => {
  page.on('pageerror', error => { throw error; });
  await page.clock.setFixedTime(new Date(epoch));
  await page.addInitScript(raw => {
    localStorage.setItem('machination.game.v1', raw);
    localStorage.setItem('machination.briefing.v1', '1');
  }, saved);
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  const wheel = page.getByLabel('Operation timeline', { exact: true });
  await expect(wheel).toBeVisible();
  await expect(page.getByLabel('Go to hours from now', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await mkdir('.fettle/shots', { recursive: true });
  await page.screenshot({ path: `.fettle/shots/time-wheel-${testInfo.project.name}-live.png` });
  const box = (await wheel.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let dx = 7; dx <= 84; dx += 7) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - dx, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 84, y, { steps: 12 });
    await page.mouse.up();
  }
  await expect(page.getByText(/Forecast · D01 · 03:00/)).toBeVisible();
  await expect(page.getByLabel('Go to hours from now', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `.fettle/shots/time-wheel-${testInfo.project.name}-forecast.png` });
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.getByText(/Live · D01 · 00:00/)).toBeVisible();
  if (!isMobile) {
    await wheel.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByText(/Forecast · D01 · 01:00/)).toBeVisible();
    await page.keyboard.press('Home');
    await expect(page.getByText(/Live · D01 · 00:00/)).toBeVisible();
    await wheel.hover();
    await page.mouse.wheel(28, 0);
    await expect(page.getByText(/Forecast · D01 · 01:00/)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Time Machine', exact: true }).click();
  await page.getByLabel('Go to hours from now', { exact: true }).fill('8.25');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.getByText(/Forecast · D01 · 08:15/)).toBeVisible();
  await expect(wheel).toBeVisible();
});
