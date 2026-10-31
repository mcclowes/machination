/**
 * ---
 * purpose: Keep report confirmation, receipts, and uncertain retries private to the current seat.
 * ---
 * @format
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Faction } from '../game/players';
import {
  isSubmitMessageReport,
  type ReportTarget,
  type ReportReason,
  type ReportingAvailability,
  type SubmitMessageReport,
  type MessageReportReceipt,
} from '../contracts/message-reports';
import type { MessageBlockSeat } from './useMessageBlocks';
import { RejectedCommand } from './network';

export type ReportSelection = { target: ReportTarget; sender: Faction; text: string };
export type MessageReportDeps = {
  read(seat: MessageBlockSeat): Promise<ReportingAvailability>;
  write(seat: MessageBlockSeat, body: SubmitMessageReport): Promise<MessageReportReceipt>;
  requestId(): string;
};
type Phase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
export type MessageReportState = {
  phase: Phase;
  available: boolean;
  canSelect: boolean;
  selection?: ReportSelection;
  dialogOpen: boolean;
  working: boolean;
  uncertain: boolean;
  receipt?: MessageReportReceipt;
  submission?: Pick<SubmitMessageReport, 'reason' | 'detail'>;
  error?: string;
  select(selection: ReportSelection): void;
  submit(reason: ReportReason, detail: string): void;
  retry(): void;
  refresh(): void;
  close(): void;
  resume(): void;
  reported(target: ReportTarget): boolean;
};
type State = {
  scope?: string;
  phase: Phase;
  selection?: ReportSelection;
  dialogOpen: boolean;
  working: boolean;
  receipt?: MessageReportReceipt;
  submission?: Pick<SubmitMessageReport, 'reason' | 'detail'>;
  receipts: Record<string, { receipt: MessageReportReceipt; reason: ReportReason; detail: string }>;
  error?: string;
  retryBody?: SubmitMessageReport;
};
type Started = {
  scope: string;
  generation: number;
  seat: MessageBlockSeat;
  deps: MessageReportDeps;
};
const empty = (phase: Phase, scope?: string): State => ({
  scope,
  phase,
  dialogOpen: false,
  working: false,
  receipts: {},
});
const targetKey = (target: ReportTarget) =>
  target.kind === 'private' ? `private:${target.id}` : `channel:${target.channelId}:${target.id}`;
const failureMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : 'The reporting request could not be completed. Try again.';

export function useMessageReports(
  seat: MessageBlockSeat | undefined,
  deps: MessageReportDeps,
): MessageReportState {
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
  const [state, setState] = useState<State>(empty('idle'));
  const confirmed = useRef(state);
  confirmed.current = state;
  const issuedGeneration = generation.current;
  const actionCurrent = () =>
    !!scope &&
    mounted.current &&
    latest.current.scope === scope &&
    confirmed.current.scope === scope &&
    generation.current === issuedGeneration;
  const current = (started: Started) =>
    mounted.current &&
    latest.current.scope === started.scope &&
    generation.current === started.generation;
  function change(next: Partial<State>) {
    confirmed.current = { ...confirmed.current, ...next };
    setState(confirmed.current);
  }
  function publish(started: Started, next: Partial<State>) {
    if (current(started)) change({ ...next, scope: started.scope });
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
  async function read(started: Started) {
    publish(started, { phase: 'loading' });
    try {
      const availability = await started.deps.read(started.seat);
      publish(started, {
        phase: availability.available ? 'ready' : 'unavailable',
        error: undefined,
      });
    } catch (error) {
      const unavailable = error instanceof RejectedCommand && [404, 405].includes(error.status);
      publish(started, {
        phase: unavailable ? 'unavailable' : 'error',
        error: unavailable ? undefined : failureMessage(error),
      });
    } finally {
      finish(started);
    }
  }
  async function write(started: Started, body: SubmitMessageReport) {
    try {
      const receipt = await started.deps.write(started.seat, body);
      if (!current(started)) return;
      publish(started, {
        receipt,
        receipts: {
          ...confirmed.current.receipts,
          [targetKey(body.target)]: { receipt, reason: body.reason, detail: body.detail },
        },
        retryBody: undefined,
        error: undefined,
      });
    } catch (error) {
      const uncertain = !(
        error instanceof RejectedCommand &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      );
      publish(started, {
        error: failureMessage(error),
        retryBody: uncertain ? body : undefined,
      });
    } finally {
      finish(started);
    }
  }
  function refreshCurrent() {
    if (confirmed.current.retryBody) return;
    const started = start();
    if (started) void read(started);
  }
  const refreshOnScopeChange = useEffectEvent(refreshCurrent);
  useEffect(() => {
    generation.current++;
    mounted.current = true;
    active.current = undefined;
    const next = empty(scope ? 'loading' : 'idle', scope);
    confirmed.current = next;
    setState(next);
    refreshOnScopeChange();
    return () => {
      mounted.current = false;
      active.current = undefined;
    };
  }, [scope]);
  const visible = state.scope === scope ? state : empty(scope ? 'loading' : 'idle', scope);
  const available = visible.phase === 'ready';
  const canSelect = available && !visible.working && !visible.retryBody;
  return {
    phase: visible.phase,
    available,
    canSelect,
    selection: visible.selection,
    dialogOpen: visible.dialogOpen,
    working: visible.working,
    uncertain: !!visible.retryBody,
    receipt: visible.receipt,
    submission: visible.submission,
    error: visible.error,
    refresh() {
      if (actionCurrent()) refreshCurrent();
    },
    select(selection) {
      if (!actionCurrent()) return;
      const known = confirmed.current;
      if (
        !mounted.current ||
        known.scope !== latest.current.scope ||
        known.phase !== 'ready' ||
        known.working ||
        known.retryBody
      )
        return;
      const prior = known.receipts[targetKey(selection.target)];
      // A new confirmation also revokes callbacks retained by the previous message dialog.
      generation.current++;
      change({
        selection: { ...selection, target: { ...selection.target } },
        dialogOpen: true,
        receipt: prior?.receipt,
        submission: prior && { reason: prior.reason, detail: prior.detail },
        error: undefined,
      });
    },
    submit(reason, detail) {
      if (!actionCurrent()) return;
      const known = confirmed.current;
      if (
        !mounted.current ||
        known.scope !== latest.current.scope ||
        known.phase !== 'ready' ||
        known.working ||
        !known.selection ||
        known.retryBody ||
        known.receipt
      )
        return;
      const body = {
        requestId: latest.current.deps.requestId(),
        target: Object.freeze({ ...known.selection.target }),
        reason,
        detail,
      };
      if (!isSubmitMessageReport(body)) {
        change({ error: 'Choose a report reason and enter no more than 500 characters.' });
        return;
      }
      const started = start();
      if (started) {
        publish(started, { submission: { reason, detail } });
        void write(started, Object.freeze(body));
      }
    },
    retry() {
      if (!actionCurrent()) return;
      const known = confirmed.current;
      if (known.scope !== latest.current.scope) return;
      const started = start();
      if (started) void (known.retryBody ? write(started, known.retryBody) : read(started));
    },
    close() {
      if (actionCurrent()) change({ dialogOpen: false });
    },
    resume() {
      if (actionCurrent() && confirmed.current.selection) change({ dialogOpen: true });
    },
    reported(target) {
      return actionCurrent() && !!confirmed.current.receipts[targetKey(target)];
    },
  };
}
