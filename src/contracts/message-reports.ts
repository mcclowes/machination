/**
 * Private reporting contracts, independent of snapshots and mechanics.
 * @format
 */
import { ALL_PLAYERS, type Faction } from '../game/players';

export const REPORT_REASONS = ['harassment', 'spam', 'threat', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['open', 'reviewed', 'escalated'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportTarget =
  { kind: 'private'; id: number } | { kind: 'channel'; channelId: string; id: string };
export type SubmitMessageReport = {
  requestId: string;
  target: ReportTarget;
  reason: ReportReason;
  detail: string;
};
export type ReportingAvailability = { gameId: string; faction: Faction; available: boolean };
export type MessageReportReceipt = {
  gameId: string;
  faction: Faction;
  requestId: string;
  caseId: string;
  receivedAt: number;
};
export type ReportSummary = {
  id: string;
  gameId: string;
  reporter: Faction;
  author: Faction;
  reason: ReportReason;
  receivedAt: number;
  status: ReportStatus;
  revision: number;
};
export type ReportReview = {
  actor: string;
  requestId: string;
  revision: number;
  status: ReportStatus;
  note: string;
  reviewedAt: number;
};
export type OperatorMessageReport = ReportSummary & {
  target: ReportTarget;
  detail: string;
  evidence: { from: Faction; to?: Faction; sentAt: number; text: string };
  reviews: ReportReview[];
};
export type ReviewMessageReport = {
  requestId: string;
  revision: number;
  status: ReportStatus;
  note: string;
};
export type MessageReportList = { reports: ReportSummary[]; next?: string };

const REQUEST_ID = /^[a-zA-Z0-9-]{16,80}$/;
const CASE_ID = /^[a-f0-9]{32}$/;
const GAME_ID = /^[a-f0-9]{24}$/;
const account = (value: unknown) => typeof value === 'string' && /^user_[a-zA-Z0-9]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) =>
  Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const faction = (value: unknown): value is Faction => ALL_PLAYERS.includes(value as Faction);
const reason = (value: unknown): value is ReportReason =>
  REPORT_REASONS.includes(value as ReportReason);
const status = (value: unknown): value is ReportStatus =>
  REPORT_STATUSES.includes(value as ReportStatus);
export const isReportCaseId = (value: unknown): value is string =>
  typeof value === 'string' && CASE_ID.test(value);
export function isReportTarget(value: unknown): value is ReportTarget {
  if (!object(value)) return false;
  if (value.kind === 'private')
    return keys(value, ['kind', 'id']) && integer(value.id) && value.id < 2 ** 48;
  return (
    value.kind === 'channel' &&
    keys(value, ['kind', 'channelId', 'id']) &&
    (value.channelId === 'public' || isReportCaseId(value.channelId)) &&
    isReportCaseId(value.id)
  );
}
export function isSubmitMessageReport(value: unknown): value is SubmitMessageReport {
  return (
    object(value) &&
    keys(value, ['requestId', 'target', 'reason', 'detail']) &&
    typeof value.requestId === 'string' &&
    REQUEST_ID.test(value.requestId) &&
    isReportTarget(value.target) &&
    reason(value.reason) &&
    typeof value.detail === 'string' &&
    value.detail.length <= 500
  );
}
export function isReviewMessageReport(value: unknown): value is ReviewMessageReport {
  return (
    object(value) &&
    keys(value, ['requestId', 'revision', 'status', 'note']) &&
    typeof value.requestId === 'string' &&
    REQUEST_ID.test(value.requestId) &&
    integer(value.revision) &&
    status(value.status) &&
    typeof value.note === 'string' &&
    value.note.length <= 500
  );
}
export function reportingAvailabilityResponse(
  gameId: string,
  player: Faction,
  value: unknown,
): ReportingAvailability {
  if (
    !object(value) ||
    !keys(value, ['gameId', 'faction', 'available']) ||
    value.gameId !== gameId ||
    value.faction !== player ||
    typeof value.available !== 'boolean'
  )
    throw new Error('Unsupported reporting availability response.');
  return { gameId, faction: player, available: value.available };
}
export function messageReportReceiptResponse(
  gameId: string,
  player: Faction,
  requestId: string,
  value: unknown,
): MessageReportReceipt {
  if (
    !object(value) ||
    !keys(value, ['gameId', 'faction', 'requestId', 'caseId', 'receivedAt']) ||
    value.gameId !== gameId ||
    value.faction !== player ||
    value.requestId !== requestId ||
    !isReportCaseId(value.caseId) ||
    !integer(value.receivedAt)
  )
    throw new Error('Unsupported message report receipt.');
  return { gameId, faction: player, requestId, caseId: value.caseId, receivedAt: value.receivedAt };
}
function summary(value: unknown): boolean {
  return (
    object(value) &&
    isReportCaseId(value.id) &&
    typeof value.gameId === 'string' &&
    GAME_ID.test(value.gameId) &&
    faction(value.reporter) &&
    faction(value.author) &&
    reason(value.reason) &&
    integer(value.receivedAt) &&
    status(value.status) &&
    integer(value.revision)
  );
}
export function messageReportListResponse(value: unknown): MessageReportList {
  if (
    !object(value) ||
    !keys(value, value.next === undefined ? ['reports'] : ['reports', 'next']) ||
    !Array.isArray(value.reports) ||
    value.reports.length > 25 ||
    !value.reports.every(
      (item) =>
        summary(item) &&
        keys(item as unknown as Record<string, unknown>, [
          'id',
          'gameId',
          'reporter',
          'author',
          'reason',
          'receivedAt',
          'status',
          'revision',
        ]),
    ) ||
    new Set(value.reports.map((item) => item.id)).size !== value.reports.length ||
    (value.next !== undefined &&
      (!isReportCaseId(value.next) || value.next !== value.reports.at(-1)?.id))
  )
    throw new Error('Unsupported message report list.');
  return value as unknown as MessageReportList;
}
export function operatorMessageReportResponse(value: unknown): OperatorMessageReport {
  if (
    !summary(value) ||
    !object(value) ||
    !keys(value, [
      'id',
      'gameId',
      'reporter',
      'author',
      'reason',
      'receivedAt',
      'status',
      'revision',
      'target',
      'detail',
      'evidence',
      'reviews',
    ]) ||
    !isReportTarget(value.target) ||
    typeof value.detail !== 'string' ||
    value.detail.length > 500 ||
    !object(value.evidence) ||
    !keys(
      value.evidence,
      value.evidence.to === undefined
        ? ['from', 'sentAt', 'text']
        : ['from', 'to', 'sentAt', 'text'],
    ) ||
    value.evidence.from !== value.author ||
    (value.evidence.to !== undefined && !faction(value.evidence.to)) ||
    !integer(value.evidence.sentAt) ||
    typeof value.evidence.text !== 'string' ||
    !value.evidence.text.length ||
    value.evidence.text.length > 1000 ||
    !Array.isArray(value.reviews) ||
    value.reviews.length > 32 ||
    !value.reviews.every(
      (review) =>
        object(review) &&
        keys(review, ['actor', 'requestId', 'revision', 'status', 'note', 'reviewedAt']) &&
        account(review.actor) &&
        typeof review.requestId === 'string' &&
        REQUEST_ID.test(review.requestId) &&
        integer(review.revision) &&
        review.revision > 0 &&
        status(review.status) &&
        typeof review.note === 'string' &&
        review.note.length <= 500 &&
        integer(review.reviewedAt),
    )
  )
    throw new Error('Unsupported message report detail.');
  return value as unknown as OperatorMessageReport;
}
