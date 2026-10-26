import { Fragment, useEffect, useRef, useState } from "react";
import { LogOut, Utensils, DoorOpen, Undo2 } from "lucide-react";
import type { SceneReaction } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { useAppStore } from "../../store/appStore";
import { useAudioStore } from "../../store/audioStore";
import { PhoneModeButton } from "./PhoneModeButton";
import {
  availabilityLabels,
  encodeMemberAvailability,
  type MemberAvailability,
} from "../../features/room/memberAvailability";

const choices = [
  { id: "away", label: "离开", Icon: LogOut },
  { id: "eating", label: "吃饭", Icon: Utensils },
  { id: "restroom", label: "厕所", Icon: DoorOpen },
] as const;

export const MemberAvailabilityControls = ({
  canSend,
  send,
}: {
  canSend: boolean;
  send: (target: string, emoji: SceneReaction["emoji"]) => Promise<void>;
}) => {
  const roomId = useRoomStore((state) => state.room.roomId);
  const onPhone = useAudioStore((state) => state.phoneModeActive);
  const membership = useRoomStore((state) =>
    state.room.members
      .filter((member) => !member.isEmptySlot)
      .map((member) => member.id)
      .sort()
      .join("|"),
  );
  const [selection, setSelection] = useState<{ roomId: string; status?: MemberAvailability }>(
    () => ({
      roomId,
      status: useRoomStore.getState().room.members.find((member) => member.isLocal)
        ?.availabilityStatus,
    }),
  );
  const status = selection.roomId === roomId ? selection.status : undefined;
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const previousMute = useRef<boolean | undefined>(undefined);
  const lastPublication = useRef("");
  const sendRef = useRef(send);
  sendRef.current = send;
  const previousRoom = useRef(roomId);
  useEffect(() => {
    if (previousRoom.current !== roomId) {
      previousRoom.current = roomId;
      previousMute.current = undefined;
      setSelection({ roomId });
    }
  }, [roomId]);
  useEffect(() => {
    if (!canSend) {
      lastPublication.current = "";
      return;
    }
    if (previousRoom.current !== roomId) return;
    const next = status;
    const key = `${roomId}|${membership}|${next ?? "available"}`;
    if (lastPublication.current === key) return;
    lastPublication.current = key;
    // Republish when a peer joins/reconnects, so late joiners see persistent status.
    void sendRef.current(encodeMemberAvailability(next), "👍").catch(() => {
      if (lastPublication.current === key) lastPublication.current = "";
    });
  }, [canSend, membership, roomId, status]);
  const select = async (next?: MemberAvailability) => {
    if (sending.current || !canSend) return;
    sending.current = true;
    setBusy(true);
    setSelection({ roomId, status: next });
    const audio = useAudioStore.getState();
    if (next) {
      if (!status) previousMute.current = audio.isMuted;
      audio.setMuted(true);
    } else {
      // The audio store also preserves deafen/phone-mode privacy constraints.
      audio.setMuted(previousMute.current ?? true);
      previousMute.current = undefined;
    }
    const key = `${roomId}|${membership}|${next ?? "available"}`;
    lastPublication.current = key;
    try {
      await sendRef.current(encodeMemberAvailability(next), "👍");
    } catch {
      if (lastPublication.current === key) lastPublication.current = "";
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "状态暂未同步",
        description: "麦克风保持安全状态，请连接恢复后再试。",
      });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div
      className="member-availability-controls"
      aria-label="我的状态"
      data-status={onPhone ? "phone" : (status ?? "available")}
    >
      {choices.map(({ id, label, Icon }) => (
        <Fragment key={id}>
          <button
            type="button"
            disabled={!canSend || busy || onPhone}
            aria-pressed={!onPhone && status === id}
            title={`${availabilityLabels[id]} · 静音麦克风`}
            onClick={() => void select(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
          {id === "away" ? <PhoneModeButton canUse={canSend} /> : null}
        </Fragment>
      ))}
      <button
        type="button"
        disabled={!canSend || busy || !status || onPhone}
        onClick={() => void select()}
        title={status ? "清除状态" : "当前在线"}
      >
        <Undo2 aria-hidden="true" />
        回来
      </button>
    </div>
  );
};
