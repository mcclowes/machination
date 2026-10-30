/**
 * Own two disposable databases and a short-lived CA; never configure a deployed service.
 * @format
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const image =
  'postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b';
const directory = await mkdtemp(join(tmpdir(), 'machination-postgres-tls-'));
const containers = [];
const command = async (name, args) =>
  (await exec(name, args, { timeout: 60_000, maxBuffer: 1_000_000 })).stdout.trim();
const docker = (...args) => command('docker', args);
async function databaseUrl(name) {
  const binding = await docker('port', name, '5432/tcp');
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  return `postgres://machination:fixture-only@${binding}/machination`;
}
async function ready(url, ssl) {
  const deadline = Date.now() + 40_000;
  let last;
  while (Date.now() < deadline) {
    const sql = postgres(url, { ssl, max: 1, connect_timeout: 1, prepare: false });
    try {
      await sql`select 1`;
      return;
    } catch (error) {
      last = error;
    } finally {
      await sql.end({ timeout: 1 });
    }
    await delay(200);
  }
  throw new Error(`Disposable database did not become ready (${last?.code ?? 'unknown'}).`);
}
async function database() {
  const name = `machination-tls-${randomUUID()}`;
  await docker(
    'create',
    '--name',
    name,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_USER=machination',
    '--env',
    'POSTGRES_PASSWORD=fixture-only',
    image,
  );
  containers.push(name);
  await docker('start', name);
  const url = await databaseUrl(name);
  await ready(url, false);
  return { name, url };
}
async function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    },
    process.argv.includes('--full') ? 2_040_000 : 120_000,
  );
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `Database validation failed (${timedOut ? 'deadline' : (signal ?? code)}).`,
              ),
            ),
      );
    });
  } finally {
    clearTimeout(timer);
  }
}
try {
  console.log('Creating disposable plaintext and TLS Postgres 17 databases.');
  await command('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(directory, 'ca.key'),
    '-out',
    join(directory, 'ca.crt'),
    '-days',
    '2',
    '-subj',
    '/CN=Machination disposable test CA',
  ]);
  await command('openssl', [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(directory, 'server.key'),
    '-out',
    join(directory, 'server.csr'),
    '-subj',
    '/CN=localhost',
  ]);
  await writeFile(
    join(directory, 'extensions'),
    'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n',
  );
  await command('openssl', [
    'x509',
    '-req',
    '-in',
    join(directory, 'server.csr'),
    '-CA',
    join(directory, 'ca.crt'),
    '-CAkey',
    join(directory, 'ca.key'),
    '-CAcreateserial',
    '-out',
    join(directory, 'server.crt'),
    '-days',
    '2',
    '-extfile',
    join(directory, 'extensions'),
  ]);
  await writeFile(
    join(directory, 'pg_hba.conf'),
    'local all all trust\nhostnossl all all 0.0.0.0/0 reject\nhostnossl all all ::/0 reject\nhostssl all all 0.0.0.0/0 scram-sha-256\nhostssl all all ::/0 scram-sha-256\n',
  );
  const plaintext = await database();
  const encrypted = await database();
  for (const file of ['server.crt', 'server.key', 'pg_hba.conf'])
    await docker('cp', join(directory, file), `${encrypted.name}:/tmp/${file}`);
  await docker(
    'exec',
    '--user',
    '0',
    encrypted.name,
    'chown',
    'postgres:postgres',
    '/tmp/server.crt',
    '/tmp/server.key',
    '/tmp/pg_hba.conf',
  );
  await docker('exec', '--user', '0', encrypted.name, 'chmod', '600', '/tmp/server.key');
  await docker(
    'exec',
    '--user',
    'postgres',
    encrypted.name,
    'psql',
    '-U',
    'machination',
    '-d',
    'machination',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    "alter system set ssl_cert_file = '/tmp/server.crt'",
    '-c',
    "alter system set ssl_key_file = '/tmp/server.key'",
    '-c',
    "alter system set hba_file = '/tmp/pg_hba.conf'",
    '-c',
    'alter system set ssl = on',
  );
  await docker('restart', encrypted.name);
  const endpoint = new URL(await databaseUrl(encrypted.name));
  endpoint.hostname = 'localhost';
  const ca = await readFile(join(directory, 'ca.crt'), 'utf8');
  await ready(endpoint.toString(), { ca, rejectUnauthorized: true });
  console.log('Postgres fixtures ready; checking certificate policy and the packaged service.');
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    NODE_OPTIONS: '',
    MACHINATION_TEST_DATABASE_URL: plaintext.url,
    MACHINATION_TEST_DATABASE_TLS_URL: endpoint.toString(),
    MACHINATION_TEST_DATABASE_CA: ca,
  };
  if (process.argv.includes('--full')) {
    await run('npm', ['run', 'check'], env);
  } else {
    await run(process.execPath, ['scripts/build-server.mjs'], env);
    await run(
      process.execPath,
      [
        '--import',
        'tsx',
        '--test',
        'server/postgres-client.test.ts',
        'server/postgres-tls.test.ts',
      ],
      env,
    );
    await run(
      process.execPath,
      ['--test', '--test-name-pattern=Postgres.*TLS', 'scripts/build-server.test.mjs'],
      env,
    );
  }
} finally {
  for (const name of containers)
    await docker('rm', '--force', '--volumes', name).catch((error) => {
      console.error('Disposable database cleanup failed:', error.message);
      process.exitCode = 1;
    });
  await rm(directory, { recursive: true, force: true });
}
