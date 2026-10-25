import { useEffect } from "react";
import { RoomLifecycleState } from "@private-voice/shared";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useAppStore } from "../store/appStore";
import { createMutedSpeechReminder } from "../features/audio/mutedSpeechReminder";
import { playUiSound } from "../features/audio/uiSound";

/** Observes the existing pre-send VAD; never opens a microphone or touches sending. */
export function useMutedSpeechReminder(): void {
  useEffect(() => {
    const gate = createMutedSpeechReminder();
    let previousStream: MediaStream | undefined;
    let previousRoom: string | undefined;
    let previousDiagnostics: unknown;
    const inspect = () => {
      const audio = useAudioStore.getState();
      const { room, localStream } = useRoomStore.getState();
      const settings = useSettingsStore.getState().settings;
      const track = localStream?.getAudioTracks()[0];
      if (previousStream !== localStream || previousRoom !== room.roomId) {
        previousStream = localStream;
        previousRoom = room.roomId;
        previousDiagnostics = audio.localDiagnostics;
        gate.reset();
        return;
      }
      const eligible =
        room.lifecycleState === RoomLifecycleState.Open &&
        track?.readyState === "live" &&
        !track.muted &&
        audio.isMuted &&
        audio.isManuallyMuted &&
        !audio.isDeafened &&
        !audio.phoneModeActive &&
        !audio.isPushToTalkEnabled &&
        !settings?.isPushToTalkEnabled &&
        settings?.isMutedSpeechReminderEnabled !== false;
      if (!eligible) {
        previousDiagnostics = audio.localDiagnostics;
        gate.reset();
        return;
      }
      if (previousDiagnostics === audio.localDiagnostics) return;
      previousDiagnostics = audio.localDiagnostics;
      if (
        !gate.observe({
          ...audio.localDiagnostics,
          now: performance.now(),
          scopeId: room.roomId,
          eligible,
        })
      )
        return;
      const title = "你的麦克风还处于静音状态";
      const body = "想让朋友听见时，请手动打开麦克风。";
      useAppStore.getState().pushToast({
        tone: "warning",
        title,
        description: body,
        dedupeKey: "muted-speech-reminder",
      });
      if (settings?.isUiSoundEnabled !== false) playUiSound("muted-speech-reminder");
      if (!document.hasFocus() && settings?.isSystemNotificationEnabled !== false)
        void window.desktopApi.app.notify({ title, body, silent: true }).catch(() => undefined);
    };
    const stopAudio = useAudioStore.subscribe(inspect);
    const stopRoom = useRoomStore.subscribe(inspect);
    const stopSettings = useSettingsStore.subscribe(inspect);
    inspect();
    return () => {
      stopAudio();
      stopRoom();
      stopSettings();
      gate.reset();
    };
  }, []);
}
