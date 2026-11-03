import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { GameService } from '../server/service';
import { createApi } from '../server/http';

test('host assigns and removes lobby bots, then starts with a human guest', async ({ page, baseURL }, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-bot-ui-'));
  const service = await GameService.open(join(dir, 'games.json'), () => 1000);
  const token = 'a'.repeat(64);
  const room = await service.create(token, { playerCount: 3, mode: 'mining', gravity: false });
  await service.join(room.invite, 'b'.repeat(64));
  const server = createApi(service, [new URL(baseURL!).origin]);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.addInitScript(session => {
      if (location.protocol.startsWith('http')) sessionStorage.setItem('machination.online.v1', JSON.stringify(session));
    }, { url, token, id: room.id });
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
    await page.getByRole('button', { name: /^(Resume multiplayer operation|Open multiplayer uplink|All multiplayer operations)/ }).first().click();
    await page.getByRole('button', { name: 'Open lobby and invitation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start operation', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Assign bot', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Assign bot', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove bot', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start operation', exact: true })).toBeEnabled();
    expect((await service.snapshot(room.id, token)).bots).toEqual(['null']);
    await page.getByRole('button', { name: 'Remove bot', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start operation', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Assign bot', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start operation', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Start operation', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.fettle/shots/bot-lobby-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Start operation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove bot', exact: true })).toHaveCount(0);
    expect((await service.snapshot(room.id, token)).status).toBe('game.active');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
