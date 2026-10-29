/**
 * ---
 * purpose: Start the authoritative service and drain active requests on host shutdown.
 * ---
 */
import { resolve } from 'node:path';
import { GameService } from './service';
import { createApi } from './http';
import { clerkAuthentication } from './auth';
import { expoPushProvider, pushConfiguration } from './expo-push';
import { NotificationWorker } from './push-worker';
const SHUTDOWN_GRACE_MS = 15_000;
async function main() {
  const host = process.env.MACHINATION_HOST?.trim() || '127.0.0.1';
  const portValue = process.env.PORT ?? '8787';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  const push = pushConfiguration(process.env);
  const service = await GameService.open(resolve(process.env.MACHINATION_DATA ?? '.data/games.json'), Date.now, undefined, { notifications: push.enabled });
  const worker = push.enabled ? new NotificationWorker(service.notificationQueue(), expoPushProvider({ accessToken: push.accessToken })) : undefined;
  const origins = process.env.MACHINATION_ORIGINS?.split(',').map((s: string) => s.trim()).filter(Boolean) ?? ['http://localhost:8081', 'http://localhost:8082'];
  const server = createApi(service, origins, clerkAuthentication({ CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY, CLERK_JWT_KEY: process.env.CLERK_JWT_KEY, CLERK_ISSUER: process.env.CLERK_ISSUER }, origins));
  server.once('error', error => { console.error('Game service listener failed:', error.message); process.exitCode = 1; });
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    console.log('Machination service draining active requests.');
    const deadline = setTimeout(() => {
      console.error('Game service shutdown exceeded its grace period.');
      process.exitCode = 1; server.closeAllConnections();
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();
    // The worker stops claiming at once and finishes or releases its batch inside the same grace period.
    void worker?.stop(SHUTDOWN_GRACE_MS - 2_000).catch(error => console.error('Notification worker shutdown failed:', (error as Error).name));
    server.close(error => {
      clearTimeout(deadline);
      if (error) { console.error('Game service shutdown failed:', error.message); process.exitCode = 1; }
    });
  }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`Machination service listening on ${host}:${typeof address === 'object' && address ? address.port : port}`);
    console.log(`Message notifications ${push.enabled ? 'enabled' : 'disabled'}.`);
    worker?.start();
  });
}
main().catch(e => { console.error('Cannot start game service:', e.message); process.exitCode = 1; });
