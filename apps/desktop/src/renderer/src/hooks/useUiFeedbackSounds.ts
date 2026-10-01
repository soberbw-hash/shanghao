import { useEffect } from "react";

import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  playGenericPressUnlessHandled,
  playUiSound,
  prepareUiSounds,
  setUiSoundOutputDevice,
  unlockUiSounds,
} from "../features/audio/uiSound";
import { RoomSoundFeedback } from "../features/audio/roomSoundFeedback";
import { prepareAnimalCalls } from "../features/audio/animalCall";

export const useUiFeedbackSounds = (): void => {
  const hasSettings = useSettingsStore((state) => Boolean(state.settings));
  const preferredOutputDeviceId = useSettingsStore(
    (state) => state.settings?.preferredOutputDeviceId,
  );

  useEffect(() => {
    void setUiSoundOutputDevice(preferredOutputDeviceId);
  }, [preferredOutputDeviceId]);

  useEffect(() => {
    const prepare = () => {
      void unlockUiSounds();
      prepareUiSounds();
      prepareAnimalCalls();
    };
    window.addEventListener("pointerdown", prepare, { once: true, passive: true });
    window.addEventListener("keydown", prepare, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prepare);
      window.removeEventListener("keydown", prepare);
    };
  }, []);

  useEffect(() => {
    let lastClickAt = 0;
    const pending = new Set<number>();
    const deferPress = () => {
      const now = Date.now();
      if (now - lastClickAt < 80) return;
      lastClickAt = now;
      const clickStartedAt = performance.now();
      // React or the committed-state observer can claim a semantic sound first.
      const timer = window.setTimeout(() => {
        pending.delete(timer);
        playGenericPressUnlessHandled(clickStartedAt);
      }, 0);
      pending.add(timer);
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (
        !(target instanceof HTMLButtonElement) ||
        target.disabled ||
        target.dataset.uiSound === "handled"
      )
        return;
      deferPress();
    };
    const handleChange = (event: Event) => {
      const target = event.target;
      const isControl =
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement &&
          ["checkbox", "radio", "range"].includes(target.type));
      if (!isControl || target.disabled || target.dataset.uiSound === "handled") return;
      deferPress();
    };
    document.addEventListener("click", handleClick, true);
    document.addEventListener("change", handleChange, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("change", handleChange, true);
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!hasSettings) return;
    const feedback = new RoomSoundFeedback(() => {
      const state = useRoomStore.getState();
      const audio = useAudioStore.getState();
      return {
        room: state.room,
        remoteScreenSharing: state.remoteScreenSharing,
        reconnectAttempt: state.connectionHealth.reconnectAttempt,
        isMuted: audio.isMuted,
        isDeafened: audio.isDeafened,
      };
    }, playUiSound);
    let queued = false;
    let disposed = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      // Coalesce mute + away, and snapshot + lifecycle changes in the same action.
      queueMicrotask(() => {
        queued = false;
        if (!disposed) feedback.update();
      });
    };
    feedback.update();
    const unsubscribeRoom = useRoomStore.subscribe((state, previous) => {
      if (
        state.room.members !== previous.room.members ||
        state.room.roomId !== previous.room.roomId ||
        state.room.signalingUrl !== previous.room.signalingUrl ||
        state.room.lifecycleState !== previous.room.lifecycleState ||
        state.room.connectionState !== previous.room.connectionState ||
        state.remoteScreenSharing !== previous.remoteScreenSharing ||
        state.connectionHealth.reconnectAttempt !== previous.connectionHealth.reconnectAttempt
      )
        schedule();
    });
    const unsubscribeAudio = useAudioStore.subscribe((state, previous) => {
      if (state.isMuted !== previous.isMuted || state.isDeafened !== previous.isDeafened)
        schedule();
    });
    return () => {
      disposed = true;
      unsubscribeRoom();
      unsubscribeAudio();
      feedback.dispose();
    };
  }, [hasSettings]);
};
