/**
 * Review private report data without opening the game database or claiming its writer.
 * @format
 */
import {
  isReportCaseId,
  isReviewMessageReport,
  messageReportListResponse,
  operatorMessageReportResponse,
  REPORT_STATUSES,
  type MessageReportList,
  type OperatorMessageReport,
  type ReviewMessageReport,
} from '../src/contracts/message-reports';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type OperatorRequest = { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };
export type OperatorTransport = (
  url: URL,
  request: OperatorRequest,
) => Promise<{ status: number; body: unknown }>;
const sendOperatorRequest: OperatorTransport = (url, input) =>
  new Promise((resolve, reject) => {
    const outgoing = httpsRequest(
      url.toString(),
      {
        method: input.method,
        headers: input.headers,
        agent: false,
        rejectUnauthorized: true,
        maxHeaderSize: 8192,
        signal: AbortSignal.timeout(4000),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65_536) outgoing.destroy(new Error('Operator response exceeds 64 KB.'));
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new Error('Operator HTTPS response failed.')));
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
            });
          } catch {
            reject(new Error('Operator response is not bounded JSON.'));
          }
        });
      },
    );
    outgoing.on('error', () => reject(new Error('Operator HTTPS request failed.')));
    outgoing.end(input.body);
  });

export async function reviewMessageReports(
  args: string[],
  session: string | undefined,
  send: OperatorTransport = sendOperatorRequest,
): Promise<MessageReportList | OperatorMessageReport> {
  const command = args[0];
  if (command !== 'list' && command !== 'show' && command !== 'review')
    throw new Error('Choose list, show, or review. Use --help.');
  const permitted =
    command === 'list'
      ? ['origin', 'status', 'after']
      : command === 'show'
        ? ['origin', 'id']
        : ['origin', 'id', 'request-id', 'revision', 'status', 'note'];
  const values = new Map<string, string>();
  for (const argument of args.slice(1)) {
    const match = argument.match(/^--([a-z-]+)=(.*)$/s);
    if (!match || !permitted.includes(match[1]!) || values.has(match[1]!))
      throw new Error('Unknown or duplicate option. Use --help.');
    values.set(match[1]!, match[2]!);
  }
  let origin: URL;
  try {
    origin = new URL(values.get('origin') ?? '');
  } catch {
    throw new Error('Provide an HTTPS origin without credentials, path, query, or fragment.');
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Provide an HTTPS origin without credentials, path, query, or fragment.');
  if (!session || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(session))
    throw new Error('Set MACHINATION_OPERATOR_SESSION to a current operator session.');
  const url = new URL('/v1/operator/message-reports', origin);
  const id = values.get('id');
  if (command !== 'list') {
    if (!isReportCaseId(id)) throw new Error('Provide a valid report ID.');
    url.pathname += `/${id}`;
  }
  const status = values.get('status');
  const after = values.get('after');
  if (command === 'list' && status !== undefined) {
    if (!REPORT_STATUSES.includes(status as (typeof REPORT_STATUSES)[number]))
      throw new Error('Choose open, reviewed, or escalated status.');
    url.searchParams.set('status', status);
  }
  if (after !== undefined) {
    if (!isReportCaseId(after)) throw new Error('Provide a valid report cursor.');
    url.searchParams.set('after', after);
  }
  let review: ReviewMessageReport | undefined;
  if (command === 'review') {
    const revision = values.get('revision');
    const input = {
      requestId: values.get('request-id'),
      revision:
        revision !== undefined && /^(?:0|[1-9][0-9]*)$/.test(revision) ? Number(revision) : NaN,
      status,
      note: values.get('note'),
    };
    if (!isReviewMessageReport(input))
      throw new Error(
        'Provide an explicit request ID, nonnegative revision, status, and note of at most 500 characters.',
      );
    review = input;
  }
  const request: OperatorRequest = {
    method: review ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session}`,
      Accept: 'application/json',
      Connection: 'close',
    },
  };
  if (review) {
    request.body = JSON.stringify(review);
    request.headers['Content-Type'] = 'application/json';
    request.headers['Content-Length'] = String(Buffer.byteLength(request.body));
  }
  const wire = `${request.method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n${Object.entries(
    request.headers,
  )
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')}\r\n${request.body ?? ''}`;
  if (Buffer.byteLength(wire) > 8192) throw new Error('Operator request exceeds 8 KB.');
  let response;
  try {
    response = await send(url, request);
  } catch {
    throw new Error(
      'Operator request failed before a verified acknowledgement. Reuse the same request ID and payload when retrying a review.',
    );
  }
  if (response.status !== 200)
    throw new Error(`Operator API refused the request (HTTP ${response.status}).`);
  try {
    if (command === 'list') {
      const list = messageReportListResponse(response.body);
      if (status !== undefined && list.reports.some((report) => report.status !== status))
        throw new Error();
      return list;
    }
    const report = operatorMessageReportResponse(response.body);
    if (report.id !== id) throw new Error();
    if (
      review &&
      !report.reviews.some(
        (receipt) =>
          receipt.requestId === review.requestId &&
          receipt.revision === review.revision + 1 &&
          receipt.status === review.status &&
          receipt.note === review.note,
      )
    )
      throw new Error();
    return report;
  } catch {
    throw new Error(
      'Unsupported operator response. Reuse the same request ID and payload when retrying a review.',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help')
    console.log(
      'Use Node 24.14.1: node --import tsx scripts/review-message-reports.ts <command> --origin=https://host\nSet MACHINATION_OPERATOR_SESSION in the environment; never pass a token as an argument.\nlist [--status=open|reviewed|escalated] [--after=32hex]\nshow --id=32hex\nreview --id=32hex --request-id=unique-16-to-80-characters --revision=N --status=open|reviewed|escalated --note=TEXT\nReview retries must retain the same request ID and payload. Output contains private report data; keep it private. This command does not enforce bans or delete content.',
    );
  else {
    const session = process.env.MACHINATION_OPERATOR_SESSION;
    void reviewMessageReports(args, session)
      .then((result) => {
        const output = JSON.stringify(result, null, 2);
        console.log(session ? output.replaceAll(session, '[redacted operator session]') : output);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : 'Operator review failed.');
        process.exitCode = 1;
      });
  }
}
