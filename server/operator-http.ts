/**
 * Separately authenticated operator views over the active service transaction queue.
 * @format
 */
import type { IncomingMessage } from 'node:http';
import type { GameService } from './service';
import type { AccountAuthentication } from './auth';
import { REPORT_STATUSES, type ReportStatus } from '../src/contracts/message-reports';
import { Failure, requireThat } from './failure';

export async function operatorRequest(
  request: IncomingMessage,
  url: URL,
  service: GameService,
  authenticate: AccountAuthentication | undefined,
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>,
): Promise<unknown> {
  requireThat(
    authenticate,
    503,
    'operator.unavailable.configuration',
    'Operator review is unavailable on this server.',
  );
  const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] ?? '';
  const actor = await authenticate(token, request.headers.origin);
  const match = url.pathname.match(/^\/v1\/operator\/message-reports(?:\/([a-f0-9]{32}))?$/);
  requireThat(match, 404, 'request.not_found.route', 'Endpoint not found.');
  const id = match[1];
  if (id) {
    requireThat(
      [...url.searchParams].length === 0,
      400,
      'report.validation.query',
      'This report endpoint takes no query parameters.',
    );
    if (request.method === 'GET') return service.messageReport(id);
    if (request.method === 'POST')
      return service.reviewMessageReport(id, actor.accountId, await readBody(request));
  } else if (request.method === 'GET') {
    const status = url.searchParams.get('status'),
      after = url.searchParams.get('after');
    requireThat(
      [...url.searchParams.keys()].every((key) => ['status', 'after'].includes(key)) &&
        ['status', 'after'].every((key) => url.searchParams.getAll(key).length <= 1) &&
        (status === null || REPORT_STATUSES.includes(status as ReportStatus)) &&
        (after === null || /^[a-f0-9]{32}$/.test(after)),
      400,
      'report.validation.query',
      'Choose a supported status and report cursor.',
    );
    return service.listMessageReports({
      ...(status === null ? {} : { status: status as ReportStatus }),
      ...(after === null ? {} : { after }),
    });
  }
  throw new Failure(405, 'request.validation.method', 'Method not allowed.');
}
