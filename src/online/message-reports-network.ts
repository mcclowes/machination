/** @format */
import { ALL_PLAYERS } from '../game/players';
import {
  isSubmitMessageReport,
  reportingAvailabilityResponse,
  messageReportReceiptResponse,
  type SubmitMessageReport,
  type ReportingAvailability,
  type MessageReportReceipt,
} from '../contracts/message-reports';
import type { MessageBlockSeat } from './useMessageBlocks';
import { request } from './network';

function requireSeat(seat: MessageBlockSeat) {
  if (!/^[a-f0-9]{24}$/.test(seat.id) || !ALL_PLAYERS.includes(seat.faction))
    throw new Error('Invalid reporting seat.');
}
export async function reportingAvailabilityApi(
  seat: MessageBlockSeat,
): Promise<ReportingAvailability> {
  requireSeat(seat);
  return reportingAvailabilityResponse(
    seat.id,
    seat.faction,
    await request(seat, `games/${seat.id}/reporting`),
  );
}
export async function submitMessageReportApi(
  seat: MessageBlockSeat,
  body: SubmitMessageReport,
): Promise<MessageReportReceipt> {
  requireSeat(seat);
  if (!isSubmitMessageReport(body)) throw new Error('Invalid message report.');
  return messageReportReceiptResponse(
    seat.id,
    seat.faction,
    body.requestId,
    await request(seat, `games/${seat.id}/message-reports`, body),
  );
}
