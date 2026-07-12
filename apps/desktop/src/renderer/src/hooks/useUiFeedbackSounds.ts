import { useEffect, useRef } from "react";

import { RoomConnectionState } from "@private-voice/shared";

import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { playUiSound, setUiSoundEnabled, setUiSoundVolume } from "../features/audio/uiSound";

let lastClickAt = 0;

export const useUiFeedbackSounds = (): void => {
  const settings = useSettingsStore((state) => state.settings);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const members = useRoomStore((state) => state.room.members);
  const connectionState = useRoomStore((state) => state.room.connectionState);

  const didInitRef = useRef(false);
  const previousMuteRef = useRef(isMuted);
  const previousDeafenRef = useRef(isDeafened);
  const previousConnectionRef = useRef(connectionState);
  const previousMemberIdsRef = useRef(
    members.filter((member) => !member.isEmptySlot && !member.isLocal).map((member) => member.id),
  );

  useEffect(() => {
    setUiSoundEnabled(settings?.isUiSoundEnabled !== false);
    setUiSoundVolume(settings?.soundVolume ?? 0.72);
  }, [settings?.isUiSoundEnabled, settings?.soundVolume]);

  useEffect(() => {
    if (!settings?.isUiSoundEnabled) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) {
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
      previousConnectionRef.current = connectionState;
      previousMemberIdsRef.current = members
        .filter((member) => !member.isEmptySlot && !member.isLocal)
        .map((member) => member.id);
      return;
    }

    if (isMuted !== previousMuteRef.current) {
      if (isMuted && settings.isMicOffSoundEnabled) {
        playUiSound("mic-off");
      }

      if (!isMuted && settings.isMicOnSoundEnabled) {
        playUiSound("mic-on");
      }

      previousMuteRef.current = isMuted;
    }

    if (isDeafened !== previousDeafenRef.current) {
      playUiSound(isDeafened ? "speaker-muted" : "speaker-unmuted");
      previousDeafenRef.current = isDeafened;
    }
  }, [connectionState, isDeafened, isMuted, members, settings]);

  useEffect(() => {
    if (!settings || !didInitRef.current) {
      return;
    }

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
  }, [members, settings]);

  useEffect(() => {
    if (!settings || !didInitRef.current) {
      return;
    }

    if (
      connectionState === RoomConnectionState.Connected &&
      previousConnectionRef.current !== RoomConnectionState.Connected &&
      settings.isConnectionSoundEnabled
    ) {
      playUiSound("connection-restored");
    }

    if (
      connectionState === RoomConnectionState.Failed &&
      previousConnectionRef.current !== RoomConnectionState.Failed &&
      settings.isConnectionSoundEnabled
    ) {
      playUiSound("connection-failed");
    }

    previousConnectionRef.current = connectionState;
  }, [connectionState, settings]);
};
