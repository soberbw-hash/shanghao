import { useEffect, useRef } from "react";
import { RoomLifecycleState } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { MICROPHONE_INPUT_LOST } from "./microphoneInputLoss";

/** Repair only the current local input; peer connections and recordings retain ownership. */
export const useLocalInputRecovery = (
  stream: MediaStream | undefined,
  replace: (deviceId?: string) => Promise<boolean>,
  enabled = true,
): void => {
  const replaceRef = useRef(replace);
  replaceRef.current = replace;
  useEffect(() => {
    if (!stream || !enabled) return;
    let disposed = false,
      faulty = false,
      running = false,
      attempts = 0;
    let timer: number | undefined;
    const owns = () => {
      const current = useRoomStore.getState();
      return (
        !disposed &&
        current.localStream === stream &&
        current.room.lifecycleState === RoomLifecycleState.Open
      );
    };
    const repair = async () => {
      if (!owns() || running || attempts >= 3) return;
      running = true;
      attempts++;
      try {
        const device = useSettingsStore.getState().settings?.preferredInputDeviceId;
        if (await replaceRef.current(device)) faulty = false;
      } catch {
        /* The input owner reports the failure; a later device event may retry. */
      } finally {
        running = false;
        if (owns() && faulty && attempts < 3)
          timer = window.setTimeout(() => {
            timer = undefined;
            void repair();
          }, attempts * 2_000);
      }
    };
    const schedule = () => {
      faulty = true;
      if (!owns() || running || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void repair();
      }, 400);
    };
    const inputLost = (event: Event) => {
      if ((event as CustomEvent<MediaStream>).detail === stream) schedule();
    };
    const devicesChanged = () => {
      if (faulty) {
        attempts = 0;
        schedule();
      }
    };
    const tracks = stream.getAudioTracks();
    tracks.forEach((track) => track.addEventListener("ended", schedule));
    window.addEventListener(MICROPHONE_INPUT_LOST, inputLost);
    navigator.mediaDevices?.addEventListener("devicechange", devicesChanged);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      tracks.forEach((track) => track.removeEventListener("ended", schedule));
      window.removeEventListener(MICROPHONE_INPUT_LOST, inputLost);
      navigator.mediaDevices?.removeEventListener("devicechange", devicesChanged);
    };
  }, [stream, enabled]);
};
