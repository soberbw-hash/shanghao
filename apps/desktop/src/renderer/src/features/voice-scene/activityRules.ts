import {
  MemberPresenceState,
  MemberSpeakingState,
  type MemberActivity,
  type RoomMember,
} from "@private-voice/shared";
import {
  BarChart3,
  Clapperboard,
  Code2,
  DraftingCompass,
  FileText,
  Gamepad2,
  Headphones,
  MicOff,
  Palette,
  RotateCw,
  VolumeX,
  WifiOff,
} from "lucide-react";

export const activityLabels: Record<MemberActivity, string> = {
  idle: "等待中",
  gaming: "游戏中",
  drinking: "喝水中",
  fitness: "运动中",
  restroom: "离开",
};

export interface MemberStatus {
  label: string;
  tone:
    | "speaking"
    | "muted"
    | "deafened"
    | "reconnecting"
    | "offline"
    | "gaming"
    | "working"
    | "online";
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
  if (member.gameName) {
    return { label: `正在玩 ${member.gameName}`, tone: "gaming", icon: Gamepad2 };
  }
  if (member.workActivity) {
    const workStatus = {
      development: { verb: "开发", icon: Code2 },
      design: { verb: "设计", icon: Palette },
      media: { verb: "创作", icon: Clapperboard },
      engineering: { verb: "工作", icon: DraftingCompass },
      data: { verb: "分析", icon: BarChart3 },
      office: { verb: "办公", icon: FileText },
    }[member.workActivity.category];
    return {
      label: `${member.workActivity.name} ${workStatus.verb}中`,
      tone: "working",
      icon: workStatus.icon,
    };
  }
  return {
    label: activityLabels[member.activity ?? "idle"],
    tone: "online",
  };
};
