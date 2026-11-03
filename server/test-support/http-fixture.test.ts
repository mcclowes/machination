/** @format */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { httpFixture } from './http-fixture';

test('cancellation closes every fixture listener and refuses a restart after an await', async (t) => {
  const controller = new AbortController(),
    reason = new Error('fixture cancelled');
  const fixture = httpFixture(controller.signal),
    servers: Server[] = [];
  t.after(() => fixture.close());
  const create = () => {
    const server = createServer();
    servers.push(server);
    return server;
  };
  await fixture.listen(create);
  await fixture.listen(create);
  assert.ok(servers.every((server) => server.listening));
  let resume!: () => void;
  const ready = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const restart = (async () => {
    await ready;
    return fixture.listen(create);
  })();
  controller.abort(reason);
  resume();
  await assert.rejects(restart, (error) => error === reason);
  await fixture.close();
  assert.equal(
    servers.length,
    2,
    'Cancellation must prevent the late server factory from running.',
  );
  assert.ok(servers.every((server) => !server.listening && server.address() === null));
});

test('an active fixture supports a real HTTP restart and repeated cleanup', async (t) => {
  const controller = new AbortController(),
    fixture = httpFixture(controller.signal);
  t.after(() => fixture.close());
  const first = await fixture.listen(() =>
    createServer((_request, response) => response.end('first')),
  );
  assert.equal(await (await fetch(first)).text(), 'first');
  await fixture.close();
  const second = await fixture.listen(() =>
    createServer((_request, response) => response.end('restarted')),
  );
  assert.equal(await (await fetch(second)).text(), 'restarted');
  await fixture.close();
  await fixture.close();
});

test('cancellation during bind leaves no late listener', async (t) => {
  const controller = new AbortController(),
    fixture = httpFixture(controller.signal);
  const server = createServer();
  t.after(() => fixture.close());
  const listening = fixture.listen(() => server);
  controller.abort();
  await assert.rejects(listening, { name: 'AbortError' });
  await fixture.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
});

test('cleanup waits for an aborted request handler to finish its pending work', async (t) => {
  const controller = new AbortController(),
    fixture = httpFixture(controller.signal);
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(() => {
    release();
    return fixture.close();
  });
  const url = await fixture.listen(() =>
    createServer(async (_request, response) => {
      started();
      await pending;
      response.end('finished');
    }),
  );
  const request = fetch(url).catch(() => undefined);
  await entered;
  controller.abort();
  let closed = false;
  const closing = fixture.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false, 'Storage cleanup must wait for the handler, not only the socket.');
  release();
  await closing;
  await request;
});

test('unexpected asynchronous handler failures remain test failures', async (t) => {
  const controller = new AbortController(),
    fixture = httpFixture(controller.signal);
  const failure = new Error('handler failed');
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.after(() => fixture.close());
  const url = await fixture.listen(() =>
    createServer(async () => {
      started();
      throw failure;
    }),
  );
  const request = fetch(url).catch(() => undefined);
  await entered;
  controller.abort();
  await assert.rejects(
    fixture.close(),
    (error) => error instanceof AggregateError && error.errors.includes(failure),
  );
  await request;
});
