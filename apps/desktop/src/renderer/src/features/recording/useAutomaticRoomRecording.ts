import { automaticRecordingDeadline } from "./automaticRecordingDeadline";
import { useEffect, useRef, useState } from "react";
import {
  RecordingState,
  RecordingEncoderState,
  RoomConnectionState,
  type RecordingStatusSnapshot,
  type RoomMember,
} from "@private-voice/shared";
import { hasRecordingCompanion } from "./hasRecordingCompanion";
import { useRoomStore } from "../../store/roomStore";
import { useAppStore } from "../../store/appStore";

export function useAutomaticRoomRecording({
  roomId,
  members,
  connectionState,
  canSend,
  isAutoRecordOnJoinEnabled,
  localStream,
  state,
  encoderState,
  source,
  startRecording,
  clearRecordingMarkers,
  finish,
}: {
  roomId: string;
  members: RoomMember[];
  connectionState: RoomConnectionState;
  canSend: boolean;
  isAutoRecordOnJoinEnabled?: boolean;
  localStream?: MediaStream | null;
  state: RecordingState;
  encoderState: RecordingEncoderState;
  source?: "automatic" | "manual";
  startRecording: (source: "automatic") => Pick<RecordingStatusSnapshot, "state" | "message">;
  clearRecordingMarkers: () => void;
  finish: () => Promise<void>;
}) {
  const pushToast = useAppStore((s) => s.pushToast);
  const hasAutoStartedRecordingRef = useRef(false);
  const isAutoRecordSuppressedRef = useRef(false);
  const autoRecordRetryCountRef = useRef(0);
  const autoRecordRetryTimerRef = useRef<number | undefined>(undefined);

  const [deadline, setDeadline] = useState<number>();
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    hasAutoStartedRecordingRef.current = false;
    isAutoRecordSuppressedRef.current = false;
    autoRecordRetryCountRef.current = 0;
    if (autoRecordRetryTimerRef.current !== undefined) {
      window.clearTimeout(autoRecordRetryTimerRef.current);
      autoRecordRetryTimerRef.current = undefined;
    }
  }, [roomId]);

  useEffect(() => {
    if (isAutoRecordOnJoinEnabled) isAutoRecordSuppressedRef.current = false;
  }, [isAutoRecordOnJoinEnabled]);

  const hasAutoRecordingCompanion = hasRecordingCompanion(members);
  useEffect(() => {
    const hasLiveMicrophone = localStream
      ?.getAudioTracks()
      .some((track) => track.readyState === "live");
    const canAutoRecord =
      isAutoRecordOnJoinEnabled &&
      canSend &&
      hasAutoRecordingCompanion &&
      hasLiveMicrophone &&
      state === RecordingState.Idle &&
      encoderState !== RecordingEncoderState.Unsupported;

    if (!canAutoRecord || hasAutoStartedRecordingRef.current || isAutoRecordSuppressedRef.current)
      return;

    const attemptAutoRecord = () => {
      const currentRoom = useRoomStore.getState().room;
      if (
        isAutoRecordSuppressedRef.current ||
        currentRoom.roomId !== roomId ||
        !hasRecordingCompanion(currentRoom.members)
      ) {
        autoRecordRetryTimerRef.current = undefined;
        return;
      }
      hasAutoStartedRecordingRef.current = true;
      try {
        const status = startRecording("automatic");
        if (status.state !== RecordingState.Recording) {
          throw new Error(status.message || "recording_start_failed");
        }
        clearRecordingMarkers();
        autoRecordRetryCountRef.current = 0;
        autoRecordRetryTimerRef.current = undefined;
        // Joining already plays its entry cue. Automatic recording keeps its
        // visual confirmation without layering a second startup sound on top.
        pushToast({
          tone: "neutral",
          title: "已自动开始录音",
          description: "独处满五分钟或离开房间时保存。",
        });
        void window.desktopApi.app.writeLog({
          category: "recording",
          level: "info",
          message: "auto_record_started",
        });
      } catch (error) {
        hasAutoStartedRecordingRef.current = false;
        autoRecordRetryCountRef.current += 1;
        const retryCount = autoRecordRetryCountRef.current;
        void window.desktopApi.app.writeLog({
          category: "recording",
          level: retryCount >= 5 ? "error" : "warn",
          message: retryCount >= 5 ? "auto_record_start_failed" : "auto_record_start_retry",
          context: {
            retryCount,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (retryCount < 5) {
          autoRecordRetryTimerRef.current = window.setTimeout(
            attemptAutoRecord,
            600 + retryCount * 250,
          );
        }
      }
    };

    autoRecordRetryTimerRef.current = window.setTimeout(attemptAutoRecord, 450);
    return () => {
      if (autoRecordRetryTimerRef.current !== undefined) {
        window.clearTimeout(autoRecordRetryTimerRef.current);
        autoRecordRetryTimerRef.current = undefined;
      }
    };
  }, [
    canSend,
    encoderState,
    clearRecordingMarkers,
    localStream,
    pushToast,
    state,
    roomId,
    hasAutoRecordingCompanion,
    isAutoRecordOnJoinEnabled,
    startRecording,
  ]);

  const automatic = state === RecordingState.Recording && source === "automatic";
  const disconnected =
    connectionState === RoomConnectionState.Disconnected ||
    connectionState === RoomConnectionState.Failed;
  useEffect(() => {
    if (!automatic) {
      setDeadline(undefined);
      return;
    }
    const save = () => {
      if (useRoomStore.getState().room.roomId !== roomId) return;
      hasAutoStartedRecordingRef.current = false;
      void finishRef
        .current()
        .catch(() => pushToast({ tone: "danger", title: "录音保存失败，请在离开前重试" }));
    };
    if (disconnected || !isAutoRecordOnJoinEnabled) {
      save();
      return;
    }
    if (hasAutoRecordingCompanion) {
      setDeadline(undefined);
      return;
    }
    const countdown = automaticRecordingDeadline(
      window,
      () => !hasRecordingCompanion(useRoomStore.getState().room.members),
      save,
    );
    setDeadline(countdown.expires);
    return countdown.cancel;
  }, [
    automatic,
    disconnected,
    hasAutoRecordingCompanion,
    isAutoRecordOnJoinEnabled,
    roomId,
    pushToast,
  ]);

  return {
    deadline,
    suppress: () => {
      isAutoRecordSuppressedRef.current = true;
    },
  };
}
