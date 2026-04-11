import { useEffect, useRef } from "react";

import { RoomConnectionState } from "@private-voice/shared";

import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

type ToneStep = {
  frequency: number;
  durationMs: number;
};

let sharedContext: AudioContext | null = null;

const getAudioContext = () => {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }

  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => undefined);
  }

  return sharedContext;
};

const playToneSequence = (sequence: ToneStep[]) => {
  try {
    const context = getAudioContext();
    let cursor = context.currentTime;

    for (const step of sequence) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = step.frequency;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.linearRampToValueAtTime(0.06, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        cursor + step.durationMs / 1000,
      );
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + step.durationMs / 1000);
      cursor += step.durationMs / 1000 + 0.03;
    }
  } catch {
    // Ignore sound failures; UI state remains the source of truth.
  }
};

export const useUiFeedbackSounds = (): void => {
  const settings = useSettingsStore((state) => state.settings);
  const isMuted = useAudioStore((state) => state.isMuted);
  const members = useRoomStore((state) => state.room.members);
  const connectionState = useRoomStore((state) => state.room.connectionState);

  const didInitRef = useRef(false);
  const previousMuteRef = useRef(isMuted);
  const previousConnectionRef = useRef(connectionState);
  const previousMemberIdsRef = useRef(
    members.filter((member) => !member.isEmptySlot).map((member) => member.id),
  );

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (!didInitRef.current) {
      didInitRef.current = true;
      previousMuteRef.current = isMuted;
      previousConnectionRef.current = connectionState;
      previousMemberIdsRef.current = members
        .filter((member) => !member.isEmptySlot)
        .map((member) => member.id);
      return;
    }

    if (isMuted !== previousMuteRef.current) {
      if (isMuted && settings.isMicOffSoundEnabled) {
        playToneSequence([{ frequency: 440, durationMs: 90 }]);
      }

      if (!isMuted && settings.isMicOnSoundEnabled) {
        playToneSequence([{ frequency: 660, durationMs: 90 }]);
      }

      previousMuteRef.current = isMuted;
    }
  }, [connectionState, isMuted, members, settings]);

  useEffect(() => {
    if (!settings || !didInitRef.current) {
      return;
    }

    const currentMemberIds = members
      .filter((member) => !member.isEmptySlot)
      .map((member) => member.id);
    const previousMemberIds = previousMemberIdsRef.current;

    if (currentMemberIds.length > previousMemberIds.length && settings.isMemberJoinSoundEnabled) {
      playToneSequence([
        { frequency: 523, durationMs: 70 },
        { frequency: 659, durationMs: 90 },
      ]);
    }

    if (currentMemberIds.length < previousMemberIds.length && settings.isMemberLeaveSoundEnabled) {
      playToneSequence([
        { frequency: 523, durationMs: 70 },
        { frequency: 392, durationMs: 100 },
      ]);
    }

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
      playToneSequence([
        { frequency: 659, durationMs: 60 },
        { frequency: 784, durationMs: 80 },
      ]);
    }

    if (
      connectionState === RoomConnectionState.Failed &&
      previousConnectionRef.current !== RoomConnectionState.Failed &&
      settings.isConnectionSoundEnabled
    ) {
      playToneSequence([
        { frequency: 440, durationMs: 80 },
        { frequency: 349, durationMs: 110 },
      ]);
    }

    previousConnectionRef.current = connectionState;
  }, [connectionState, settings]);
};
