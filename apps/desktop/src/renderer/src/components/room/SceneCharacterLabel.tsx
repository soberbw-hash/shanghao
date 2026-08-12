import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RoomMember } from "@private-voice/shared";

import { motionCurve, motionDuration } from "../../features/motion/motionSystem";
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
  shouldReduceMotion,
}: {
  member: RoomMember;
  isAway: boolean;
  shouldReduceMotion: boolean;
}) => {
  const status = memberStatus(member);
  const isReconnecting = status.tone === "reconnecting";
  const lastLatencyRef = useRef<number>();
  if (typeof member.latencyMs === "number") {
    lastLatencyRef.current = Math.round(member.latencyMs / 5) * 5;
  }
  const displayedLatency = lastLatencyRef.current;

  if (isAway) {
    return (
      <div className="room-character-away-label" title={member.nickname}>
        <span>{member.nickname}</span>
      </div>
    );
  }

  return (
    <div className={`room-character-label ${status.tone}`}>
      <span className="room-character-identity">
        <strong className="room-character-nickname" title={member.nickname}>
          {member.nickname}
        </strong>
        <span aria-hidden="true">·</span>
        <span className={`room-character-latency ${getLatencyTone(member.latencyMs)}`}>
          {typeof displayedLatency === "number" ? `${displayedLatency} ms` : "—"}
        </span>
      </span>
      <span className="room-character-state">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={`${status.tone}-${status.label}`}
            className="inline-flex min-w-0 items-center gap-1"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -2 }}
            transition={{
              duration: shouldReduceMotion ? 0 : motionDuration.color,
              ease: motionCurve.enter,
            }}
          >
            {status.icon ? (
              <status.icon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} />
            ) : null}
            <span className="max-w-[118px] truncate">{status.label}</span>
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
};
