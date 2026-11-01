/** @format */
import { expect, test, type Locator } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from '../server/service';
import { createApi } from '../server/http';
import { createLegacyGame } from '../src/game/legacy';

async function fullyVisible(control: Locator) {
  await expect
    .poll(async () => {
      try {
        await control.scrollIntoViewIfNeeded({ timeout: 1000 });
      } catch (error) {
        if (String(error).includes('not attached to the DOM')) return false;
        throw error;
      }
      return control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        let left = Math.max(0, bounds.left),
          right = Math.min(innerWidth, bounds.right);
        let top = Math.max(0, bounds.top),
          bottom = Math.min(innerHeight, bounds.bottom);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent),
            clip = parent.getBoundingClientRect();
          if (style.overflowX !== 'visible') {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (style.overflowY !== 'visible') {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        return right - left >= bounds.width - 1 && bottom - top >= bounds.height - 1;
      });
    })
    .toBe(true);
}

for (const [width, height] of [
  [844, 390],
  [667, 375],
  [568, 320],
  [320, 568],
  [1024, 768],
] as const)
  test(`private transmission controls remain usable at ${width}×${height}`, async ({
    page,
    baseURL,
  }, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'machination-landscape-'));
    const host = randomBytes(32).toString('hex'),
      guest = randomBytes(32).toString('hex'),
      excluded = randomBytes(32).toString('hex');
    const service = await GameService.open(
      join(directory, 'rooms.json'),
      () => 1000,
      createLegacyGame,
    );
    const room = await service.create(host);
    await service.join(room.invite, guest);
    await service.join(room.invite, excluded);
    await service.start(room.id, host);
    const server = createApi(service, [new URL(baseURL!).origin]);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        ({ url, id, token }) => {
          localStorage.setItem('machination.briefing.v1', '1');
          sessionStorage.setItem('machination.online.v1', JSON.stringify({ url, id, token }));
        },
        {
          url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          id: room.id,
          token: host,
        },
      );
      await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
          ? route.continue()
          : route.abort(),
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
      await page.getByRole('button', { name: 'Time Machine', exact: true }).click();
      const timeEntry = page.getByRole('textbox', { name: 'Go to hours from now', exact: true });
      await timeEntry.fill('7.5');
      await page.getByRole('tab', { name: 'Signals', exact: true }).click();
      if (height < 400) await expect(timeEntry).toHaveCount(0);
      const thread = page.getByRole('tab', { name: 'Private · Vesper', exact: true });
      await fullyVisible(thread);
      await thread.click();
      const editor = page.getByRole('textbox', { name: 'Private transmission', exact: true });
      await fullyVisible(editor);
      await editor.fill('Landscape acceptance transmission.');
      await page.setViewportSize({ width: 390, height: 844 });
      await fullyVisible(editor);
      await expect(editor).toHaveValue('Landscape acceptance transmission.');
      await page.setViewportSize({ width, height });
      await fullyVisible(editor);
      await expect(editor).toHaveValue('Landscape acceptance transmission.');
      const send = page.getByRole('button', { name: 'Transmit privately', exact: true });
      await fullyVisible(send);
      expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await fullyVisible(page.getByRole('tab', { name: 'Chart', exact: true }));
      await page.screenshot({
        path: `.fettle/shots/landscape-transmission-${width}x${height}-${info.project.name}.png`,
      });
      await send.click();
      await expect(editor).toHaveValue('');
      expect(
        (await service.snapshot(room.id, guest)).messages.map((message) => message.text),
      ).toEqual(['Landscape acceptance transmission.']);
      expect((await service.snapshot(room.id, excluded)).messages).toHaveLength(0);
      await fullyVisible(
        page.getByRole('button', { name: 'Close Diplomacy and signals', exact: true }),
      );
      await page.getByRole('button', { name: 'Close Diplomacy and signals', exact: true }).click();
      await expect(timeEntry).toHaveValue('7.5');
      await page.getByRole('button', { name: 'Close time controls', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Focus your territory', exact: true }).click();
      await page
        .getByRole('button', { name: /^Mnemosyne,.*intelligence core/ })
        .filter({ visible: true })
        .first()
        .click();
      const choose = page.getByRole('button', {
        name: 'Choose transfer destination',
        exact: true,
      });
      await fullyVisible(choose);
      await choose.click();
      await page
        .getByRole('button', { name: /^Suture,/ })
        .filter({ visible: true })
        .first()
        .click();
      await page.setViewportSize({ width, height });
      const manifest = page.getByRole('textbox', { name: 'Online drone manifest', exact: true });
      await fullyVisible(manifest);
      await manifest.fill('12');
      const launch = page.getByRole('button', { name: 'Launch hauler', exact: true });
      await fullyVisible(launch);
      await expect(launch).toBeEnabled();
      await page.screenshot({
        path: `.fettle/shots/landscape-launch-${width}x${height}-${info.project.name}.png`,
      });
      await launch.click();
      await expect
        .poll(async () => (await service.snapshot(room.id, host)).game.fleets.length)
        .toBe(1);
      expect((await service.snapshot(room.id, host)).game.fleets[0]!.drones).toBe(12);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
