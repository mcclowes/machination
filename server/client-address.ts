/**
 * ---
 * purpose: Resolve rate-limit identities with explicit trust in direct connections or Railway HTTP ingress.
 * ---
 */
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export type ClientIpMode = 'direct' | 'railway';

export function clientIpMode(value: string | undefined): ClientIpMode {
  if (value === undefined || value === 'direct') return 'direct';
  if (value === 'railway') return 'railway';
  throw new Error('MACHINATION_CLIENT_IP must be direct or railway.');
}

function normalizedIp(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6 || value.includes('%')) return undefined;
  const address = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = address.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (!mapped) return address;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

export function clientAddress(request: IncomingMessage, mode: ClientIpMode): string {
  const forwarded = mode === 'railway' ? normalizedIp(request.headers['x-real-ip']) : undefined;
  return forwarded ?? normalizedIp(request.socket.remoteAddress) ?? 'unknown';
}
