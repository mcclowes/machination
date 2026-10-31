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

async function fixture(origin: string, reportingEnabled = true) {
  const directory = await mkdtemp(join(tmpdir(), 'machination-message-reports-browser-'));
  const host = randomBytes(32).toString('hex'),
    guest = randomBytes(32).toString('hex');
  const service = await GameService.open(
    join(directory, 'rooms.json'),
    () => 1000,
    createLegacyGame,
    { reportingEnabled },
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
  const server = createApi(service, [origin]);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    service,
    host,
    room,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

for (const width of [320, 1024])
  test(`report confirmation and lost-response recovery stay usable at ${width}px`, async ({
    page,
    baseURL,
  }, info) => {
    const f = await fixture(new URL(baseURL!).origin);
    const sent: unknown[] = [];
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(
        ({ url, id, token }) => {
          if (location.protocol === 'http:') {
            localStorage.setItem('machination.briefing.v1', '1');
            sessionStorage.setItem('machination.online.v1', JSON.stringify({ url, id, token }));
          }
        },
        { url: f.url, id: f.room.id, token: f.host },
      );
      await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
          ? route.continue()
          : route.abort(),
      );
      await page.route(`**/v1/games/${f.room.id}/message-reports`, async (route) => {
        sent.push(route.request().postDataJSON());
        if (sent.length === 1) {
          const committed = await route.fetch();
          expect(committed.status()).toBe(200);
          await route.abort('connectionreset');
        } else await route.continue();
      });
      await page.goto('/');
      await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
      await page.getByRole('tab', { name: 'Signals', exact: true }).click();
      const report = page.getByRole('button', { name: 'Report message from Vesper', exact: true });
      await expect(report).toBeEnabled();
      await report.scrollIntoViewIfNeeded();
      expect((await report.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await report.click();
      await expect(
        page.getByRole('heading', { name: 'Report message', exact: true }),
      ).toBeVisible();
      await page.getByRole('radio', { name: 'Threats', exact: true }).click();
      const details = page.getByRole('textbox', { name: 'Report details (optional)', exact: true });
      await details.fill('Please review this transmission.');
      const send = page.getByRole('button', { name: 'Send report', exact: true });
      await send.scrollIntoViewIfNeeded();
      expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: `.fettle/shots/message-reports-form-${width}-${info.project.name}.png`,
      });
      await send.click();
      await expect(
        page.getByText(
          'The server may have received this report. Retry to check the same request.',
          { exact: true },
        ),
      ).toBeVisible();
      expect((await f.service.listMessageReports()).reports).toHaveLength(1);
      await page.getByRole('button', { name: 'Close report', exact: true }).click();
      await page.getByRole('button', { name: 'Resume report', exact: true }).click();
      await expect(details).toHaveValue('Please review this transmission.');
      await expect(details).not.toBeEditable();
      const retry = page.getByRole('button', { name: 'Retry same report', exact: true });
      await retry.scrollIntoViewIfNeeded();
      await retry.click();
      await expect(
        page.getByRole('heading', { name: 'Report received', exact: true }),
      ).toBeVisible();
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual(sent[1]);
      const reports = await f.service.listMessageReports();
      expect(reports.reports).toHaveLength(1);
      const saved = await f.service.messageReport(reports.reports[0]!.id);
      expect(saved.reason).toBe('threat');
      expect(saved.detail).toBe('Please review this transmission.');
      expect(saved.evidence.text).toBe('Unwanted public transmission');
      await page.screenshot({
        path: `.fettle/shots/message-reports-received-${width}-${info.project.name}.png`,
      });
      await page.getByRole('button', { name: 'Close report', exact: true }).click();
      const received = page.getByRole('button', { name: 'Report received', exact: true });
      await received.scrollIntoViewIfNeeded();
      await received.click();
      await expect(
        page.getByRole('heading', { name: 'Report received', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send report', exact: true })).toHaveCount(0);
      expect((await f.service.listMessageReports()).reports).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

test('servers without reporting expose no active report action', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin, false);
  try {
    await page.addInitScript(
      ({ url, id, token }) => {
        localStorage.setItem('machination.briefing.v1', '1');
        sessionStorage.setItem('machination.online.v1', JSON.stringify({ url, id, token }));
      },
      { url: f.url, id: f.room.id, token: f.host },
    );
    await page.route('**/*', (route) =>
      ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue()
        : route.abort(),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await page.getByRole('tab', { name: 'Signals', exact: true }).click();
    await expect(
      page.getByText('Reporting is unavailable for this operation.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Report message from Vesper', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Check reporting availability', exact: true }).click();
    await expect(
      page.getByText('Reporting is unavailable for this operation.', { exact: true }),
    ).toBeVisible();
    expect((await f.service.listMessageReports()).reports).toHaveLength(0);
  } finally {
    await f.close();
  }
});
