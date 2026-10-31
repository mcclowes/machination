/**
 * ---
 * purpose: Confirm private message-block choices without letting retries or stale completions cross seats.
 * ---
 * @format
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Faction } from '../game/players';
import type { MessageBlockSettings, SetMessageBlock } from '../contracts/message-blocks';
import type { RequestSession } from './account-auth';
import { RejectedCommand } from './network';

export type MessageBlockSeat = RequestSession & { id: string; faction: Faction };
export type MessageBlockDeps = {
  read(seat: MessageBlockSeat): Promise<MessageBlockSettings>;
  write(seat: MessageBlockSeat, body: SetMessageBlock): Promise<MessageBlockSettings>;
  requestId(): string;
};
type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
export type MessageBlockState = {
  phase: Phase;
  settings?: MessageBlockSettings;
  working: boolean;
  error?: string;
  setBlocked(player: Faction, blocked: boolean): void;
  refresh(): void;
  retry(): void;
};
type State = {
  scope?: string;
  phase: Phase;
  settings?: MessageBlockSettings;
  working: boolean;
  error?: string;
  retryBody?: SetMessageBlock;
};
type Started = {
  scope: string;
  generation: number;
  seat: MessageBlockSeat;
  deps: MessageBlockDeps;
};

export function useMessageBlocks(
  seat: MessageBlockSeat | undefined,
  deps: MessageBlockDeps,
): MessageBlockState {
  const scope =
    seat &&
    JSON.stringify([
      seat.url,
      seat.id,
      seat.faction,
      seat.accountId ?? null,
      seat.accountId ? null : seat.token,
    ]);
  const latest = useRef({ seat, scope, deps });
  latest.current = { seat, scope, deps };
  const generation = useRef(0);
  const mounted = useRef(false);
  const active = useRef<Started | undefined>(undefined);
  const [state, setState] = useState<State>({ phase: 'idle', working: false });
  const confirmed = useRef(state);
  confirmed.current = state;
  const current = (started: Started) =>
    mounted.current &&
    latest.current.scope === started.scope &&
    generation.current === started.generation;
  function publish(started: Started, change: Partial<State>) {
    if (!current(started)) return;
    confirmed.current = { ...confirmed.current, ...change, scope: started.scope };
    setState(confirmed.current);
  }
  function start(): Started | undefined {
    const { seat, scope, deps } = latest.current;
    if (!mounted.current || !seat || !scope || active.current) return;
    const started = { seat, scope, deps, generation: generation.current };
    active.current = started;
    publish(started, { working: true, error: undefined });
    return started;
  }
  function finish(started: Started) {
    if (active.current !== started) return;
    active.current = undefined;
    publish(started, { working: false });
  }
  function failed(started: Started, error: unknown, retryBody?: SetMessageBlock) {
    const unsupported = error instanceof RejectedCommand && [404, 405].includes(error.status);
    publish(started, {
      phase: unsupported ? 'unsupported' : 'error',
      error: unsupported ? undefined : (error as Error).message,
      retryBody,
    });
  }
  async function read(started: Started) {
    publish(started, { phase: 'loading', retryBody: undefined });
    try {
      publish(started, {
        settings: await started.deps.read(started.seat),
        phase: 'ready',
        error: undefined,
      });
    } catch (error) {
      failed(started, error);
    } finally {
      finish(started);
    }
  }
  async function write(started: Started, body: SetMessageBlock) {
    try {
      publish(started, {
        settings: await started.deps.write(started.seat, body),
        phase: 'ready',
        error: undefined,
        retryBody: undefined,
      });
    } catch (error) {
      if (!current(started)) return;
      if (error instanceof RejectedCommand && error.issue === 'message_block.conflict.stale') {
        try {
          const settings = await started.deps.read(started.seat);
          publish(started, {
            settings,
            phase: 'error',
            error:
              'Message blocking changed elsewhere. Review the current settings before trying again.',
            retryBody: undefined,
          });
        } catch (readError) {
          failed(started, readError);
        }
      } else
        failed(
          started,
          error,
          !(error instanceof RejectedCommand) || error.status === 429 ? body : undefined,
        );
    } finally {
      finish(started);
    }
  }
  function refresh() {
    const started = start();
    if (started) void read(started);
  }
  const refreshOnScopeChange = useEffectEvent(refresh);
  useEffect(() => {
    generation.current++;
    mounted.current = true;
    active.current = undefined;
    const next: State = { scope, phase: scope ? 'loading' : 'idle', working: false };
    confirmed.current = next;
    setState(next);
    refreshOnScopeChange();
    return () => {
      mounted.current = false;
      active.current = undefined;
    };
  }, [scope]);
  const visible =
    state.scope === scope
      ? state
      : { phase: scope ? ('loading' as const) : ('idle' as const), working: false };
  return {
    ...visible,
    refresh,
    setBlocked(player, blocked) {
      const known = confirmed.current;
      if (known.scope !== latest.current.scope || known.phase !== 'ready' || !known.settings)
        return;
      const started = start();
      if (started)
        void write(started, {
          requestId: started.deps.requestId(),
          revision: known.settings.revision,
          player,
          blocked,
        });
    },
    retry() {
      const body =
        confirmed.current.scope === latest.current.scope ? confirmed.current.retryBody : undefined;
      const started = start();
      if (started) void (body ? write(started, body) : read(started));
    },
  };
}
