import {
  MemberPresenceState,
  MemberSpeakingState,
  type MemberActivity,
  type RoomMember,
} from "@private-voice/shared";
import { Headphones, MicOff, RotateCw, VolumeX, WifiOff } from "lucide-react";

export const activityLabels: Record<MemberActivity, string> = {
  idle: "等待中",
  gaming: "游戏中",
  drinking: "喝水中",
  fitness: "运动中",
  restroom: "离开一下",
};

export interface MemberStatus {
  label: string;
  tone: "speaking" | "muted" | "deafened" | "reconnecting" | "offline" | "online";
  icon?: typeof Headphones;
}

export const memberStatus = (member: RoomMember): MemberStatus => {
  if (member.presenceState === MemberPresenceState.Reconnecting) {
    return { label: "正在回来", tone: "reconnecting", icon: RotateCw };
  }
  if (member.presenceState === MemberPresenceState.Offline) {
    return { label: "暂时离开", tone: "offline", icon: WifiOff };
  }
  if (member.isDeafened) {
    return { label: "已关闭扬声器", tone: "deafened", icon: VolumeX };
  }
  if (member.isMuted) {
    return { label: "静音中", tone: "muted", icon: MicOff };
  }
  if (member.speakingState === MemberSpeakingState.Speaking) {
    return { label: "正在说话", tone: "speaking", icon: Headphones };
  }
  return {
    label: member.gameName || activityLabels[member.activity ?? "idle"],
    tone: "online",
  };
};
