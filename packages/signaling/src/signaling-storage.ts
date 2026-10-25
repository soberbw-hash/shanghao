import { ChatHistoryStore } from "./chat-history-store";
import { RoomCollectionStore } from "./room-collection-store";
import { DailyRoomReportStore } from "./daily-room-report-store";

/** A local temporary coordinator must never inherit permanent storage environment paths. */
export function createSignalingStorage(
  options: { temporaryOnly?: boolean; privateRoomFile?: string; dailyRoomReportFile?: string },
  log?: (message: string, context?: Record<string, unknown>) => void,
) {
  const historyFile = options.temporaryOnly ? undefined : process.env.CHAT_HISTORY_FILE;
  const collectionFile = options.temporaryOnly
    ? undefined
    : (process.env.ROOM_COLLECTION_FILE ??
      (historyFile ? `${historyFile}.collection.json` : undefined));
  const dailyFile = options.temporaryOnly
    ? undefined
    : options.dailyRoomReportFile?.trim() ||
      process.env.DAILY_ROOM_REPORT_FILE ||
      (historyFile ? `${historyFile}.daily-reports.json` : undefined);
  const privateRoomFile = options.temporaryOnly
    ? undefined
    : (options.privateRoomFile ??
      process.env.ROOM_DIRECTORY_FILE ??
      (historyFile ? `${historyFile}.private-rooms.json` : undefined));
  if (!options.temporaryOnly && process.env.NODE_ENV === "production" && !privateRoomFile)
    throw Error("private_room_durable_storage_required");
  if (!options.temporaryOnly && process.env.NODE_ENV === "production" && !dailyFile)
    log?.("daily room reports are not using durable storage", {
      action: "set DAILY_ROOM_REPORT_FILE or CHAT_HISTORY_FILE to a persistent volume",
    });
  return {
    chatHistory: ChatHistoryStore.create(historyFile, log),
    roomCollection: RoomCollectionStore.create(collectionFile, log),
    dailyRoomReports: DailyRoomReportStore.create(dailyFile, log),
    privateRoomFile,
  };
}
