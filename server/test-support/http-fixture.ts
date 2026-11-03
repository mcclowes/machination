/**
 * Own test listeners and drain their asynchronous handlers before storage cleanup.
 *
 * @format
 */

import { once } from 'node:events';
import type { Server } from 'node:http';

export function httpFixture(signal: AbortSignal) {
  const servers = new Set<Server>();
  const closing = new WeakMap<Server, Promise<void>>();
  const tracked = new WeakSet<Server>();
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  function closeServer(server: Server): Promise<void> {
    const pending = closing.get(server);
    if (pending) return pending;
    const done = new Promise<void>((resolve) => server.close(() => resolve()));
    closing.set(server, done);
    void done.then(() => closing.delete(server));
    server.closeAllConnections();
    return done;
  }
  const close = async () => {
    await Promise.all([...servers].map(closeServer));
    while (pending.size) await Promise.all([...pending]);
    if (failures.length)
      throw new AggregateError(failures.splice(0), 'Test HTTP request handlers failed.');
  };
  signal.addEventListener(
    'abort',
    () => {
      for (const server of servers) void closeServer(server);
    },
    { once: true },
  );
  return {
    close,
    async listen(create: () => Server): Promise<string> {
      signal.throwIfAborted();
      const server = create();
      if (!tracked.has(server)) {
        tracked.add(server);
        const handlers = server.rawListeners('request');
        server.removeAllListeners('request');
        for (const handler of handlers)
          server.on('request', (request, response) => {
            const result = handler.call(server, request, response);
            const work = Promise.resolve(result).then(
              () => {
                pending.delete(work);
              },
              (error) => {
                pending.delete(work);
                failures.push(error);
              },
            );
            pending.add(work);
          });
      }
      servers.add(server);
      server.once('close', () => servers.delete(server));
      try {
        server.listen({ port: 0, host: '127.0.0.1', signal });
        await once(server, 'listening', { signal });
        signal.throwIfAborted();
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Test HTTP server did not bind a loopback port.');
        return `http://127.0.0.1:${address.port}`;
      } catch (error) {
        await closeServer(server);
        throw error;
      }
    },
  };
}
