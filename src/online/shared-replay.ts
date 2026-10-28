import { decodeSharedReplay, utf8Size } from '../replay/codec';
import { SHARED_REPLAY_LIMITS, type SharedReplay } from '../replay/timeline';
import { RejectedCommand } from './network';

/** Authenticated read only; never uses the command queue or updates presence. */
export async function exportSharedReplay(session: { url: string; token: string; id?: string }, from: number, through: number, signal?: AbortSignal): Promise<SharedReplay> {
  if (!session.id) throw new Error('Connect to an operation first.');
  if (!Number.isFinite(from) || !Number.isFinite(through) || from < 0 || through < from) throw new Error('Choose a finite, ordered historical interval.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(`${session.url}/v1/games/${session.id}/replay?from=${encodeURIComponent(from)}&through=${encodeURIComponent(through)}`,
      { headers: { Authorization: `Bearer ${session.token}`, Accept: 'application/json' }, signal: controller.signal });
    const limit = response.ok ? SHARED_REPLAY_LIMITS.bytes : 8192;
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
      controller.abort(); throw new Error('Replay response exceeds the byte limit.');
    }
    let raw: string;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let bytes = 0; raw = '';
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) { await reader.cancel(); throw new Error('Replay response exceeds the byte limit.'); }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      } finally { reader.releaseLock(); }
    } else raw = await response.text();
    if (utf8Size(raw) > limit) throw new Error('Replay response exceeds the byte limit.');
    if (!response.ok) {
      const data = JSON.parse(raw);
      const detail = data?.issues?.[0]?.message?.detail;
      const message = typeof detail === 'string' ? detail : 'Replay export was not accepted.';
      if (response.status >= 400 && response.status < 500 && response.status !== 429) throw new RejectedCommand(response.status, message);
      throw new Error(message);
    }
    const replay = decodeSharedReplay(raw);
    if (replay.from !== from || replay.through !== through) throw new Error('Unsupported replay interval.');
    return replay;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
