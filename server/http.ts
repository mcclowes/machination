/**
 * ---
 * purpose: Bounded JSON HTTP adapter for the multiplayer service, with seat authentication and consistent failures.
 * ---
 */
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Failure, GameService, type AccountCredential } from './service';
import type { AccountAuthentication } from './auth';
import type { FundingOrder } from '../src/online/protocol';
import type { CreateGroup, ChannelTransmission, ResignOrder, EditSchedule, SpecialistOrder, HaulerOrder, SiteOrder, CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, ModuleOrder, Order, GiftOrder, ScheduleOrder, Transmission } from '../src/online/protocol';
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Failure(415, 'request.validation.content_type', 'Send JSON content.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Failure(413, 'request.validation.too_large', 'Request exceeds 8 KB.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new Failure(400, 'request.validation.json', 'Send a JSON object.'); }
}
async function gameRequest(req: IncomingMessage, url: URL, service: GameService, token: string | AccountCredential): Promise<unknown> {
  if (req.method === 'POST' && url.pathname === '/v1/games') {
    const input = await body(req);
    if (Object.keys(input).some(key => key !== 'options')) throw new Failure(400, 'game.validation.options', 'Provide game options inside options.');
    return service.create(token, input.options);
  }
  if (req.method === 'POST' && url.pathname === '/v1/join') {
    const input = await body(req);
    if (typeof input.invite !== 'string') throw new Failure(400, 'game.validation.invite', 'Provide an invitation code.');
    return service.join(input.invite, token);
  }
  const match = url.pathname.match(/^\/v1\/games\/([a-f0-9]{24})(?:\/(replay|resign|activity|history|funding|start|orders|specialists|haulers|sites|gifts|messages|groups|channel-messages|modules|schedules|edit-schedule|cancel-schedule|intercepts|recovery|recover|notifications))?$/);
  if (!match) throw new Failure(404, 'request.not_found.route', 'Endpoint not found.');
  const id = match[1]!, action = match[2];
  switch (req.method) {
    case 'GET':
      switch (action) {
        case undefined: return service.snapshot(id, token);
        case 'replay': {
          const bounds = ['from', 'through'].map(key => url.searchParams.get(key));
          if ([...url.searchParams.keys()].some(key => key !== 'from' && key !== 'through')
            || ['from', 'through'].some(key => url.searchParams.getAll(key).length !== 1)
            || bounds.some(value => !value?.trim() || !Number.isFinite(Number(value)))) {
            throw new Failure(400, 'replay.validation.bounds', 'Provide exactly one finite from and through, with no other query parameters.');
          }
          return service.sharedReplay(id, token, Number(bounds[0]), Number(bounds[1]));
        }
        case 'history': {
          const hour = url.searchParams.get('hour');
          if (!hour?.trim() || url.searchParams.getAll('hour').length !== 1 || !Number.isFinite(Number(hour))) throw new Failure(400, 'history.validation.hour', 'Provide one finite historical hour.');
          return service.history(id, token, Number(hour));
        }
        case 'notifications': {
          if ([...url.searchParams.keys()].some(key => key !== 'deviceId') || url.searchParams.getAll('deviceId').length !== 1) throw new Failure(400, 'notification.validation.device', 'Provide exactly one deviceId and no other query parameters.');
          return service.notificationSettings(id, token, url.searchParams.get('deviceId'));
        }
        default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
    case 'POST': {
      const input = await body(req);
      switch (action) {
        case 'activity': return service.activity(id, token);
        case 'resign': return service.resign(id, token, input as ResignOrder);
        case 'recovery': return service.setRecovery(id, token, input as RecoverySetup);
        case 'recover': return service.recover(id, token, input as RecoverSeat);
        case 'start': return service.start(id, token);
        case 'specialists': return service.specialist(id, token, input as SpecialistOrder);
        case 'haulers': return service.hauler(id, token, input as HaulerOrder);
        case 'sites': return service.site(id, token, input as SiteOrder);
        case 'orders': return service.order(id, token, input as Order);
        case 'gifts': return service.gift(id, token, input as GiftOrder);
        case 'intercepts': return service.intercept(id, token, input as InterceptOrder);
        case 'schedules': return service.schedule(id, token, input as ScheduleOrder);
        case 'edit-schedule': return service.editSchedule(id, token, input as EditSchedule);
        case 'cancel-schedule': return service.cancelSchedule(id, token, input as CancelSchedule);
        case 'modules': return service.install(id, token, input as ModuleOrder);
        case 'funding': return service.funding(id, token, input as FundingOrder);
        case 'groups': return service.createGroup(id, token, input as CreateGroup);
        case 'channel-messages': return service.channelMessage(id, token, input as ChannelTransmission);
        case 'messages': return service.message(id, token, input as Transmission);
        case 'notifications': return service.setNotifications(id, token, input);
        default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
    }
    default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
  }
}
export function createApi(service: GameService, origins: string[] = ['http://localhost:8081', 'http://localhost:8082'], authenticate?: AccountAuthentication) {
  const limits = new Map<string, { count: number; resets: number }>();
  return createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    const correlationId = randomUUID();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('Vary', 'Origin');
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!origins.includes(origin)) throw new Failure(403, 'request.forbidden.origin', 'This browser origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const now = Date.now();
      for (const [key, item] of limits) if (item.resets <= now) limits.delete(key);
      const ip = req.socket.remoteAddress ?? 'unknown';
      let limit = limits.get(ip);
      if (!limit) {
        if (limits.size >= 10000) throw new Failure(503, 'request.capacity.reached', 'Server is busy. Try again shortly.');
        limit = { count: 0, resets: now + 60000 }; limits.set(ip, limit);
      }
      if (++limit.count > 120) { res.setHeader('Retry-After', '60'); throw new Failure(429, 'request.rate_limit.exceeded', 'Too many requests. Try again in a minute.'); }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') { res.end(JSON.stringify({ status: 'ok' })); return; }
      const bearer = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
      const legacy = /^[a-f0-9]{64}$/.test(bearer);
      const account = authenticate && !legacy ? await authenticate(bearer, origin) : undefined;
      const token = account ?? (legacy ? bearer : '');
      if (path === '/v1/account/session' || path === '/v1/account/link') {
        if (!authenticate) throw new Failure(503, 'account.unavailable.configuration', 'Account login is not configured on this server.');
        if (!account) throw new Failure(401, 'account.unauthorized.session', 'Sign in to your Marginal Utility account.');
        if (path === '/v1/account/session' && req.method === 'GET') {
          res.end(JSON.stringify({ snapshot: await service.accountSession(account) })); return;
        }
        if (path === '/v1/account/link' && req.method === 'POST') {
          const input = await body(req);
          if (typeof input.id !== 'string' || !/^[a-f0-9]{24}$/.test(input.id) || typeof input.token !== 'string' || Object.keys(input).some(key => !['id', 'token'].includes(key))) throw new Failure(400, 'account.validation.seat', 'Provide the existing operation and seat credential.');
          res.end(JSON.stringify(await service.linkAccount(input.id, input.token, account))); return;
        }
        throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
      if (authenticate && !account && req.method === 'POST' && (path === '/v1/games' || path === '/v1/join')) throw new Failure(401, 'account.unauthorized.session', 'Sign in to create or join an operation.');
      res.end(JSON.stringify(await gameRequest(req, url, service, token)));
    } catch (error) {
      const e = error instanceof Failure ? error : new Failure(500, 'server.internal.unavailable', 'The server could not complete this request. Retry with the same command ID.');
      if (!(error instanceof Failure)) console.error('Request failed', correlationId, (error as NodeJS.ErrnoException).code ?? 'internal');
      res.writeHead(e.status);
      res.end(JSON.stringify({ issues: [{ issue: e.code, severity: 'error', correlationId, dateTime: new Date().toISOString(), message: { title: 'Command not completed', detail: e.message } }] }));
    }
  });
}
