import type { RoomClient } from "./roomClient";
import { useDailyRoomReportStore } from "../../store/dailyRoomReportStore";

/** A late report response may update only the client that requested it. */
export function loadCurrentRoomReports(
  client: RoomClient,
  roomId: string,
  current: () => RoomClient | null,
): void {
  useDailyRoomReportStore.getState().beginLoading([roomId]);
  void client.requestDailyRoomReports(roomId).then(
    (available) => {
      if (current() === client && !available)
        useDailyRoomReportStore.getState().setUnavailable([roomId]);
    },
    () => {
      if (current() === client) useDailyRoomReportStore.getState().setUnavailable([roomId]);
    },
  );
}
