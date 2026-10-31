/**
 * Private report evidence and operator dispositions owned by the service transaction.
 * @format
 */
import { randomBytes } from 'node:crypto';
import type { Database, Room } from './database';
import type { Faction } from '../src/game/players';
import { Failure, requireThat } from './failure';
import { archiveReportState, reportState } from './report-source';
import {
  isReportCaseId,
  isSubmitMessageReport,
  isReviewMessageReport,
  operatorMessageReportResponse,
  type SubmitMessageReport,
  type MessageReportReceipt,
  type OperatorMessageReport,
  type MessageReportList,
  type ReportStatus,
  type ReportSummary,
} from '../src/contracts/message-reports';

export const REPORT_LIMITS = { cases: 1000, perSeat: 32, reviews: 16, page: 25 } as const;
type StoredCase = OperatorMessageReport & { request: SubmitMessageReport };
type Ledger = { version: 1; cases: StoredCase[] };
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function intent(request: SubmitMessageReport): string {
  return JSON.stringify([
    request.target.kind,
    request.target.kind === 'channel' ? request.target.channelId : null,
    request.target.id,
    request.reason,
    request.detail,
  ]);
}
function view(stored: StoredCase): OperatorMessageReport {
  const { request: _privateRequest, ...report } = stored;
  return structuredClone(report);
}
function ledger(db: Readonly<Database>): Ledger {
  if (db.messageReports === undefined) return { version: 1, cases: [] };
  try {
    const value = reportState(db.messageReports);
    if (
      !object(value) ||
      Object.keys(value).length !== 2 ||
      value.version !== 1 ||
      !Array.isArray(value.cases) ||
      value.cases.length > REPORT_LIMITS.cases
    )
      throw new Error();
    const identities = new Set<string>();
    const reviews = new Set<string>();
    for (const candidate of value.cases) {
      if (!object(candidate) || !isSubmitMessageReport(candidate.request)) throw new Error();
      const { request, ...detail } = candidate;
      const report = operatorMessageReportResponse(detail);
      if (
        intent(request) !==
          intent({
            requestId: request.requestId,
            target: report.target,
            reason: report.reason,
            detail: report.detail,
          }) ||
        report.author === report.reporter ||
        report.revision !== report.reviews.length ||
        report.reviews.length > REPORT_LIMITS.reviews ||
        report.reviews.some((entry, index) => entry.revision !== index + 1) ||
        report.status !== (report.reviews.at(-1)?.status ?? 'open') ||
        (report.target.kind === 'private' && report.evidence.to !== report.reporter) ||
        (report.target.kind === 'channel' && report.evidence.to !== undefined)
      )
        throw new Error();
      for (const identity of [
        `case:${report.id}`,
        `request:${report.gameId}:${report.reporter}:${request.requestId}`,
      ]) {
        if (identities.has(identity)) throw new Error();
        identities.add(identity);
      }
      for (const review of report.reviews) {
        const identity = `${review.actor}:${review.requestId}`;
        if (reviews.has(identity)) throw new Error();
        reviews.add(identity);
      }
    }
    return value as unknown as Ledger;
  } catch {
    throw new Failure(
      503,
      'report.unavailable.storage',
      'Message reporting is temporarily unavailable.',
    );
  }
}
export function reportsAvailable(
  db: Readonly<Database>,
  gameId: string,
  reporter: Faction,
): boolean {
  try {
    const stored = ledger(db);
    return (
      stored.cases.length < REPORT_LIMITS.cases &&
      stored.cases.filter((item) => item.gameId === gameId && item.reporter === reporter).length <
        REPORT_LIMITS.perSeat
    );
  } catch {
    return false;
  }
}
function receipt(report: StoredCase): MessageReportReceipt {
  return {
    gameId: report.gameId,
    faction: report.reporter,
    requestId: report.request.requestId,
    caseId: report.id,
    receivedAt: report.receivedAt,
  };
}
export function submitMessageReport(
  db: Database,
  room: Room,
  reporter: Faction,
  input: unknown,
  now: number,
  enabled: boolean,
  alias: (id: number) => number,
): MessageReportReceipt {
  requireThat(
    isSubmitMessageReport(input),
    400,
    'report.validation.payload',
    'Choose a message and report reason, with at most 500 characters of detail.',
  );
  const stored = ledger(db);
  const prior = stored.cases.find(
    (item) =>
      item.gameId === room.id &&
      item.reporter === reporter &&
      item.request.requestId === input.requestId,
  );
  if (prior) {
    requireThat(
      intent(prior.request) === intent(input),
      409,
      'report.conflict.request',
      'This request ID was already used for a different report.',
    );
    return receipt(prior);
  }
  requireThat(
    enabled,
    503,
    'report.unavailable.configuration',
    'Message reporting is unavailable on this server.',
  );
  requireThat(
    reportsAvailable(db, room.id, reporter),
    503,
    'report.capacity.reached',
    'Message reporting has reached its current capacity.',
  );
  let evidence: OperatorMessageReport['evidence'] | undefined;
  const target = input.target;
  if (target.kind === 'private') {
    const matches = room.messages.filter(
      (message) =>
        message.from !== reporter && message.to === reporter && alias(message.id) === target.id,
    );
    if (matches.length === 1) {
      const message = matches[0]!;
      evidence = { from: message.from, to: message.to, sentAt: message.sentAt, text: message.text };
    }
  } else {
    const group = room.diplomacy?.groups.find(
      (group) => group.id === target.channelId && group.members.includes(reporter),
    );
    const messages =
      target.channelId === 'public' ? room.diplomacy?.publicMessages : group?.messages;
    const message = messages?.find(
      (message) => message.id === target.id && message.from !== reporter,
    );
    if (message) evidence = { from: message.from, sentAt: message.sentAt, text: message.text };
  }
  requireThat(
    evidence,
    404,
    'report.not_found.message',
    'This message is unavailable for reporting.',
  );
  requireThat(
    Number.isSafeInteger(now) && now >= 0,
    503,
    'report.unavailable.clock',
    'Message reporting is temporarily unavailable.',
  );
  const id = randomBytes(16).toString('hex');
  requireThat(
    !stored.cases.some((item) => item.id === id),
    503,
    'report.capacity.identity',
    'Message reporting is temporarily unavailable.',
  );
  const report: StoredCase = {
    id,
    gameId: room.id,
    reporter,
    author: evidence.from,
    target: structuredClone(input.target),
    reason: input.reason,
    detail: input.detail,
    receivedAt: now,
    evidence,
    status: 'open',
    revision: 0,
    reviews: [],
    request: structuredClone(input),
  };
  stored.cases.push(report);
  db.messageReports = archiveReportState(stored, JSON.stringify(stored));
  return receipt(report);
}
export function listMessageReports(
  db: Readonly<Database>,
  options: { status?: ReportStatus; after?: string } = {},
): MessageReportList {
  const reports = [...ledger(db).cases].reverse();
  const start =
    options.after === undefined ? -1 : reports.findIndex((item) => item.id === options.after);
  requireThat(
    options.after === undefined || start >= 0,
    404,
    'report.not_found.cursor',
    'Report cursor not found.',
  );
  const matching = reports
    .slice(start + 1)
    .filter((item) => options.status === undefined || item.status === options.status);
  const page = matching.slice(0, REPORT_LIMITS.page);
  const summaries: ReportSummary[] = page.map(
    ({ id, gameId, reporter, author, reason, receivedAt, status, revision }) => ({
      id,
      gameId,
      reporter,
      author,
      reason,
      receivedAt,
      status,
      revision,
    }),
  );
  return {
    reports: summaries,
    ...(matching.length > page.length ? { next: page.at(-1)!.id } : {}),
  };
}
export function messageReport(db: Readonly<Database>, id: string): OperatorMessageReport {
  const report = ledger(db).cases.find((item) => item.id === id);
  requireThat(report, 404, 'report.not_found.case', 'Report not found.');
  return view(report);
}
export function reviewMessageReport(
  db: Database,
  id: string,
  actor: string,
  input: unknown,
  now: number,
): OperatorMessageReport {
  requireThat(
    /^user_[a-zA-Z0-9]+$/.test(actor),
    401,
    'operator.unauthorized.session',
    'Operator sign-in required.',
  );
  requireThat(
    isReportCaseId(id) && isReviewMessageReport(input),
    400,
    'report.validation.review',
    'Provide a report ID, current revision, review state, and note of at most 500 characters.',
  );
  const stored = ledger(db);
  const prior = stored.cases
    .flatMap((item) => item.reviews.map((review) => ({ item, review })))
    .find(({ review }) => review.actor === actor && review.requestId === input.requestId);
  if (prior) {
    requireThat(
      prior.item.id === id &&
        prior.review.revision === input.revision + 1 &&
        prior.review.status === input.status &&
        prior.review.note === input.note,
      409,
      'report.conflict.request',
      'This request ID was already used for a different review.',
    );
    return view(prior.item);
  }
  const report = stored.cases.find((item) => item.id === id);
  requireThat(report, 404, 'report.not_found.case', 'Report not found.');
  requireThat(
    report.revision === input.revision,
    409,
    'report.conflict.stale',
    'This report changed. Refresh before reviewing it.',
  );
  requireThat(
    report.reviews.length < REPORT_LIMITS.reviews,
    409,
    'report.capacity.reviews',
    'This report has reached its review history limit.',
  );
  requireThat(
    Number.isSafeInteger(now) && now >= 0,
    503,
    'report.unavailable.clock',
    'Report review is temporarily unavailable.',
  );
  report.revision++;
  report.status = input.status;
  report.reviews.push({
    actor,
    requestId: input.requestId,
    revision: report.revision,
    status: input.status,
    note: input.note,
    reviewedAt: now,
  });
  db.messageReports = archiveReportState(stored, JSON.stringify(stored));
  return view(report);
}
