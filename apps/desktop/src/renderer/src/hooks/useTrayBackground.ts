import { useEffect, useRef } from "react";
import { RecordingState, RoomLifecycleState } from "@private-voice/shared";
import { shanghaoCore } from "../core/shanghaoCore";
import { useRoomStore } from "../store/roomStore";
import { useRecordingStore } from "../store/recordingStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";

export const trayBackgroundActivity = () => ({
  inRoom: ![RoomLifecycleState.Idle, RoomLifecycleState.Closed].includes(
    useRoomStore.getState().room.lifecycleState,
  ),
  isRecording: [
    RecordingState.Preparing,
    RecordingState.Recording,
    RecordingState.Stopping,
    RecordingState.Saving,
  ].includes(useRecordingStore.getState().status.state),
});

/** Publishes only two observed lifecycle flags; no media objects or account tokens cross IPC. */
export const useTrayBackground = (): void => {
  useEffect(() => {
    const publish = () => {
      void shanghaoCore.app.setBackgroundActivity(trayBackgroundActivity()).catch(() => undefined);
    };
    publish();
    const stops = [
      useRoomStore.subscribe((next, previous) => {
        if (next.room.lifecycleState !== previous.room.lifecycleState) publish();
      }),
      useRecordingStore.subscribe((next, previous) => {
        if (next.status.state !== previous.status.state) publish();
      }),
      useSettingsStore.subscribe((next, previous) => {
        if (
          next.settings?.isFriendOnlineNotificationEnabled !==
            previous.settings?.isFriendOnlineNotificationEnabled ||
          next.settings?.isSystemNotificationEnabled !==
            previous.settings?.isSystemNotificationEnabled ||
          next.settings?.relayServerUrl !== previous.settings?.relayServerUrl
        )
          publish();
      }),
      shanghaoCore.app.onBackgroundCommand((command) => {
        if (command.kind !== "preview-room") return;
        const app = useAppStore.getState();
        app.setPendingRoomInvite(command.roomId);
        if (!trayBackgroundActivity().inRoom) app.navigate("home");
      }),
    ];
    return () => {
      stops.forEach((stop) => stop());
    };
  }, []);
};

export const useTrayRoomCommands = (
  leaveRoom: () => Promise<void>,
  openPicker: () => void,
): void => {
  const handlers = useRef({ leaveRoom, openPicker });
  handlers.current = { leaveRoom, openPicker };
  useEffect(
    () =>
      shanghaoCore.app.onBackgroundCommand((command) => {
        if (command.kind === "preview-room") {
          handlers.current.openPicker();
          return;
        }
        void (async () => {
          try {
            await handlers.current.leaveRoom();
            const activity = trayBackgroundActivity();
            await shanghaoCore.app.setBackgroundActivity(activity);
            await shanghaoCore.app.completeBackgroundClose(
              command.requestId,
              !activity.inRoom && !activity.isRecording,
            );
          } catch {
            await shanghaoCore.app
              .completeBackgroundClose(command.requestId, false)
              .catch(() => undefined);
          }
        })();
      }),
    [],
  );
};
