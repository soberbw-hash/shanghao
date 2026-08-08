import type {
  ConnectionHealth,
  DiagnosticsSnapshot,
  LocalAudioDiagnostics,
  RelayStatusSnapshot,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";

export const DiagnosticsSettingsCard = ({
  diagnostics,
  relay,
  connectionHealth,
  localAudioDiagnostics,
  webrtcReadyPeerCount,
  remotePeerCount,
  audioRelayActive,
  windowsStatus,
  onOpenLogs,
  onExportBundle,
  onCopySummary,
  onRefreshWindows,
  onRepairFirewall,
}: {
  diagnostics?: DiagnosticsSnapshot;
  relay?: RelayStatusSnapshot;
  connectionHealth: ConnectionHealth;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  webrtcReadyPeerCount: number;
  remotePeerCount: number;
  audioRelayActive: boolean;
  windowsStatus?: WindowsIntegrationStatus;
  onOpenLogs: () => void;
  onExportBundle: () => void;
  onCopySummary: () => void;
  onRefreshWindows: () => void;
  onRepairFirewall: () => void;
}) => (
  <SettingsSection title="日志与诊断" description="出问题时导出诊断包发给开发者。">
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ["Relay 延迟", relay?.isReachable ? `${relay.latencyMs ?? "--"} ms` : "不可达"],
          ["TURN", relay?.turnConfigured || connectionHealth.turnConfigured ? "已配置" : "未配置"],
          ["WebRTC", `${webrtcReadyPeerCount}/${remotePeerCount} 个好友已直连`],
          [
            "当前语音路径",
            audioRelayActive
              ? "信令音频兜底"
              : connectionHealth.voicePath === "webrtc_turn"
                ? "WebRTC / TURN"
                : connectionHealth.voicePath === "webrtc_direct"
                  ? "WebRTC 直连"
                  : "等待连接",
          ],
          ["丢包", `${connectionHealth.packetLossPercent.toFixed(1)}%`],
          ["抖动", `${Math.round(connectionHealth.jitterMs)} ms`],
          [
            "本地降噪",
            localAudioDiagnostics?.noiseProcessor === "deepfilter_active"
              ? "DeepFilterNet 正常"
              : localAudioDiagnostics?.noiseProcessor === "deepfilter_loading"
                ? "DeepFilterNet 加载中"
                : localAudioDiagnostics?.noiseProcessor === "deepfilter_unavailable"
                  ? "不可用，原声直通"
                  : "已关闭",
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[14px] border border-[#E7ECF2] bg-white/80 px-3 py-2.5"
          >
            <div className="text-[11px] font-medium text-[#98A2B3]">{label}</div>
            <div className="mt-1 text-[13px] font-semibold text-[#344054]">{value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-[16px] border border-[#DCE8F5] bg-[#F7FAFE] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-[#344054]">Windows 网络权限</div>
            <div className="mt-1 text-xs leading-5 text-[#667085]">
              管理员权限：{windowsStatus?.elevation.isElevated ? "已启用" : "未启用或读取中"}
              <span className="mx-2 text-[#CBD5E1]">·</span>
              防火墙：
              {windowsStatus?.firewall.healthy
                ? `${windowsStatus.firewall.ruleCount}/${windowsStatus.firewall.expectedRuleCount} 条正常`
                : "需要检查"}
              <span className="mx-2 text-[#CBD5E1]">·</span>
              开机任务：{windowsStatus?.startupTask.enabled ? "正常" : "未启用"}
            </div>
            <div className="mt-1 text-[11px] text-[#98A2B3]">
              {windowsStatus?.firewall.message ?? "正在读取 Windows 集成状态…"}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onRefreshWindows}>
              刷新
            </Button>
            <Button variant="secondary" onClick={onRepairFirewall}>
              修复防火墙
            </Button>
          </div>
        </div>
      </div>
      <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 text-sm text-[#667085]">
        <div>日志目录：{diagnostics?.logsDirectory || "读取中…"}</div>
        <div className="mt-2">
          最近导出诊断包：{diagnostics?.lastBundlePath || "还没有导出记录"}
        </div>
        <div className="mt-2">
          更新检查：{diagnostics?.lastUpdateCheckMessage || "还没有检查更新"}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onOpenLogs}>
          打开日志目录
        </Button>
        <Button variant="secondary" onClick={onExportBundle}>
          导出诊断包
        </Button>
        <Button variant="ghost" onClick={onCopySummary}>
          复制诊断摘要
        </Button>
      </div>
    </div>
  </SettingsSection>
);
