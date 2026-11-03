import { create } from "zustand";
import type { BackgroundAudioState } from "@private-voice/shared";
import { useEffect } from "react";
import { useRoomStore } from "../../store/roomStore";
import { useAudioStore } from "../../store/audioStore";
import { useSettingsStore } from "../../store/settingsStore";
import { backgroundAudioActivity } from "./backgroundAudioActivity";

export const useBackgroundAudioBalanceState = create<BackgroundAudioState>(() => ({
  available: false,
  enabled: false,
  shortcut: "",
  phase: "off",
  revision: 0,
}));

export function acceptBackgroundAudioState(state: BackgroundAudioState): void {
  const current = useBackgroundAudioBalanceState.getState();
  if (
    state.revision < current.revision ||
    (state.revision === current.revision &&
      state.available === current.available &&
      state.enabled === current.enabled &&
      state.shortcut === current.shortcut &&
      state.phase === current.phase)
  )
    return;
  useBackgroundAudioBalanceState.setState(state);
  const settings = useSettingsStore.getState().settings;
  if (
    settings &&
    (settings.isBackgroundAudioBalanceEnabled !== state.enabled ||
      settings.backgroundAudioBalanceShortcut !== state.shortcut)
  ) {
    useSettingsStore.setState({
      settings: {
        ...settings,
        isBackgroundAudioBalanceEnabled: state.enabled,
        backgroundAudioBalanceShortcut: state.shortcut,
      },
    });
  }
}

/** Runs at App scope, including while settings or a hidden window is open. No new audio capture. */
export function useBackgroundAudioBalance(): void {
  useEffect(() => {
    const api = window.desktopApi.backgroundAudio;
    if (!api) return;
    let mounted = true,
      pending = false,
      requested = false,
      attempted = false,
      lastAttempt = 0,
      observed = "";
    let queuedSpeech: { roomId?: string; until: number } | undefined;
    const pulse = async (force = false): Promise<void> => {
      if (!mounted || !useSettingsStore.getState().settings) return;
      const room = useRoomStore.getState().room,
        audio = useAudioStore.getState();
      const activity = backgroundAudioActivity(room, audio);
      if (pending) {
        requested = true;
        if (activity.speaking)
          queuedSpeech = { roomId: room.roomId, until: performance.now() + 850 };
        return;
      }
      const settings = useSettingsStore.getState().settings!;
      const current = useBackgroundAudioBalanceState.getState();
      // Default-off users need one capability check, not a permanent stream of idle IPC calls.
      if (
        !force &&
        attempted &&
        !settings.isBackgroundAudioBalanceEnabled &&
        !current.enabled &&
        (current.available || performance.now() - lastAttempt < 5000)
      )
        return;
      attempted = true;
      lastAttempt = performance.now();
      pending = true;
      activity.speaking ||=
        !!queuedSpeech &&
        queuedSpeech.roomId === room.roomId &&
        queuedSpeech.until > performance.now() &&
        activity.inRoom &&
        !audio.phoneModeActive &&
        !audio.isDeafened &&
        settings.isBackgroundAudioBalanceEnabled === true;
      queuedSpeech = undefined;
      try {
        const state = await api.pulse(activity);
        if (mounted) acceptBackgroundAudioState(state);
      } catch {
        if (mounted)
          useBackgroundAudioBalanceState.setState({ available: false, phase: "recovering" });
      } finally {
        pending = false;
        if (requested && mounted) {
          requested = false;
          void pulse(true);
        }
      }
    };
    const observe = () => {
      const room = useRoomStore.getState().room;
      const activity = backgroundAudioActivity(room, useAudioStore.getState());
      const enabled = useSettingsStore.getState().settings?.isBackgroundAudioBalanceEnabled;
      const signature = JSON.stringify([room.roomId, enabled, activity.inRoom, activity.speaking]);
      if (signature === observed) return;
      observed = signature;
      if (enabled || useBackgroundAudioBalanceState.getState().enabled) void pulse(true);
    };
    const subscriptions = [
      useRoomStore.subscribe(observe),
      useAudioStore.subscribe(observe),
      useSettingsStore.subscribe(observe),
    ];
    const unsubscribe = api.onChanged((state) => {
      if (mounted) acceptBackgroundAudioState(state);
    });
    void pulse();
    const timer = setInterval(() => {
      void pulse();
    }, 350);
    return () => {
      mounted = false;
      clearInterval(timer);
      unsubscribe();
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, []);
}
