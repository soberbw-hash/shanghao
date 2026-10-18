import type { DailyRoomReportStore } from "./daily-room-report-store";
import type { PublishRecordingRecapMessage, RecordingRecapPublishedMessage } from "./protocol";
export const handleRecordingRecap = async (
  store: DailyRoomReportStore,
  message: PublishRecordingRecapMessage,
  send: (message: RecordingRecapPublishedMessage) => void,
  reject: (code: string, message: string) => void,
  onStored?: () => Promise<void>,
): Promise<boolean> => {
  const { roomId, reportDate, recap } = message;
  const result = store.publishRecordingRecap(roomId, reportDate, recap);
  if (!result) {
    reject("invalid_report_date", "The recording date is unavailable.");
    return false;
  }
  try {
    await store.flushWrites();
    await onStored?.();
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
