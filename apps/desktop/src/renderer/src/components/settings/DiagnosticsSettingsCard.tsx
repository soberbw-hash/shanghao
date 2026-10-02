import { useCallback, useEffect, useState } from "react";

import type {
  AiRuntimeStatus,
  LocalAudioDiagnostics,
  PeerHealthDiagnostics,
  RealtimeFaultKind,
  RelayStatusSnapshot,
  RuntimeHealthSnapshot,
  ScreenSharePipelineDiagnostics,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import type { AudioRuntimeSnapshot } from "../../features/audio/audioRuntimeSnapshot";
import type { RemoteAudioMixerDiagnostics } from "../../features/audio/RemoteAudioMixer";
import {
  aggregateHealthLevel,
  microphoneHealth,
  roomAudioHealth,
  screenShareHealth,
  speakerHealth,
  type HealthLevel,
} from "../../features/diagnostics/healthProjection";
import { SettingsSection } from "./SettingsSection";
import {
  networkHealth,
  networkPermissionHealth,
} from "../../features/diagnostics/networkPermissionHealth";

const AiRuntimeDiagnosticsPanel = ({ onOpenAiSettings }: { onOpenAiSettings: () => void }) => {
  const [status, setStatus] = useState<AiRuntimeStatus>();
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.desktopApi.ai.getRuntimeStatus());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const asr = status?.asr;
  const task = status?.lastTask;
  const isBusy = asr?.runtimePhase === "running";
  const hasProblem = Boolean(
    loadError || (status && !asr?.ready && !isBusy) || asr?.runtimePhase === "error",
  );
  const statusLabel = loadError
    ? "检查失败"
    : !status
      ? "正在检查"
      : isBusy
        ? "正在检查"
        : hasProblem
          ? "需要处理"
          : "正常";

  return (
    <div className="rounded-[16px] border border-[#DCE8F5] bg-[#F7FAFE] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-[#344054]">AI 转录</div>
          <div className="mt-1 text-xs leading-5 text-[#667085]">
            {isBusy && task ? `正在处理“${task.fileName}”` : "负责录音转文字和语音记忆"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                hasProblem
                  ? "bg-[#FFF0F0] text-[#C45151]"
                  : !status
                    ? "bg-[#F1F5F9] text-[#64748B]"
                    : asr?.ready || isBusy
                      ? "bg-[#EAF7EF] text-[#2F8051]"
                      : "bg-[#FFF8E8] text-[#9A6A19]"
              }`}
            >
              {statusLabel}
            </span>
            {asr?.modelName ? (
              <span className="text-[11px] text-[#7A8CA5]">当前模型：{asr.modelName}</span>
            ) : null}
          </div>
          {hasProblem ? (
            <div className="mt-2 text-xs leading-5 text-[#C45151]">
              {loadError
                ? "状态读取失败，请重新检查。"
                : "运行组件尚未准备完成，请到 AI 设置检查模型和运行组件。"}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => void refresh()}>
            重新检查
          </Button>
          {hasProblem ? (
            <Button variant="secondary" onClick={onOpenAiSettings}>
              去 AI 设置
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const healthClass = (level: HealthLevel): string =>
  level === "正常"
    ? "bg-[#EAF7EF] text-[#2F8051]"
    : level === "有问题"
      ? "bg-[#FFF0F0] text-[#C45151]"
      : level === "需要看看"
        ? "bg-[#FFF8E8] text-[#9A6A19]"
        : "bg-[#F1F5F9] text-[#64748B]";

const isAttentionLevel = (level: HealthLevel): boolean =>
  level === "需要看看" || level === "有问题";

interface ShangHaoHealthOverviewProps {
  runtimeHealth?: RuntimeHealthSnapshot;
  relay?: RelayStatusSnapshot;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  audioRuntime?: AudioRuntimeSnapshot;
  mixer?: RemoteAudioMixerDiagnostics;
  peerHealth?: Record<string, PeerHealthDiagnostics>;
  roomActive: boolean;
  outputDeviceCount: number;
  remotePeerCount: number;
  webrtcReadyPeerCount: number;
  screenShare?: ScreenSharePipelineDiagnostics;
  windowsStatus?: WindowsIntegrationStatus;
  onRefresh: () => void;
  onOpenAudioSettings: () => void;
  onOpenHome: () => void;
  onOpenRoom: () => void;
  onRefreshWindows: () => void;
  onRepairFirewall: () => void;
  isRepairingFirewall: boolean;
  isRefreshingHealth: boolean;
  isRefreshingWindows: boolean;
  checkFeedback?: string;
}

const ShangHaoHealthOverview = ({
  runtimeHealth,
  relay,
  localAudioDiagnostics,
  audioRuntime,
  mixer,
  peerHealth,
  roomActive,
  outputDeviceCount,
  remotePeerCount,
  webrtcReadyPeerCount,
  screenShare,
  windowsStatus,
  onRefresh,
  onOpenAudioSettings,
  onOpenHome,
  onOpenRoom,
  onRefreshWindows,
  onRepairFirewall,
  isRepairingFirewall,
  isRefreshingHealth,
  isRefreshingWindows,
  checkFeedback,
}: ShangHaoHealthOverviewProps) => {
  const relayLevel: HealthLevel = relay ? (relay.isReachable ? "正常" : "有问题") : "未检测";
  const roomFinding = roomAudioHealth({ remotePeerCount, webrtcReadyPeerCount, peerHealth });
  const micFinding = microphoneHealth(audioRuntime, localAudioDiagnostics);
  const outputFinding = speakerHealth({ outputDeviceCount, roomActive, remotePeerCount, mixer });
  const networkFinding = networkHealth(relay);
  const screenFinding = screenShareHealth(screenShare);
  const windowsFinding = networkPermissionHealth(windowsStatus?.firewall);
  const items: Array<{
    label: string;
    level: HealthLevel;
    description: string;
    actionLabel?: string;
    onClick?: () => void;
    badge?: string;
  }> = [
    {
      label: "麦克风",
      level: micFinding.level,
      description: micFinding.description,
      actionLabel: "去语音设置",
      onClick: onOpenAudioSettings,
    },
    {
      label: "扬声器",
      level: outputFinding.level,
      description: outputFinding.description,
      actionLabel: "去语音设置",
      onClick: onOpenAudioSettings,
    },
    {
      label: "房间连接",
      level: roomFinding.level,
      description: roomFinding.description,
      actionLabel: "回到房间",
      onClick: onOpenRoom,
    },
    {
      label: "服务器连接",
      level: relayLevel,
      description:
        relayLevel === "未检测"
          ? "尚未检查服务器连接。"
          : relayLevel === "有问题"
            ? "暂时连不上服务器，请检查网络或服务器设置。"
            : "房间服务连接正常。",
      actionLabel: "回到房间",
      onClick: onOpenHome,
    },
    {
      label: "网络速度",
      ...networkFinding,
      badge: networkFinding.level === "需要看看" ? "延迟偏高" : undefined,
    },
    {
      label: "屏幕分享",
      level: screenFinding.level,
      description: screenFinding.description,
      actionLabel: "回到房间",
      onClick: onOpenRoom,
    },
    {
      label: "Windows 网络权限",
      ...windowsFinding,
      actionLabel: windowsFinding.retry ? "重试修复" : undefined,
      onClick: windowsFinding.retry ? onRepairFirewall : undefined,
    },
  ];
  const attentionCount = items.filter(({ level }) => isAttentionLevel(level)).length;
  const normalCount = items.filter(({ level }) => level === "正常").length;
  const uncheckedCount = items.filter(({ level }) => level === "未检测").length;
  const overallLevel = aggregateHealthLevel(items.map(({ level }) => level));

  return (
    <div className="rounded-[16px] border border-[#DCE8F5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-[#344054]">系统状态 · 连接与设备</div>
          <div className="mt-1 text-xs leading-5 text-[#667085]">
            {normalCount} 项正常 · {attentionCount} 项提醒 · {uncheckedCount} 项待确认
          </div>
          <div className="mt-1 text-[11px] leading-5 text-[#7A8CA5]">
            {runtimeHealth
              ? "连接异常会自动尝试恢复，缺失的网络规则会自动修复；系统授权仍需你确认。"
              : "正在读取运行状态。"}
          </div>
          {checkFeedback ? (
            <div className="mt-1 text-[11px] leading-5 text-[#52657D]" role="status">
              {checkFeedback}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${healthClass(overallLevel)}`}
          >
            整体：
            {overallLevel === "需要看看" || overallLevel === "有问题" ? "有提醒" : overallLevel}
          </span>
          <Button
            variant="ghost"
            disabled={isRefreshingHealth || isRefreshingWindows}
            onClick={onRefresh}
          >
            {isRefreshingHealth ? "检查中…" : "重新检查"}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid items-start gap-2 sm:grid-cols-2">
        {items.map(({ label, level, description, actionLabel, onClick, badge }) => (
          <div key={label} className="rounded-xl border border-[#EDF2F7] bg-[#FAFCFF] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#52657D]">{label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthClass(level)}`}
              >
                {badge ?? (level === "有问题" || level === "需要看看" ? "需要处理" : level)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div className="min-w-0 text-[11px] leading-5 text-[#7A8CA5]">{description}</div>
              {actionLabel && onClick && isAttentionLevel(level) ? (
                <Button
                  variant="ghost"
                  className="h-6 shrink-0 rounded-md px-2 text-[11px]"
                  onClick={onClick}
                  disabled={isRepairingFirewall}
                >
                  {label === "Windows 网络权限" && isRepairingFirewall ? "修复中…" : actionLabel}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {windowsStatus ? (
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            className="px-0 text-[11px]"
            disabled={isRefreshingHealth || isRefreshingWindows}
            onClick={onRefreshWindows}
          >
            {isRefreshingWindows ? "正在检查系统权限…" : "重新检查系统权限"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export const DiagnosticsSettingsCard = ({
  runtimeHealth,
  relay,
  localAudioDiagnostics,
  audioRuntime,
  mixer,
  peerHealth,
  roomActive,
  outputDeviceCount,
  webrtcReadyPeerCount,
  remotePeerCount,
  screenShare,
  windowsStatus,
  onOpenLogs,
  onExportBundle,
  onCopySummary,
  onRefreshHealth,
  onOpenAudioSettings,
  onOpenAiSettings,
  onOpenHome,
  onOpenRoom,
  onRefreshWindows,
  onRepairFirewall,
  isRepairingFirewall,
  isRefreshingHealth,
  isRefreshingWindows,
  checkFeedback,
  onInjectFault,
}: {
  runtimeHealth?: RuntimeHealthSnapshot;
  relay?: RelayStatusSnapshot;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  audioRuntime?: AudioRuntimeSnapshot;
  mixer?: RemoteAudioMixerDiagnostics;
  peerHealth?: Record<string, PeerHealthDiagnostics>;
  roomActive: boolean;
  outputDeviceCount: number;
  webrtcReadyPeerCount: number;
  remotePeerCount: number;
  screenShare?: ScreenSharePipelineDiagnostics;
  windowsStatus?: WindowsIntegrationStatus;
  onOpenLogs: () => void;
  onExportBundle: () => void;
  onCopySummary: () => void;
  onRefreshHealth: () => void;
  onOpenAudioSettings: () => void;
  onOpenAiSettings: () => void;
  onOpenHome: () => void;
  onOpenRoom: () => void;
  onRefreshWindows: () => void;
  onRepairFirewall: () => void;
  isRepairingFirewall: boolean;
  isRefreshingHealth: boolean;
  isRefreshingWindows: boolean;
  checkFeedback?: string;
  onInjectFault: (kind: RealtimeFaultKind) => void;
}) => (
  <SettingsSection
    title="检查与修复"
    description="上号会在后台检查并自动尝试修复。这里查看进度、系统授权提醒，或导出技术报告。"
  >
    <div className="diagnostics-user-view space-y-3">
      <ShangHaoHealthOverview
        runtimeHealth={runtimeHealth}
        relay={relay}
        localAudioDiagnostics={localAudioDiagnostics}
        audioRuntime={audioRuntime}
        mixer={mixer}
        peerHealth={peerHealth}
        roomActive={roomActive}
        outputDeviceCount={outputDeviceCount}
        remotePeerCount={remotePeerCount}
        webrtcReadyPeerCount={webrtcReadyPeerCount}
        screenShare={screenShare}
        windowsStatus={windowsStatus}
        onRefresh={onRefreshHealth}
        onOpenAudioSettings={onOpenAudioSettings}
        onOpenHome={onOpenHome}
        onOpenRoom={onOpenRoom}
        onRefreshWindows={onRefreshWindows}
        onRepairFirewall={onRepairFirewall}
        isRepairingFirewall={isRepairingFirewall}
        isRefreshingHealth={isRefreshingHealth}
        isRefreshingWindows={isRefreshingWindows}
        checkFeedback={checkFeedback}
      />
      <AiRuntimeDiagnosticsPanel onOpenAiSettings={onOpenAiSettings} />
      <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
        <div className="text-[13px] font-semibold text-[#344054]">需要帮忙时</div>
        <div className="mt-1 text-xs leading-5 text-[#667085]">
          导出诊断包会包含后台保存的详细技术信息，方便开发者定位问题；这里不会把这些术语直接堆给你看。
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onOpenLogs}>
            打开诊断文件夹
          </Button>
          <Button variant="secondary" onClick={onExportBundle}>
            导出完整诊断包
          </Button>
          <Button variant="ghost" onClick={onCopySummary}>
            复制易读摘要
          </Button>
        </div>
      </div>
      {import.meta.env.DEV ? (
        <details className="rounded-[16px] border border-dashed border-[#E4B968] bg-[#FFF9EC] p-4">
          <summary className="cursor-pointer select-none text-[13px] font-semibold text-[#6F5422]">
            开发测试入口
          </summary>
          <div className="mt-1 text-[11px] leading-5 text-[#93713A]">
            仅开发环境可见，用于验证断线、旧连接事件、重复关闭、快照超时、单好友音频恢复和屏幕轨丢失。
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ["断开信令", "signal_disconnect"],
                ["旧 Socket Close", "stale_socket_close"],
                ["重复 Close", "duplicate_socket_close"],
                ["快照超时", "snapshot_timeout"],
                ["单好友音频停滞", "one_peer_audio_stall"],
                ["屏幕轨丢失", "screen_track_lost"],
              ] satisfies Array<[string, RealtimeFaultKind]>
            ).map(([label, kind]) => (
              <Button key={kind} variant="ghost" onClick={() => onInjectFault(kind)}>
                {label}
              </Button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  </SettingsSection>
);
