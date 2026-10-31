/**
 * ---
 * purpose: Bounded JSON HTTP adapter for the multiplayer service, with seat authentication and consistent failures.
 * ---
 */
import type { PulseOrder } from '../src/contracts/protocol';
import type { ClientMechanicsVersion } from '../src/contracts/representation';
import { clientRepresentation, responseJson } from './client-representation';
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { GameService, type AccountCredential } from './service';
import { Failure } from './failure';
import { clientAddress, type ClientIpMode } from './client-address';
import type { NotificationVersion } from './notification-preferences';
import type { AccountAuthentication } from './auth';
import type { FundingOrder } from '../src/contracts/protocol';
import type { CreateGroup, ChannelTransmission, ResignOrder, SpecialistOrder, HaulerOrder, SiteOrder, CancelSchedule, RecoverSeat, RecoverySetup, InterceptOrder, ModuleOrder, Order, GiftOrder, Transmission } from '../src/contracts/protocol';
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
async function gameRequest(req: IncomingMessage, url: URL, service: GameService, token: string | AccountCredential, mechanicsVersion: ClientMechanicsVersion): Promise<unknown> {
  if (url.pathname === '/v1/factions') {
    if (req.method === 'GET') return service.factions(token);
    if (req.method === 'POST') {
      const input = await body(req);
      if (Object.keys(input).length !== 1 || !('faction' in input)) throw new Failure(400, 'faction.validation.identity', 'Provide one faction choice.');
      return service.chooseFaction(token, input.faction);
    }
    throw new Failure(405, 'request.validation.method', 'Method not allowed.');
  }
  if (req.method === 'POST' && url.pathname === '/v1/games') {
    const input = await body(req);
    if (Object.keys(input).some(key => !['options', 'variant', 'preferredColor', 'requestId'].includes(key))) throw new Failure(400, 'game.validation.options', 'Provide game options inside options.');
    return service.create(token, input.options, input.variant, input.preferredColor, input.requestId, mechanicsVersion);
  }
  if (req.method === 'POST' && url.pathname === '/v1/join') {
    const input = await body(req);
    if (typeof input.invite !== 'string') throw new Failure(400, 'game.validation.invite', 'Provide an invitation code.');
    return service.join(input.invite, token, input.preferredColor, mechanicsVersion);
  }
  const match = url.pathname.match(/^\/v1\/games\/([a-f0-9]{24})(?:\/(council|pulse|replay|resign|activity|history|funding|start|orders|specialists|haulers|sites|gifts|messages|groups|channel-messages|modules|schedules|edit-schedule|cancel-schedule|intercepts|recovery|recover|notifications))?$/);
  if (!match) throw new Failure(404, 'request.not_found.route', 'Endpoint not found.');
  const id = match[1]!, action = match[2];
  switch (req.method) {
    case 'GET':
      switch (action) {
        case undefined:
          await service.requireClientRules(id, token, mechanicsVersion);
          return service.snapshot(id, token);
        case 'replay': {
          const bounds = ['from', 'through'].map(key => url.searchParams.get(key));
          if ([...url.searchParams.keys()].some(key => key !== 'from' && key !== 'through')
            || ['from', 'through'].some(key => url.searchParams.getAll(key).length !== 1)
            || bounds.some(value => !value?.trim() || !Number.isFinite(Number(value)))) {
            throw new Failure(400, 'replay.validation.bounds', 'Provide exactly one finite from and through, with no other query parameters.');
          }
          await service.requireClientRules(id, token, mechanicsVersion);
          return service.sharedReplay(id, token, Number(bounds[0]), Number(bounds[1]));
        }
        case 'history': {
          const hour = url.searchParams.get('hour');
          if (!hour?.trim() || url.searchParams.getAll('hour').length !== 1 || !Number.isFinite(Number(hour))) throw new Failure(400, 'history.validation.hour', 'Provide one finite historical hour.');
          await service.requireClientRules(id, token, mechanicsVersion);
          return service.history(id, token, Number(hour));
        }
        case 'notifications': {
          if ([...url.searchParams.keys()].some(key => key !== 'deviceId' && key !== 'version') || url.searchParams.getAll('deviceId').length !== 1) throw new Failure(400, 'notification.validation.device', 'Provide exactly one deviceId and no other query parameters.');
          return service.notificationSettings(id, token, url.searchParams.get('deviceId'), notificationVersion(url));
        }
        default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
    case 'POST': {
      const input = await body(req);
      if (action !== undefined && !['history', 'replay', 'notifications', 'recover'].includes(action))
        await service.requireClientRules(id, token, mechanicsVersion);
      switch (action) {
        case 'activity': return service.activity(id, token);
        case 'resign': return service.resign(id, token, input as ResignOrder);
        case 'recovery': return service.setRecovery(id, token, input as RecoverySetup);
        case 'recover': return service.recover(id, token, input as RecoverSeat, mechanicsVersion);
        case 'start': return service.start(id, token);
        case 'specialists': return service.specialist(id, token, input as SpecialistOrder);
        case 'haulers': return service.hauler(id, token, input as HaulerOrder);
        case 'council': return service.council(id, token, input);
        case 'pulse': return service.pulse(id, token, input as PulseOrder);
        case 'sites': return service.site(id, token, input as SiteOrder);
        case 'orders': return service.order(id, token, input as Order);
        case 'gifts': return service.gift(id, token, input as GiftOrder);
        case 'intercepts': return service.intercept(id, token, input as InterceptOrder);
        case 'schedules': return service.schedule(id, token, input);
        case 'edit-schedule': return service.editSchedule(id, token, input);
        case 'cancel-schedule': return service.cancelSchedule(id, token, input as CancelSchedule);
        case 'modules': return service.install(id, token, input as ModuleOrder);
        case 'funding': return service.funding(id, token, input as FundingOrder);
        case 'groups': return service.createGroup(id, token, input as CreateGroup);
        case 'channel-messages': return service.channelMessage(id, token, input as ChannelTransmission);
        case 'messages': return service.message(id, token, input as Transmission);
        case 'notifications': {
          if ([...url.searchParams.keys()].some(key => key !== 'version')) throw new Failure(400, 'notification.validation.version', 'Only version=2 may be negotiated.');
          return service.setNotifications(id, token, input, notificationVersion(url));
        }
        default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
    }
    default: throw new Failure(405, 'request.validation.method', 'Method not allowed.');
  }
}
/** The default stays version 1 because existing clients reject unknown preference fields. */
function notificationVersion(url: URL): NotificationVersion {
  const values = url.searchParams.getAll('version');
  if (!values.length) return 1;
  if (values.length !== 1 || values[0] !== '2') throw new Failure(400, 'notification.validation.version', 'Only version=2 may be negotiated.');
  return 2;
}
export function createApi(service: GameService, origins: string[] = ['http://localhost:8081', 'http://localhost:8082'], authenticate?: AccountAuthentication, options: { clientIp?: ClientIpMode; clock?: () => number } = {}) {
  const limits = new Map<string, { count: number; resets: number }>();
  return createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    const correlationId = randomUUID();
    const representation = clientRepresentation(req.headers.accept);
    const encode = (payload: unknown) => responseJson(payload, representation);
    res.setHeader('Content-Type', representation.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('Vary', 'Origin, Accept');
    try {
      const origin = req.headers.origin;
      if (origin) {
        if (!origins.includes(origin)) throw new Failure(403, 'request.forbidden.origin', 'This browser origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Correlation-ID');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') { res.end(encode({ status: 'ok' })); return; }
      const now = (options.clock ?? Date.now)();
      for (const [key, item] of limits) if (item.resets <= now) limits.delete(key);
      const ip = clientAddress(req, options.clientIp ?? 'direct');
      let limit = limits.get(ip);
      if (!limit) {
        if (limits.size >= 10000) throw new Failure(503, 'request.capacity.reached', 'Server is busy. Try again shortly.');
        limit = { count: 0, resets: now + 60000 }; limits.set(ip, limit);
      }
      if (++limit.count > 120) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((limit.resets - now) / 1000)))); throw new Failure(429, 'request.rate_limit.exceeded', 'Too many requests. Try again shortly.'); }
      const bearer = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
      const legacy = /^[a-f0-9]{64}$/.test(bearer);
      const account = authenticate && !legacy ? await authenticate(bearer, origin) : undefined;
      const token = account ?? (legacy ? bearer : '');
      if (path === '/v1/account/session' || path === '/v1/account/link' || path === '/v1/account/operations') {
        if (!authenticate) throw new Failure(503, 'account.unavailable.configuration', 'Account login is not configured on this server.');
        if (!account) throw new Failure(401, 'account.unauthorized.session', 'Sign in to your Marginal Utility account.');
        if (path === '/v1/account/session' && req.method === 'GET') {
          res.end(encode({ snapshot: await service.accountSession(account, representation.mechanicsVersion) })); return;
        }
        if (path === '/v1/account/operations' && req.method === 'GET') {
          res.end(encode({ operations: await service.accountOperations(account) })); return;
        }
        if (path === '/v1/account/link' && req.method === 'POST') {
          const input = await body(req);
          if (typeof input.id !== 'string' || !/^[a-f0-9]{24}$/.test(input.id) || typeof input.token !== 'string' || Object.keys(input).some(key => !['id', 'token'].includes(key))) throw new Failure(400, 'account.validation.seat', 'Provide the existing operation and seat credential.');
          res.end(encode(await service.linkAccount(input.id, input.token, account, representation.mechanicsVersion))); return;
        }
        throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
      if (authenticate && !account && req.method === 'POST' && (path === '/v1/games' || path === '/v1/join')) throw new Failure(401, 'account.unauthorized.session', 'Sign in to create or join an operation.');
      res.end(encode(await gameRequest(req, url, service, token, representation.mechanicsVersion)));
    } catch (error) {
      const e = error instanceof Failure ? error : new Failure(500, 'server.internal.unavailable', 'The server could not complete this request. Retry with the same command ID.');
      if (!(error instanceof Failure)) console.error('Request failed', correlationId, (error as NodeJS.ErrnoException).code ?? 'internal');
      res.writeHead(e.status);
      res.end(encode({ issues: [{ issue: e.code, severity: 'error', correlationId, dateTime: new Date().toISOString(), message: { title: 'Command not completed', detail: e.message } }] }));
    }
  });
}
