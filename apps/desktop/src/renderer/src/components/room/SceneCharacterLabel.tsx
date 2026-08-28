import { useRef } from "react";
import type { RoomMember } from "@private-voice/shared";

import { memberStatus } from "../../features/voice-scene/activityRules";

const getLatencyTone = (latencyMs?: number) => {
  if (typeof latencyMs !== "number") return "unknown";
  if (latencyMs < 80) return "good";
  if (latencyMs < 150) return "fair";
  if (latencyMs < 250) return "slow";
  return "poor";
};

export const SceneCharacterLabel = ({
  member,
  isAway,
}: {
  member: RoomMember;
  isAway: boolean;
}) => {
  const status = memberStatus(member);
  const isReconnecting = status.tone === "reconnecting";
  const lastLatencyRef = useRef<number | undefined>(undefined);
  if (typeof member.latencyMs === "number") {
    lastLatencyRef.current = Math.round(member.latencyMs / 5) * 5;
  }
  const displayedLatency = lastLatencyRef.current;
  const nicknameLength = Array.from(member.nickname.trim()).length;

  return (
    <div
      className={`room-character-label ${isAway ? "room-character-away-label is-away" : status.tone}`}
      title={isAway ? member.nickname : undefined}
    >
      {isAway ? (
        <span className="room-character-away-name">{member.nickname}</span>
      ) : (
        <>
          <span className="room-character-identity">
            {member.avatarUrl ? (
              <img className="room-character-account-avatar" src={member.avatarUrl} alt="" />
            ) : null}
            <strong
              className="room-character-nickname"
              data-length={nicknameLength > 12 ? "long" : nicknameLength > 8 ? "medium" : "short"}
              title={member.nickname}
            >
              {member.nickname}
            </strong>
            <span aria-hidden="true">·</span>
            <span className={`room-character-latency ${getLatencyTone(member.latencyMs)}`}>
              {typeof displayedLatency === "number" ? `${displayedLatency} ms` : "—"}
            </span>
          </span>
          <span className="room-character-state">
            <span
              className={`room-character-state-icon ${status.icon ? "has-icon" : ""}`}
              aria-hidden="true"
            >
              {status.icon ? (
                <status.icon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} />
              ) : null}
            </span>
            <span className="room-character-state-text" title={status.label}>
              {status.label}
            </span>
          </span>
        </>
      )}
    </div>
  );
};
