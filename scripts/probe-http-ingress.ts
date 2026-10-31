/**
 * Verify a deployed HTTP edge without credentials or game mutations.
 * @format
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Agent, get } from 'node:https';
import { isIP, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type ProbeResponse = { status: number; headers: Record<string, string>; body: unknown };
export type ProbeRequest = (
  family: 4 | 6,
  path: string,
  headers?: Record<string, string>,
) => Promise<ProbeResponse>;

function health(response: ProbeResponse) {
  if (
    response.status !== 200 ||
    !response.body ||
    typeof response.body !== 'object' ||
    !('status' in response.body) ||
    response.body.status !== 'ok'
  )
    throw new Error('Health acceptance failed.');
}

function failure(response: ProbeResponse, status: number, code: string) {
  const body = response.body;
  const issue =
    body && typeof body === 'object' && 'issues' in body && Array.isArray(body.issues)
      ? body.issues[0]
      : undefined;
  if (
    response.status !== status ||
    !issue ||
    issue.issue !== code ||
    issue.severity !== 'error' ||
    !issue.correlationId ||
    issue.correlationId !== response.headers['x-correlation-id']
  )
    throw new Error(`Expected Machination ${status} ${code}; ingress acceptance failed.`);
  if (status === 429 && !/^(?:[1-9]|[1-5][0-9]|60)$/.test(response.headers['retry-after'] ?? ''))
    throw new Error('Rate-limit response has no valid Retry-After.');
}

export async function probeIngress(
  request: ProbeRequest,
  {
    clock = () => performance.now(),
    dualStack = false,
  }: { clock?: () => number; dualStack?: boolean } = {},
) {
  const families: (4 | 6)[] = dualStack ? [4, 6] : [4];
  for (const family of families) health(await request(family, '/health'));
  const started = clock();
  const path = `/v1/ingress-probe-${randomUUID()}`;
  async function bounded(family: 4 | 6, route: string, headers?: Record<string, string>) {
    function deadline() {
      const elapsed = clock() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 45_000)
        throw new Error('Probe exceeded 45 seconds; no window-boundary claim is valid.');
    }
    deadline();
    const response = await request(family, route, headers);
    deadline();
    return response;
  }
  for (let index = 0; index < 120; index++) {
    failure(await bounded(4, path), 404, 'request.not_found.route');
  }
  failure(await bounded(4, path), 429, 'request.rate_limit.exceeded');
  const spoofs: Record<string, string>[] = [
    { 'X-Real-IP': '192.0.2.99' },
    { 'X-Real-IP': '2001:db8::99' },
    {
      'X-Real-IP': '198.51.100.99',
      'X-Forwarded-For': '203.0.113.99',
      Forwarded: 'for=203.0.113.99',
      'X-Railway-Edge': 'caller-controlled',
    },
    { 'X-Real-IP': '192.0.2.98, 192.0.2.99', 'CF-Connecting-IP': '198.51.100.99' },
  ];
  for (const headers of spoofs)
    failure(await bounded(4, path, headers), 429, 'request.rate_limit.exceeded');
  if (dualStack) failure(await bounded(6, path), 404, 'request.not_found.route');
  failure(await bounded(4, path), 429, 'request.rate_limit.exceeded');
  for (const family of families) health(await bounded(family, '/health'));
  return {
    checksPassed: true,
    probePath: path,
    allowedBeforeLimit: 120,
    spoofRefusals: spoofs.length,
    elapsedMs: Math.round(clock() - started),
    independentBudget: dualStack ? 'IPv6 route available while IPv4 throttled' : 'unverified',
    scope:
      'Observed supplied header variants and health on this HTTPS route. Does not certify topology, private callers, capacity, or release readiness.',
  };
}

export function requireNativeFamily(
  family: 4 | 6,
  socket: Pick<Socket, 'remoteFamily' | 'localFamily' | 'remoteAddress' | 'localAddress'>,
) {
  const native = [socket.remoteAddress, socket.localAddress].every((address) => {
    if (!address || isIP(address) !== family) return false;
    if (family === 4) return true;
    try {
      return !new URL(`http://[${address}]`).hostname.startsWith('[::ffff:');
    } catch {
      return false;
    }
  });
  if (!native || socket.remoteFamily !== `IPv${family}` || socket.localFamily !== `IPv${family}`)
    throw new Error(
      `Probe requires native IPv${family} sockets; mapped or missing addresses cannot prove an independent client.`,
    );
}

function transport(origin: string) {
  const agent = new Agent({ keepAlive: true, maxSockets: 2 });
  const request: ProbeRequest = (family, path, headers = {}) =>
    new Promise((resolve, reject) => {
      const outgoing = get(
        origin + path,
        { family, headers, agent, rejectUnauthorized: true, signal: AbortSignal.timeout(4_000) },
        (response) => {
          try {
            requireNativeFamily(family, response.socket);
          } catch (error) {
            reject(error);
            outgoing.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 8192) outgoing.destroy(new Error('Probe response exceeds 8 KB.'));
            else chunks.push(chunk);
          });
          response.on('error', () =>
            reject(new Error('HTTPS response failed; raw diagnostics withheld.')),
          );
          response.on('end', () => {
            try {
              const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const headers = Object.fromEntries(
                Object.entries(response.headers).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              );
              resolve({ status: response.statusCode ?? 0, headers, body });
            } catch {
              reject(new Error('HTTPS response was not bounded JSON.'));
            }
          });
        },
      );
      outgoing.on('error', () =>
        reject(new Error('HTTPS probe failed; raw diagnostics withheld.')),
      );
    });
  return { request, close: () => agent.destroy() };
}

async function main(args: string[]) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Plan: node --import tsx scripts/probe-http-ingress.ts [--origin=https://host]\nConnectivity only: add --preflight.\nHeader/health exercise: add --execute (at most 128 credential-free GETs). May throttle ALL players for up to 60 seconds when ingress shares a proxy budget. Use staging or an agreed quiet window. Independent budgets remain unverified.\nOptional: add --dual-stack for an independent native IPv6 check (at most 131 GETs). See docs/railway-ingress.md.',
    );
    return;
  }
  if (
    args.some(
      (arg) =>
        !['--execute', '--preflight', '--dual-stack'].includes(arg) && !arg.startsWith('--origin='),
    ) ||
    args.filter((arg) => arg === '--execute').length > 1 ||
    args.filter((arg) => arg === '--preflight').length > 1 ||
    args.filter((arg) => arg === '--dual-stack').length > 1 ||
    args.filter((arg) => arg.startsWith('--origin=')).length > 1
  )
    throw new Error('Unknown or duplicate option. Use --help.');
  if (args.includes('--execute') && args.includes('--preflight'))
    throw new Error('Choose one execution mode: --preflight or --execute.');
  const dualStack = args.includes('--dual-stack');
  let url: URL;
  try {
    url = new URL(
      args.find((arg) => arg.startsWith('--origin='))?.slice('--origin='.length) ??
        'https://machination-api-production.up.railway.app',
    );
  } catch {
    throw new Error('Provide an HTTPS origin without credentials, path, query, or fragment.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Provide an HTTPS origin without credentials, path, query, or fragment.');
  if (!args.includes('--execute') && !args.includes('--preflight')) {
    console.log(
      JSON.stringify(
        {
          origin: url.origin,
          execution: 'not requested',
          maxRequests: dualStack ? 131 : 128,
          requires: [
            dualStack
              ? 'native IPv4 and IPv6 connectivity'
              : 'IPv4 connectivity; independent budgets remain unverified',
            'fresh IPv4 client budget',
            'approved target and deployment',
            'trusted ingress configuration',
          ],
          effect:
            'May throttle ALL players for up to 60 seconds if ingress shares a proxy budget. Use staging or an agreed quiet window. No credentials or game writes.',
        },
        null,
        2,
      ),
    );
    return;
  }
  const connection = transport(url.origin);
  try {
    if (args.includes('--preflight')) {
      health(await connection.request(4, '/health'));
      if (dualStack) health(await connection.request(6, '/health'));
      console.log(
        JSON.stringify(
          {
            origin: url.origin,
            observedAt: new Date().toISOString(),
            connectivity: dualStack ? 'Native IPv4 and IPv6 health passed' : 'IPv4 health passed',
            scope: 'Health GETs only. No rate-limit or header-trust acceptance.',
          },
          null,
          2,
        ),
      );
    } else
      console.log(
        JSON.stringify(
          {
            origin: url.origin,
            observedAt: new Date().toISOString(),
            ...(await probeIngress(connection.request, { dualStack })),
          },
          null,
          2,
        ),
      );
  } finally {
    connection.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ingress probe failed.');
    process.exitCode = 1;
  });
}
