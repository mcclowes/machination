/**
 * ---
 * purpose: Start the authoritative service and drain active requests on host shutdown.
 * ---
 *
 * @format
 */
import { validatePulseConfig, DEFAULT_PULSE_CONFIG } from '../src/game/pulse';
import { resolve } from 'node:path';
import { GameService } from './service';
import { openPostgres } from './postgres-client';
import { createApi } from './http';
import { clientIpMode } from './client-address';
import { databaseRecoveryMode } from './database-recovery';
import { clerkAuthentication } from './auth';
import { operatorAuthentication } from './operator-auth';
import { expoPushProvider, pushConfiguration } from './expo-push';
import { NotificationWorker } from './push-worker';
const SHUTDOWN_GRACE_MS = 15_000;
async function main() {
  const host = process.env.MACHINATION_HOST?.trim() || '127.0.0.1';
  const portValue = process.env.PORT ?? '8787';
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('PORT must be an integer from 0 to 65535.');
  const push = pushConfiguration(process.env);
  const clientIp = clientIpMode(process.env.MACHINATION_CLIENT_IP);
  const recovery = databaseRecoveryMode(process.env.MACHINATION_DATABASE_RECOVERY);
  const dataFile = resolve(process.env.MACHINATION_DATA ?? '.data/games.json');
  const storageMode = process.env.MACHINATION_STORAGE;
  if (storageMode !== undefined && storageMode !== 'file' && storageMode !== 'postgres')
    throw new Error('MACHINATION_STORAGE must be file or postgres.');
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (storageMode === 'postgres' && !databaseUrl)
    throw new Error('DATABASE_URL is required when MACHINATION_STORAGE=postgres.');
  if (storageMode === 'file' && databaseUrl)
    throw new Error('DATABASE_URL must be unset when MACHINATION_STORAGE=file.');
  const origins = process.env.MACHINATION_ORIGINS?.split(',')
    .map((s: string) => s.trim())
    .filter(Boolean) ?? ['http://localhost:8081', 'http://localhost:8082'];
  const authenticate = clerkAuthentication(
    {
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
      CLERK_JWT_KEY: process.env.CLERK_JWT_KEY,
      CLERK_ISSUER: process.env.CLERK_ISSUER,
    },
    origins,
  );
  const operatorAuthenticate = operatorAuthentication(process.env, origins);
  const reportingFlag = process.env.MACHINATION_REPORTING_ENABLED;
  if (reportingFlag !== undefined && reportingFlag !== '0' && reportingFlag !== '1')
    throw new Error('MACHINATION_REPORTING_ENABLED must be 0 or 1.');
  if (reportingFlag === '1' && !operatorAuthenticate)
    throw new Error('Message reporting requires separately configured operator authentication.');
  const storage = databaseUrl
    ? await openPostgres(
        databaseUrl,
        dataFile,
        {
          tls: process.env.MACHINATION_DATABASE_TLS,
          ca: process.env.MACHINATION_DATABASE_CA,
        },
        recovery,
      )
    : undefined;
  try {
    const service = await GameService.open(storage ?? dataFile, Date.now, undefined, {
      databaseRecovery: recovery,
      notifications: push.enabled,
      reportingEnabled: reportingFlag === '1',
      ...(process.env.MACHINATION_PULSE_CONFIG
        ? {
            pulse: validatePulseConfig({
              ...DEFAULT_PULSE_CONFIG,
              ...JSON.parse(process.env.MACHINATION_PULSE_CONFIG),
            }),
          }
        : {}),
    });
    const worker = push.enabled
      ? new NotificationWorker(
          service.notificationQueue(),
          expoPushProvider({ accessToken: push.accessToken }),
        )
      : undefined;
    const server = createApi(service, origins, authenticate, { clientIp, operatorAuthenticate });
    let closing = false;
    function shutdownFailed(error: unknown) {
      console.error(
        'Game service shutdown failed:',
        error instanceof Error ? error.name : 'unknown',
      );
      process.exitCode = 1;
    }
    function shutdown() {
      if (closing) return;
      closing = true;
      console.log('Machination service draining active requests.');
      const expires = performance.now() + SHUTDOWN_GRACE_MS;
      const deadline = setTimeout(() => {
        console.error('Game service shutdown exceeded its grace period.');
        process.exitCode = 1;
        server.closeAllConnections();
        // The driver can leave a half-closed socket waiting on a blocked database peer.
        process.exit(1);
      }, SHUTDOWN_GRACE_MS);
      deadline.unref();
      const http = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      const notifications = worker?.stop(SHUTDOWN_GRACE_MS - 2_000) ?? Promise.resolve();
      void Promise.allSettled([http, notifications])
        .then(async (outcomes) => {
          for (const outcome of outcomes)
            if (outcome.status === 'rejected') shutdownFailed(outcome.reason);
          await storage?.close(Math.max(0, expires - performance.now()));
        })
        .catch(shutdownFailed)
        .finally(() => clearTimeout(deadline));
    }
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => {
      console.error('Game service listener failed:', error.message);
      process.exitCode = 1;
      shutdown();
    });
    const address = server.address();
    console.log(
      `Machination service listening on ${host}:${typeof address === 'object' && address ? address.port : port}`,
    );
    console.log(`Game state stored in ${databaseUrl ? 'Postgres' : 'a JSON file'}.`);
    console.log(`Message notifications ${push.enabled ? 'enabled' : 'disabled'}.`);
    worker?.start();
  } catch (error) {
    await storage
      ?.close()
      .catch((cleanup) =>
        console.error(
          'Game state cleanup failed:',
          cleanup instanceof Error ? cleanup.name : 'unknown',
        ),
      );
    throw error;
  }
}
main().catch((e) => {
  console.error('Cannot start game service:', e.message);
  process.exit(1);
});
