import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { GameService } from '../server/service';
import { createApi } from '../server/http';

for (const completed of [false, true]) test(`faction progression ${completed ? 'after' : 'before'} the first completed operation`, async ({ page }, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'machination-faction-ui-'));
  const service = await GameService.open(join(dir, 'games.json'), () => 1000);
  const token = 'a'.repeat(64), guest = 'b'.repeat(64);
  const room = await service.create(token, { playerCount: 2, mode: 'domination' });
  await service.join(room.invite, guest);
  await service.start(room.id, token);
  if (completed) {
    const other = await service.snapshot(room.id, guest);
    await service.resign(room.id, guest, { requestId: randomUUID(), revision: other.revision });
  }
  const server = createApi(service, [String(info.project.use.baseURL)]);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.addInitScript(session => {
      if (location.protocol.startsWith('http')) sessionStorage.setItem('machination.online.v1', JSON.stringify(session));
    }, { url, token, id: room.id });
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Close field manual', exact: true }).click();
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await page.getByRole('button', { name: completed ? 'Factions and next operation' : 'Faction leaderboard', exact: true }).click();
    await expect(page.getByText('Faction allegiance', { exact: true })).toBeVisible();
    await expect(page.getByText('Faction leaderboard', { exact: true })).toBeVisible();
    if (!completed) {
      await expect(page.getByText('Complete your first online operation to choose a permanent faction. Wins and losses both qualify.', { exact: true })).toBeVisible();
      await expect(page.getByRole('radio', { name: 'Mnemosyne', exact: true })).toHaveCount(0);
    } else {
      await page.getByRole('radio', { name: 'Mnemosyne', exact: true }).click();
      await page.getByRole('button', { name: 'Join Mnemosyne permanently', exact: true }).click();
      await expect(page.getByText('Your permanent faction.', { exact: false })).toBeVisible();
      expect((await service.factions(token)).faction).toBe('mnemosyne');
      await page.getByRole('button', { name: 'Faction mode', exact: true }).click();
      await page.getByRole('button', { name: '2 players', exact: true }).click();
      await page.getByRole('button', { name: 'Domination', exact: true }).click();
      await page.getByRole('button', { name: 'Create next operation', exact: true }).click();
      await page.getByRole('button', { name: 'Open lobby and invitation', exact: true }).click();
      await expect(page.getByText(/Mnemosyne · Bulwark/)).toBeVisible();
    }
    await page.screenshot({ path: `.fettle/shots/faction-${completed ? 'joined' : 'locked'}-${info.project.name}.png` });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
