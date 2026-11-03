import { Fragment } from "react";
import { LogOut, Utensils, DoorOpen } from "lucide-react";
import type { SceneReaction } from "@private-voice/shared";
import { PhoneModeButton } from "./PhoneModeButton";
import { availabilityLabels } from "../../features/room/memberAvailability";
import { useMemberAvailabilityControls } from "../../features/room/useMemberAvailabilityControls";

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
  const { status, onPhone, choose } = useMemberAvailabilityControls(canSend, send);
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
            data-ui-sound="handled"
            aria-pressed={!onPhone && status === id}
            title={
              !onPhone && status === id
                ? "再次点击退出状态"
                : `${availabilityLabels[id]} · ${id === "away" ? "关闭麦克风和扬声器" : "关闭麦克风"}`
            }
            onClick={() => choose(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
          {id === "away" ? <PhoneModeButton canUse onToggle={() => choose("phone")} /> : null}
        </Fragment>
      ))}
    </div>
  );
};
