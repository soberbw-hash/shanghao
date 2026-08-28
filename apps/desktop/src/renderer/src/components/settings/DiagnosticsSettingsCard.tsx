import { useCallback, useEffect, useState } from "react";

import type {
  AiRuntimeStatus,
  LocalAudioDiagnostics,
  RealtimeFaultKind,
  RelayStatusSnapshot,
  RuntimeHealthSnapshot,
  ScreenSharePipelineDiagnostics,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";

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
    loadError || asr?.runtimePhase === "error" || (task && task.status === "failed"),
  );
  const statusLabel = loadError
    ? "暂时无法读取状态"
    : !status
      ? "正在检查"
      : isBusy
        ? "正在处理"
        : asr?.ready
          ? "可以使用"
          : asr?.runtimePhase === "missing"
            ? "还没有准备好"
            : "需要检查";

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
              AI 转录没有正常准备好，请到 AI 设置检查模型和运行组件。
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

type HealthLevel = "正常" | "未检测" | "需要看看" | "有问题";

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
}

const ShangHaoHealthOverview = ({
  runtimeHealth,
  relay,
  localAudioDiagnostics,
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
}: ShangHaoHealthOverviewProps) => {
  const relayLevel: HealthLevel = relay ? (relay.isReachable ? "正常" : "有问题") : "未检测";
  const webRtcLevel: HealthLevel =
    remotePeerCount === 0
      ? "未检测"
      : webrtcReadyPeerCount === remotePeerCount
        ? "正常"
        : "需要看看";
  const micLevel: HealthLevel = localAudioDiagnostics
    ? localAudioDiagnostics.inputOverload === "warning"
      ? "需要看看"
      : "正常"
    : "未检测";
  const networkLevel: HealthLevel =
    relay?.latencyMs === undefined
      ? "未检测"
      : relay.latencyMs < 160
        ? "正常"
        : relay.latencyMs < 300
          ? "需要看看"
          : "有问题";
  const screenLevel: HealthLevel = !screenShare
    ? "未检测"
    : screenShare.fallback.overdue
      ? "需要看看"
      : "正常";
  const outputLevel: HealthLevel = outputDeviceCount > 0 ? "正常" : "有问题";
  const windowsLevel: HealthLevel = windowsStatus
    ? windowsStatus.firewall.healthy
      ? "正常"
      : "需要看看"
    : "未检测";
  const items: Array<{
    label: string;
    level: HealthLevel;
    description: string;
    actionLabel?: string;
    onClick?: () => void;
  }> = [
    {
      label: "麦克风",
      level: micLevel,
      description: micLevel === "需要看看" ? "输入音量可能偏高，建议检查。" : "麦克风输入正常。",
      actionLabel: "去语音设置",
      onClick: onOpenAudioSettings,
    },
    {
      label: "扬声器",
      level: outputLevel,
      description: outputLevel === "有问题" ? "没有检测到可用的输出设备。" : "可以播放房间语音。",
      actionLabel: "去语音设置",
      onClick: onOpenAudioSettings,
    },
    {
      label: "房间连接",
      level: webRtcLevel,
      description:
        webRtcLevel === "未检测"
          ? "进入房间并有好友在线后会自动检查。"
          : webRtcLevel === "需要看看"
            ? "有好友还没有建立稳定的语音连接。"
            : "好友语音连接正常。",
      actionLabel: "回到房间",
      onClick: onOpenRoom,
    },
    {
      label: "服务器连接",
      level: relayLevel,
      description:
        relayLevel === "有问题"
          ? "暂时连不上服务器，请检查网络或服务器设置。"
          : "房间服务连接正常。",
      actionLabel: "回到房间",
      onClick: onOpenHome,
    },
    {
      label: "网络速度",
      level: networkLevel,
      description:
        networkLevel === "有问题" || networkLevel === "需要看看"
          ? "网络响应偏慢，可能影响语音稳定性。"
          : "网络响应正常。",
      actionLabel: "回到房间",
      onClick: onOpenRoom,
    },
    {
      label: "屏幕分享",
      level: screenLevel,
      description:
        screenLevel === "需要看看"
          ? "屏幕分享可能暂时卡住，请回到房间检查。"
          : "没有发现屏幕分享问题。",
      actionLabel: "回到房间",
      onClick: onOpenRoom,
    },
    {
      label: "应用运行",
      level: runtimeHealth ? "正常" : "未检测",
      description: runtimeHealth ? "应用运行正常。" : "应用启动后会自动检查。",
    },
    {
      label: "Windows 网络权限",
      level: windowsLevel,
      description:
        windowsLevel === "需要看看"
          ? "系统防火墙可能影响语音连接，可以直接修复。"
          : "系统网络权限正常。",
      actionLabel: windowsLevel === "需要看看" ? "自动修复" : undefined,
      onClick: windowsLevel === "需要看看" ? onRepairFirewall : undefined,
    },
  ];
  const attentionCount = items.filter(({ level }) => isAttentionLevel(level)).length;

  return (
    <div className="rounded-[16px] border border-[#DCE8F5] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-[#344054]">现在的状态</div>
          <div className="mt-1 text-xs leading-5 text-[#667085]">
            {attentionCount === 0
              ? "目前没有发现需要你处理的问题。"
              : "下面只列出可能需要你处理的项目。"}
          </div>
        </div>
        <Button variant="ghost" onClick={onRefresh}>
          重新检查
        </Button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map(({ label, level, description, actionLabel, onClick }) => (
          <div key={label} className="rounded-xl border border-[#EDF2F7] bg-[#FAFCFF] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[#52657D]">{label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${healthClass(level)}`}
              >
                {level}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-5 text-[#7A8CA5]">{description}</div>
            {actionLabel && onClick && isAttentionLevel(level) ? (
              <Button
                variant="ghost"
                className="mt-1.5 px-0 text-[11px]"
                onClick={onClick}
                disabled={isRepairingFirewall}
              >
                {label === "Windows 网络权限" && isRepairingFirewall ? "修复中…" : actionLabel}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {windowsStatus ? (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" className="px-0 text-[11px]" onClick={onRefreshWindows}>
            重新检查系统权限
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
  onInjectFault,
}: {
  runtimeHealth?: RuntimeHealthSnapshot;
  relay?: RelayStatusSnapshot;
  localAudioDiagnostics?: LocalAudioDiagnostics;
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
  onInjectFault: (kind: RealtimeFaultKind) => void;
}) => (
  <SettingsSection
    title="日志与诊断"
    description="这里给你看结论；完整的技术数据会在导出诊断包时一并保存。"
  >
    <div className="space-y-3">
      <ShangHaoHealthOverview
        runtimeHealth={runtimeHealth}
        relay={relay}
        localAudioDiagnostics={localAudioDiagnostics}
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
