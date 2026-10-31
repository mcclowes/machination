/** @format */
import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from '../server/service';
import { createApi } from '../server/http';
import { createLegacyGame } from '../src/game/legacy';

for (const width of [320, 1024])
  test(`confirmed message blocks remain usable at ${width}px`, async ({ page, baseURL }, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'machination-message-blocks-browser-'));
    const host = randomBytes(32).toString('hex'),
      guest = randomBytes(32).toString('hex');
    const service = await GameService.open(
      join(directory, 'rooms.json'),
      () => 1000,
      createLegacyGame,
    );
    const room = await service.create(host);
    await service.join(room.invite, guest);
    await service.join(room.invite, randomBytes(32).toString('hex'));
    await service.start(room.id, host);
    await service.channelMessage(room.id, guest, {
      requestId: randomUUID(),
      channelId: 'public',
      text: 'Unwanted public transmission',
    });
    const server = createApi(service, [new URL(baseURL!).origin]);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        ({ url, id, token }) => {
          if (location.protocol === 'http:') {
            localStorage.setItem('machination.briefing.v1', '1');
            sessionStorage.setItem('machination.online.v1', JSON.stringify({ url, id, token }));
          }
        },
        { url, id: room.id, token: host },
      );
      await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
          ? route.continue()
          : route.abort(),
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
      await page.getByRole('tab', { name: 'Signals', exact: true }).click();
      await expect(page.getByText('Unwanted public transmission', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Message blocking', exact: true }).click();
      const block = page.getByRole('button', { name: 'Block Vesper', exact: true });
      await expect(block).toBeEnabled();
      await block.scrollIntoViewIfNeeded();
      expect((await block.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await block.click();
      const unblock = page.getByRole('button', { name: 'Unblock Vesper', exact: true });
      await expect(unblock).toBeEnabled();
      await expect(page.getByText('Unwanted public transmission', { exact: true })).toHaveCount(0);
      expect((await service.messageBlockSettings(room.id, host)).blocked).toEqual(['vesper']);
      await unblock.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `.fettle/shots/message-blocks-${width}-${info.project.name}.png`,
      });
      await unblock.click();
      await expect(page.getByRole('button', { name: 'Block Vesper', exact: true })).toBeEnabled();
      expect((await service.messageBlockSettings(room.id, host)).blocked).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
