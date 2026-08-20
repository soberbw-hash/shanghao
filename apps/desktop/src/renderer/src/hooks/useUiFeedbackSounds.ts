import { useEffect, useRef } from "react";

import { RoomConnectionState } from "@private-voice/shared";

import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import {
  playUiSound,
  prepareUiSounds,
  setUiSoundEnabled,
  setUiSoundVolume,
} from "../features/audio/uiSound";
import { prepareAnimalCalls } from "../features/audio/animalCall";

let lastClickAt = 0;

export const useUiFeedbackSounds = (): void => {
  const settings = useSettingsStore((state) => state.settings);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const members = useRoomStore((state) => state.room.members);
  const connectionState = useRoomStore((state) => state.room.connectionState);
  const reconnectAttempt = useRoomStore((state) => state.connectionHealth.reconnectAttempt);

  const didInitRef = useRef(false);
  const previousMuteRef = useRef(isMuted);
  const previousDeafenRef = useRef(isDeafened);
  const reconnectEpisodeActiveRef = useRef(false);
  const reconnectStableTimerRef = useRef<number | undefined>(undefined);
  const reconnectFailurePlayedRef = useRef(false);
  const previousMemberIdsRef = useRef(
    members.filter((member) => !member.isEmptySlot && !member.isLocal).map((member) => member.id),
  );

  useEffect(() => {
    setUiSoundEnabled(settings?.isUiSoundEnabled !== false);
    setUiSoundVolume(settings?.soundVolume ?? 0.72);
  }, [settings?.isUiSoundEnabled, settings?.soundVolume]);

  useEffect(() => {
    const prepare = () => {
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
    if (!settings?.isUiSoundEnabled) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) {
        return;
      }
      if (target.dataset.uiSound === "handled") {
        return;
      }
      const now = Date.now();
      if (now - lastClickAt < 80) {
        return;
      }
      lastClickAt = now;
      playUiSound("button-click");
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [settings?.isUiSoundEnabled]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (!didInitRef.current) {
      didInitRef.current = true;
      previousMuteRef.current = isMuted;
      previousDeafenRef.current = isDeafened;
      previousMemberIdsRef.current = members
        .filter((member) => !member.isEmptySlot && !member.isLocal)
        .map((member) => member.id);
      return;
    }

    if (isMuted !== previousMuteRef.current) {
      playUiSound(isMuted ? "mic-off" : "mic-on");

      previousMuteRef.current = isMuted;
    }

    if (isDeafened !== previousDeafenRef.current) {
      playUiSound(isDeafened ? "speaker-muted" : "speaker-unmuted");
      previousDeafenRef.current = isDeafened;
    }
  }, [connectionState, isDeafened, isMuted, members, settings]);

  useEffect(() => {
    if (!settings || !didInitRef.current) return;
    const isSignalingOutage =
      connectionState === RoomConnectionState.Reconnecting || reconnectAttempt > 0;
    const isStable =
      connectionState === RoomConnectionState.Connected ||
      connectionState === RoomConnectionState.WaitingPeer;

    if (isSignalingOutage) {
      reconnectEpisodeActiveRef.current = true;
      reconnectFailurePlayedRef.current = false;
      if (reconnectStableTimerRef.current !== undefined) {
        window.clearTimeout(reconnectStableTimerRef.current);
        reconnectStableTimerRef.current = undefined;
      }
      return;
    }

    if (connectionState === RoomConnectionState.Failed) {
      if (!reconnectFailurePlayedRef.current) {
        playUiSound("connection-failed");
        reconnectFailurePlayedRef.current = true;
      }
      reconnectEpisodeActiveRef.current = false;
      return;
    }

    if (
      reconnectEpisodeActiveRef.current &&
      isStable &&
      reconnectStableTimerRef.current === undefined
    ) {
      reconnectStableTimerRef.current = window.setTimeout(() => {
        reconnectStableTimerRef.current = undefined;
        const current = useRoomStore.getState().room;
        const remainsStable =
          current.connectionState === RoomConnectionState.Connected ||
          current.connectionState === RoomConnectionState.WaitingPeer;
        if (!reconnectEpisodeActiveRef.current || !remainsStable) return;
        reconnectEpisodeActiveRef.current = false;
        reconnectFailurePlayedRef.current = false;
        previousMemberIdsRef.current = current.members
          .filter((member) => !member.isEmptySlot && !member.isLocal)
          .map((member) => member.id);
        playUiSound("connection-restored");
      }, 3_000);
    }
  }, [connectionState, reconnectAttempt, settings]);

  useEffect(
    () => () => {
      if (reconnectStableTimerRef.current !== undefined) {
        window.clearTimeout(reconnectStableTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!settings || !didInitRef.current) {
      return;
    }
    const isStableConnection =
      connectionState === RoomConnectionState.Connected ||
      connectionState === RoomConnectionState.WaitingPeer;
    if (
      !isStableConnection ||
      reconnectEpisodeActiveRef.current ||
      reconnectStableTimerRef.current !== undefined
    )
      return;

    const currentMemberIds = members
      .filter((member) => !member.isEmptySlot && !member.isLocal)
      .map((member) => member.id);
    const previousMemberIds = previousMemberIdsRef.current;
    const currentSet = new Set(currentMemberIds);
    const previousSet = new Set(previousMemberIds);
    const joined = currentMemberIds.filter((id) => !previousSet.has(id));
    const left = previousMemberIds.filter((id) => !currentSet.has(id));

    if (joined.length) playUiSound("member-join");
    if (left.length) playUiSound("member-leave");

    previousMemberIdsRef.current = currentMemberIds;
  }, [connectionState, members, settings]);
};
