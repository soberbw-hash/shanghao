import type {
  LocalAudioDiagnostics,
  PeerHealthDiagnostics,
  ScreenSharePipelineDiagnostics,
} from "@private-voice/shared";

import type { AudioRuntimeSnapshot } from "../audio/audioRuntimeSnapshot";
import type { RemoteAudioMixerDiagnostics } from "../audio/RemoteAudioMixer";

export type HealthLevel = "正常" | "未检测" | "需要看看" | "有问题";

export interface HealthFinding {
  level: HealthLevel;
  description: string;
}

export const aggregateHealthLevel = (levels: readonly HealthLevel[]): HealthLevel => {
  if (levels.includes("有问题")) return "有问题";
  if (levels.includes("需要看看")) return "需要看看";
  if (!levels.length || levels.includes("未检测")) return "未检测";
  return "正常";
};

/** Health labels describe observed runtime state, never prove a person heard audio. */
export const microphoneHealth = (
  audio?: AudioRuntimeSnapshot,
  diagnostics?: LocalAudioDiagnostics,
): HealthFinding => {
  if (!audio || audio.health === "idle" || !audio.observed.processorPresent) {
    return { level: "未检测", description: "进入房间后检查麦克风输入。" };
  }
  if (audio.observed.outputTrackState !== "live") {
    return { level: "有问题", description: "麦克风输入 Track 未正常运行。" };
  }
  if (
    (audio.desired.noiseSuppression && audio.applied.noiseProcessor === "deepfilter_unavailable") ||
    (audio.desired.voiceEnhancement &&
      audio.applied.voiceEnhancementProcessor === "dsp_unavailable")
  ) {
    return { level: "需要看看", description: "麦克风已降级运行，请检查降噪或设备路由。" };
  }
  if (diagnostics?.inputOverload === "warning") {
    return { level: "需要看看", description: "输入音量偏高，建议检查。" };
  }
  return { level: "正常", description: "麦克风 Track 与处理链运行中；远端听感待确认。" };
};

export const speakerHealth = ({
  outputDeviceCount,
  roomActive,
  remotePeerCount,
  mixer,
}: {
  outputDeviceCount: number;
  roomActive: boolean;
  remotePeerCount: number;
  mixer?: RemoteAudioMixerDiagnostics;
}): HealthFinding => {
  if (outputDeviceCount === 0) {
    return { level: "有问题", description: "没有检测到可用的输出设备。" };
  }
  if (!roomActive || !mixer || mixer.contextState === "not_started") {
    return { level: "未检测", description: "输出设备存在；进入房间后检查播放链路。" };
  }
  if (mixer.outputRouteStatus === "failed") {
    return { level: "有问题", description: "扬声器路由应用失败。" };
  }
  if (mixer.outputRouteStatus === "fallback" || mixer.outputRouteStatus === "unsupported") {
    return { level: "需要看看", description: "当前输出设备未按设置生效，已使用系统回退。" };
  }
  if (mixer.contextState !== "running" || mixer.outputRouteStatus !== "applied") {
    return { level: "未检测", description: "播放链路仍在启动或等待解锁。" };
  }
  if (remotePeerCount === 0) {
    return { level: "未检测", description: "播放链路已就绪，尚无远端声音可检查。" };
  }
  return { level: "正常", description: "混音器与输出路由运行中；实际听感请用耳机确认。" };
};

export const roomAudioHealth = ({
  remotePeerCount,
  webrtcReadyPeerCount,
  peerHealth,
}: {
  remotePeerCount: number;
  webrtcReadyPeerCount: number;
  peerHealth?: Record<string, PeerHealthDiagnostics>;
}): HealthFinding => {
  if (remotePeerCount === 0) {
    return { level: "未检测", description: "有好友进入房间后检查音频链路。" };
  }
  if (webrtcReadyPeerCount < remotePeerCount) {
    return { level: "需要看看", description: "有好友尚未建立稳定的语音连接。" };
  }
  const peers = Object.values(peerHealth ?? {});
  if (peers.some((peer) => peer.level === "critical" || peer.audioFlow === "stalled")) {
    return { level: "有问题", description: "检测到好友音频停滞或连接异常。" };
  }
  if (peers.some((peer) => peer.level === "degraded")) {
    return { level: "需要看看", description: "有好友的音频链路质量下降。" };
  }
  if (peers.length < remotePeerCount || peers.some((peer) => peer.audioFlow === "warming")) {
    return { level: "未检测", description: "连接已建立，正在观察远端音频。" };
  }
  if (peers.some((peer) => peer.audioFlow === "muted")) {
    return { level: "未检测", description: "有好友已静音，暂无法确认其音频流。" };
  }
  if (peers.some((peer) => peer.audioFlow !== "flowing")) {
    return { level: "未检测", description: "尚未取得完整的远端音频流观测。" };
  }
  return { level: "正常", description: "远端音频链路有运行迹象；听感仍需双方确认。" };
};

export const screenShareHealth = (screenShare?: ScreenSharePipelineDiagnostics): HealthFinding => {
  if (!screenShare) {
    return { level: "未检测", description: "开始屏幕分享后检查。" };
  }
  if (screenShare.fallback.overdue) {
    return { level: "需要看看", description: "屏幕分享可能暂时卡住，请回到房间检查。" };
  }
  const hasActivePipeline =
    Boolean(screenShare.capture) ||
    Object.keys(screenShare.send).length > 0 ||
    Object.keys(screenShare.receive).length > 0 ||
    Object.keys(screenShare.present).length > 0;
  if (!hasActivePipeline) {
    return { level: "未检测", description: "尚无屏幕分享画面可检查。" };
  }
  return { level: "正常", description: "屏幕分享链路有运行迹象；画面仍需对方确认。" };
};
