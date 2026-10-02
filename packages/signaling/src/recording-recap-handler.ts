import type { DailyRoomReportStore } from "./daily-room-report-store";
import type { PublishRecordingRecapMessage, RecordingRecapPublishedMessage } from "./protocol";
/** Called only after socket/session authorization; acknowledge durable storage. */
export const handleRecordingRecap = async (
  store: DailyRoomReportStore,
  message: PublishRecordingRecapMessage,
  send: (message: RecordingRecapPublishedMessage) => void,
  reject: (code: string, message: string) => void,
): Promise<boolean> => {
  const result = store.publishRecordingRecap(
    message.roomId,
    message.reportDate,
    message.recap,
    Date.now(),
  );
  if (!result) {
    reject("invalid_report_date", "The recording date is unavailable.");
    return false;
  }
  try {
    await store.flushWrites();
  } catch {
    reject("recording_recap_storage_failed", "The summary could not be saved.");
    return false;
  }
  send({
    type: "recording_recap_published",
    roomId: message.roomId,
    peerId: message.peerId,
    requestId: message.requestId,
    reportDate: message.reportDate,
    ...result,
  });
  return true;
};
