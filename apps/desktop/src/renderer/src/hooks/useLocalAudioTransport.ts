import { useEffect } from "react";

import { PushToTalkState } from "@private-voice/shared";

import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

const matchesShortcut = (event: KeyboardEvent, shortcut: string): boolean => {
  if (!shortcut) {
    return false;
  }

  const tokens = shortcut
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  const modifiers = {
    ctrl: tokens.includes("ctrl") || tokens.includes("control"),
    meta:
      tokens.includes("meta") ||
      tokens.includes("command") ||
      tokens.includes("cmd") ||
      tokens.includes("commandorcontrol"),
    shift: tokens.includes("shift"),
    alt: tokens.includes("alt") || tokens.includes("option"),
  };

  const nonModifierTokens = tokens.filter(
    (token) =>
      ![
        "ctrl",
        "control",
        "meta",
        "command",
        "cmd",
        "commandorcontrol",
        "shift",
        "alt",
        "option",
      ].includes(token),
  );

  if (modifiers.ctrl !== event.ctrlKey) {
    return false;
  }

  if (modifiers.meta !== event.metaKey) {
    return false;
  }

  if (modifiers.shift !== event.shiftKey) {
    return false;
  }

  if (modifiers.alt !== event.altKey) {
    return false;
  }

  if (nonModifierTokens.length === 0) {
    return modifiers.ctrl || modifiers.meta || modifiers.shift || modifiers.alt;
  }

  const pressedKey = event.key.toLowerCase();
  const pressedCode = event.code.toLowerCase();

  return nonModifierTokens.some(
    (token) => token === pressedKey || token === pressedCode.toLowerCase(),
  );
};

export const useLocalAudioTransport = (): void => {
  const localStream = useRoomStore((state) => state.localStream);
  const isMuted = useAudioStore((state) => state.isMuted);
  const isPushToTalkEnabled = useAudioStore((state) => state.isPushToTalkEnabled);
  const pushToTalkShortcut =
    useSettingsStore((state) => state.settings?.pushToTalkShortcut) || "Space";
  const setPushToTalkState = useAudioStore((state) => state.setPushToTalkState);

  useEffect(() => {
    const [track] = localStream?.getAudioTracks() ?? [];
    if (!track) {
      setPushToTalkState(PushToTalkState.Off);
      return;
    }

    if (!isPushToTalkEnabled) {
      track.enabled = !isMuted;
      setPushToTalkState(PushToTalkState.Off);
      return;
    }

    track.enabled = false;
    setPushToTalkState(PushToTalkState.Armed);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, pushToTalkShortcut)) {
        track.enabled = !isMuted;
        setPushToTalkState(PushToTalkState.Pressed);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (matchesShortcut(event, pushToTalkShortcut)) {
        track.enabled = false;
        setPushToTalkState(PushToTalkState.Armed);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isMuted, isPushToTalkEnabled, localStream, pushToTalkShortcut, setPushToTalkState]);
};
