/**
 * ---
 * purpose: Bounded JSON HTTP adapter for the multiplayer service, with seat authentication and consistent failures.
 * ---
 */
import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Failure, GameService } from './service';
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
export function createApi(service: GameService, origins: string[] = ['http://localhost:8081', 'http://localhost:8082']) {
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
      const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '';
      let result: unknown;
      if (req.method === 'POST' && path === '/v1/games') {
        const input = await body(req);
        if (Object.keys(input).some(key => key !== 'options')) throw new Failure(400, 'game.validation.options', 'Provide game options inside options.');
        result = await service.create(token, input.options);
      }
      else if (req.method === 'POST' && path === '/v1/join') {
        const input = await body(req);
        if (typeof input.invite !== 'string') throw new Failure(400, 'game.validation.invite', 'Provide an invitation code.');
        result = await service.join(input.invite, token);
      } else {
        const match = path.match(/^\/v1\/games\/([a-f0-9]{24})(?:\/(resign|activity|history|funding|start|orders|specialists|haulers|sites|gifts|messages|groups|channel-messages|modules|schedules|edit-schedule|cancel-schedule|intercepts|recovery|recover))?$/);
        if (!match) throw new Failure(404, 'request.not_found.route', 'Endpoint not found.');
        const id = match[1]!; const action = match[2];
        if (req.method === 'GET' && !action) result = await service.snapshot(id, token);
        else if (req.method === 'GET' && action === 'history') {
          const hour = url.searchParams.get('hour');
          if (!hour?.trim() || url.searchParams.getAll('hour').length !== 1 || !Number.isFinite(Number(hour))) throw new Failure(400, 'history.validation.hour', 'Provide one finite historical hour.');
          result = await service.history(id, token, Number(hour));
        }
        else if (req.method === 'POST') {
          const input = await body(req);
          if (action === 'activity') result = await service.activity(id, token);
          else if (action === 'resign') result = await service.resign(id, token, input as ResignOrder);
          else if (action === 'recovery') result = await service.setRecovery(id, token, input as RecoverySetup);
          else if (action === 'recover') result = await service.recover(id, token, input as RecoverSeat);
          else if (action === 'start') result = await service.start(id, token);
          else if (action === 'specialists') result = await service.specialist(id, token, input as SpecialistOrder);
          else if (action === 'haulers') result = await service.hauler(id, token, input as HaulerOrder);
          else if (action === 'sites') result = await service.site(id, token, input as SiteOrder);
          else if (action === 'orders') result = await service.order(id, token, input as Order);
          else if (action === 'gifts') result = await service.gift(id, token, input as GiftOrder);
          else if (action === 'intercepts') result = await service.intercept(id, token, input as InterceptOrder);
          else if (action === 'schedules') result = await service.schedule(id, token, input as ScheduleOrder);
          else if (action === 'edit-schedule') result = await service.editSchedule(id, token, input as EditSchedule);
          else if (action === 'cancel-schedule') result = await service.cancelSchedule(id, token, input as CancelSchedule);
          else if (action === 'modules') result = await service.install(id, token, input as ModuleOrder);
          else if (action === 'funding') result = await service.funding(id, token, input as FundingOrder);
          else if (action === 'groups') result = await service.createGroup(id, token, input as CreateGroup);
          else if (action === 'channel-messages') result = await service.channelMessage(id, token, input as ChannelTransmission);
          else if (action === 'messages') result = await service.message(id, token, input as Transmission);
          else throw new Failure(405, 'request.validation.method', 'Method not allowed.');
        } else throw new Failure(405, 'request.validation.method', 'Method not allowed.');
      }
      res.end(JSON.stringify(result));
    } catch (error) {
      const e = error instanceof Failure ? error : new Failure(500, 'server.internal.unavailable', 'The server could not complete this request. Retry with the same command ID.');
      if (!(error instanceof Failure)) console.error('Request failed', correlationId, (error as NodeJS.ErrnoException).code ?? 'internal');
      res.writeHead(e.status);
      res.end(JSON.stringify({ issues: [{ issue: e.code, severity: 'error', correlationId, dateTime: new Date().toISOString(), message: { title: 'Command not completed', detail: e.message } }] }));
    }
  });
}
