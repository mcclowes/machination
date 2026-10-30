import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { GameService } from '../server/service';
import { createApi } from '../server/http';
import { councilBallots } from '../src/game/compact';

test('daily council votes, public nominations, and convention lore work beside chat', async ({ page }, info) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), 'machination-compact-ui-'));
  let now = Date.parse('2026-10-30T12:00:00Z');
  const service = await GameService.open(join(dir, 'world.json'), () => now);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('hex'));
  const room = await service.create(tokens[0]!, { playerCount: 3, mode: 'mining', beltCompact: true });
  for (const token of tokens.slice(1)) await service.join(room.invite, token);
  await service.start(room.id, tokens[0]!);
  const server = createApi(service, ['http://127.0.0.1:3094']);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server address.');
  try {
    page.on('pageerror', error => { throw error; });
    const session = { url: `http://127.0.0.1:${address.port}`, id: room.id, token: tokens[0]! };
    await page.addInitScript(saved => {
      localStorage.setItem('machination.briefing.v1', '1');
      sessionStorage.setItem('machination.online.v1', JSON.stringify(saved));
    }, session);
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await page.getByRole('tab', { name: 'Signals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The Belt compact', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Motion 1: Authorize high-thrust transit', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Vote yes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Vote yes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => councilBallots((await service.snapshot(room.id, tokens[1]!)).game.compact!.motion!).you).toBe('yes');
    await page.getByRole('button', { name: 'Vote no', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Vote no', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Nominate a later motion', exact: true }).click();
    await page.getByRole('button', { name: 'Nominate: Strategic weapons prohibition', exact: true }).click();
    await expect.poll(async () => (await service.snapshot(room.id, tokens[1]!)).game.compact!.proposals.you).toBe('weapons');
    await page.getByRole('button', { name: 'Hide nominations', exact: true }).click();
    await page.getByRole('button', { name: 'Read the six conventions', exact: true }).click();
    await expect(page.getByText(/The Vesta incident left a permanent exclusion zone/)).toBeVisible();
    await page.getByRole('button', { name: 'Close conventions', exact: true }).click();
    await page.getByRole('button', { name: 'Vote yes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Vote yes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await service.council(room.id, tokens[1]!, { requestId: randomUUID(), motionId: 1, action: 'vote', choice: 'yes' });
    now += 24 * 3_600_000;
    expect((await service.snapshot(room.id, tokens[0]!)).game.compact!.history[0]!.result).toBe('passed');
    await page.reload();
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await page.getByRole('tab', { name: 'Signals', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Waived: Transit safety limits', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Motion 2: Release strategic weapons interlocks', exact: true })).toBeVisible();
    await mkdir('.fettle/shots', { recursive: true });
    await page.screenshot({ path: `.fettle/shots/belt-compact-${info.project.name}.png` });
    await page.getByRole('heading', { name: 'Waived: Transit safety limits', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.fettle/shots/belt-compact-${info.project.name}-waiver.png` });
    await page.getByRole('button', { name: 'Council record · 1 decisions', exact: true }).click();
    await expect(page.getByText('Motion 1 · passed: Authorize high-thrust transit', { exact: true })).toBeVisible();
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
