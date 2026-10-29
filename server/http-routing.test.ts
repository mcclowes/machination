import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { GameService } from './service';
import { createApi } from './http';
import { createLegacyGame } from '../src/game/legacy';

test('HTTP routing preserves method refusals and parses recognized POST bodies before dispatch', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'machination-http-routing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = createApi(await GameService.open(join(directory, 'games.json'), () => 1000, createLegacyGame));
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const path = `/v1/games/${'a'.repeat(24)}`;
  async function refused(suffix: string, method: string, status: number, issue: string, json = false) {
    const response = await fetch(`${base}${path}${suffix}`, { method,
      ...(json ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    });
    assert.equal(response.status, status, `${method} ${suffix}`);
    const data = await response.json();
    assert.equal(data.issues[0].issue, issue, `${method} ${suffix}`);
    assert.equal(data.issues[0].correlationId, response.headers.get('X-Correlation-ID'));
  }

  const commands = ['resign', 'activity', 'funding', 'start', 'orders', 'specialists', 'haulers', 'sites', 'gifts',
    'messages', 'groups', 'channel-messages', 'modules', 'schedules', 'edit-schedule', 'cancel-schedule',
    'intercepts', 'recovery', 'recover'];
  for (const action of commands) {
    await refused(`/${action}`, 'GET', 405, 'request.validation.method');
    await refused(`/${action}`, 'POST', 415, 'request.validation.content_type');
  }
  for (const action of ['', '/history', '/replay']) {
    await refused(action, 'PUT', 405, 'request.validation.method');
    await refused(action, 'POST', 415, 'request.validation.content_type');
    await refused(action, 'POST', 405, 'request.validation.method', true);
  }
  await refused('/unknown', 'POST', 404, 'request.not_found.route');
  await refused('/unknown', 'GET', 404, 'request.not_found.route');
  await refused('', 'GET', 404, 'game.not_found');
  for (const query of ['', '?hour=', '?hour=NaN', '?hour=0&hour=1']) {
    await refused(`/history${query}`, 'GET', 400, 'history.validation.hour');
  }
  for (const query of ['', '?from=0', '?from=0&through=NaN', '?from=0&through=1&extra=1', '?from=0&from=1&through=2']) {
    await refused(`/replay${query}`, 'GET', 400, 'replay.validation.bounds');
  }
  await refused('/history?hour=0&extra=1', 'GET', 404, 'game.not_found');
  await refused('/replay?from=0&through=1', 'GET', 404, 'game.not_found');
});
