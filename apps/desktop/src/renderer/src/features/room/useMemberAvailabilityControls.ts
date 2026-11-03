import { useEffect, useRef, useState } from "react";
import { PushToTalkState, type SceneReaction } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { useAudioStore } from "../../store/audioStore";
import { useAppStore } from "../../store/appStore";
import { desktopApi } from "../../utils/desktopApi";
import { holdAudioSend, setAudioSendEnabled } from "../audio/audioSendGate";
import { beginAvailabilitySoundTransition } from "../audio/availabilitySoundTransition";
import { playUiSound } from "../audio/uiSound";
import { encodeMemberAvailability, type MemberAvailability } from "./memberAvailability";
import {
  MemberAvailabilityController,
  type AvailabilityChoice,
} from "./memberAvailabilityController";

export function useMemberAvailabilityControls(
  canSend: boolean,
  send: (target: string, emoji: SceneReaction["emoji"]) => Promise<void>,
) {
  const roomId = useRoomStore((state) => state.room.roomId);
  const membership = useRoomStore((state) =>
    state.room.members
      .filter((member) => !member.isEmptySlot)
      .map((member) => member.id)
      .sort()
      .join("|"),
  );
  const onPhone = useAudioStore((state) => state.phoneModeActive);
  const [selection, setSelection] = useState<{ roomId: string; status?: MemberAvailability }>(
    () => ({
      roomId,
      status: useRoomStore.getState().room.members.find((member) => member.isLocal)
        ?.availabilityStatus,
    }),
  );
  const selected = useRef(selection);
  const publication = useRef("");
  const controller = useRef<MemberAvailabilityController | undefined>(undefined);
  const current = useRef({ canSend, send, membership });
  current.current = { canSend, send, membership };
  const status = selection.roomId === roomId ? selection.status : undefined;

  useEffect(() => {
    let active = true;
    const ownsRoom = () => active && useRoomStore.getState().room.roomId === roomId;
    if (selected.current.roomId !== roomId) {
      selected.current = { roomId };
      setSelection(selected.current);
    }
    const next = new MemberAvailabilityController({
      audio: () => useAudioStore.getState(),
      status: () => selected.current.status,
      ownsRoom,
      phone: async (enabled) => {
        if (!desktopApi.phoneMode) throw Error("phone_unavailable");
        await desktopApi.phoneMode.set(enabled);
        if (!ownsRoom()) return;
        if (useAudioStore.getState().phoneModeActive !== enabled) {
          const confirmed = await desktopApi.phoneMode.get();
          if (!ownsRoom()) return;
          if (confirmed.busy || confirmed.error || confirmed.active !== enabled)
            throw Error("phone_unconfirmed");
          useAudioStore.getState().setPhoneMode(confirmed.active);
        }
      },
      select: (nextStatus) => {
        selected.current = { roomId, status: nextStatus };
        setSelection(selected.current);
        window.dispatchEvent(new Event("shanghao:availability-audio-feedback"));
        // Phone entry is sounded before Windows mutes outputs by usePhoneModeSync.
        if (!useAudioStore.getState().phoneModeActive)
          playUiSound(nextStatus ? "phone-mode-enter" : "phone-mode-exit");
      },
      hold: () => {
        const endSound = beginAvailabilitySoundTransition();
        const releaseAudio = holdAudioSend(
          useRoomStore.getState().localStream?.getAudioTracks()[0],
        );
        return () => {
          releaseAudio();
          endSound();
        };
      },
      reconcile: () => {
        const audio = useAudioStore.getState();
        const track = useRoomStore.getState().localStream?.getAudioTracks()[0];
        if (track)
          setAudioSendEnabled(
            track,
            !audio.isMuted &&
              !audio.isDeafened &&
              !audio.phoneModeActive &&
              !audio.listenOnly &&
              (!audio.isPushToTalkEnabled || audio.pushToTalkState === PushToTalkState.Pressed),
          );
      },
      failed: () =>
        useAppStore.getState().pushToast({
          tone: "warning",
          title: "状态未能切换",
          description: "麦克风保持静音，请稍后重试。",
        }),
    });
    controller.current = next;
    return () => {
      active = false;
      next.dispose();
      if (controller.current === next) controller.current = undefined;
    };
  }, [roomId]);

  useEffect(() => {
    if (!canSend) {
      publication.current = "";
      return;
    }
    const key = `${roomId}|${membership}|${status ?? "available"}`;
    if (publication.current === key) return;
    publication.current = key;
    // Publish independently: slow room delivery must not lock the local status buttons.
    void current.current.send(encodeMemberAvailability(status), "👍").catch(() => {
      if (useRoomStore.getState().room.roomId !== roomId || publication.current !== key) return;
      publication.current = "";
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "状态暂未同步",
        description: "本机状态已保留，连接恢复后重新同步。",
      });
    });
  }, [canSend, membership, roomId, status]);
  return {
    status,
    onPhone,
    choose: (choice: AvailabilityChoice) => {
      controller.current?.choose(choice);
    },
  };
}
