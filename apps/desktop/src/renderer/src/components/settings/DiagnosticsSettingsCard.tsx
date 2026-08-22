import type {
  ConnectionHealth,
  DiagnosticsSnapshot,
  LocalAudioDiagnostics,
  PeerHealthDiagnostics,
  RealtimeFaultKind,
  RelayStatusSnapshot,
  RuntimeHealthSnapshot,
  ScreenSharePipelineDiagnostics,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";

const formatMemory = (bytes?: number): string =>
  typeof bytes === "number" ? `${(bytes / 1_048_576).toFixed(0)} MB` : "--";

const hasScreenShareMetrics = (screenShare: ScreenSharePipelineDiagnostics): boolean =>
  Boolean(
    screenShare.requested ||
    screenShare.capture ||
    Object.keys(screenShare.send).length > 0 ||
    Object.keys(screenShare.receive).length > 0 ||
    Object.keys(screenShare.present).length > 0,
  );

export const DiagnosticsSettingsCard = ({
  diagnostics,
  runtimeHealth,
  relay,
  connectionHealth,
  localAudioDiagnostics,
  webrtcReadyPeerCount,
  remotePeerCount,
  audioRelayActive,
  peerHealth,
  longSessionSampleCount,
  screenShare,
  windowsStatus,
  onOpenLogs,
  onExportBundle,
  onCopySummary,
  onRefreshWindows,
  onRepairFirewall,
  isRepairingFirewall,
  onInjectFault,
}: {
  diagnostics?: DiagnosticsSnapshot;
  runtimeHealth?: RuntimeHealthSnapshot;
  relay?: RelayStatusSnapshot;
  connectionHealth: ConnectionHealth;
  localAudioDiagnostics?: LocalAudioDiagnostics;
  webrtcReadyPeerCount: number;
  remotePeerCount: number;
  audioRelayActive: boolean;
  peerHealth?: Record<string, PeerHealthDiagnostics>;
  longSessionSampleCount: number;
  screenShare?: ScreenSharePipelineDiagnostics;
  windowsStatus?: WindowsIntegrationStatus;
  onOpenLogs: () => void;
  onExportBundle: () => void;
  onCopySummary: () => void;
  onRefreshWindows: () => void;
  onRepairFirewall: () => void;
  isRepairingFirewall: boolean;
  onInjectFault: (kind: RealtimeFaultKind) => void;
}) => (
  <SettingsSection title="日志与诊断" description="出问题时导出诊断包发给开发者。">
    <div className="space-y-3">
      <div className="rounded-[16px] border border-[#CFE0F5] bg-[#F3F8FE] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-[#344054]">实时诊断 HUD</div>
            <div className="mt-0.5 text-[11px] text-[#7A8CA5]">最近 10 秒真实采样，每 2 秒刷新</div>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#4D79B8]">
            {runtimeHealth ? "采集中" : "等待采样"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "刷新率 / 实际 FPS",
              `${runtimeHealth?.display.refreshRateHz ?? "--"} Hz / ${runtimeHealth?.rendererPerformance?.actualFps?.toFixed(0) ?? "--"}`,
            ],
            [
              "1% Low / P99",
              `${runtimeHealth?.rendererPerformance?.onePercentLowFps?.toFixed(0) ?? "--"} FPS / ${runtimeHealth?.rendererPerformance?.frameTimeP99Ms?.toFixed(1) ?? "--"} ms`,
            ],
            [
              "主进程 / 渲染进程",
              `${formatMemory(runtimeHealth?.main.workingSetBytes)} / ${formatMemory(runtimeHealth?.renderer?.workingSetBytes)}`,
            ],
            [
              "Peer / Track / 长帧",
              `${runtimeHealth?.realtime.peerCount ?? 0} / ${runtimeHealth?.realtime.trackCount ?? 0} / ${runtimeHealth?.rendererPerformance?.longFrameCount ?? 0}`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[12px] border border-white bg-white/80 px-3 py-2">
              <div className="text-[10px] font-medium text-[#98A2B3]">{label}</div>
              <div className="mt-1 text-[12px] font-semibold text-[#344054]">{value}</div>
            </div>
          ))}
        </div>
        {runtimeHealth?.rendererPerformance?.componentRenderCounts ? (
          <div className="mt-3 rounded-[12px] border border-white bg-white/80 px-3 py-3">
            <div className="text-[10px] font-medium text-[#98A2B3]">组件 Render（本采样窗口）</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {["RoomPage", "TeamIsland", "SceneCharacter", "ScreenShare"].map((name) => {
                const count = runtimeHealth.rendererPerformance?.componentRenderCounts?.[name] ?? 0;
                const reasons = runtimeHealth.rendererPerformance?.componentRenderReasons?.[name];
                const reason = reasons
                  ? Object.entries(reasons).sort((left, right) => right[1] - left[1])[0]?.[0]
                  : undefined;
                return (
                  <div key={name} className="rounded-[10px] border border-[#E8EEF7] px-2.5 py-2">
                    <div className="text-[11px] font-semibold text-[#344054]">{name}</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-[#6B7F99]">
                      {count} 次{reason ? ` · ${reason}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[11px] text-[#7A8CA5]">
              Long Task：
              {Object.entries(runtimeHealth.rendererPerformance.longTaskCategories ?? {})
                .map(([category, count]) => `${category} ${count}`)
                .join(" · ") || "无"}
            </div>
          </div>
        ) : null}
      </div>
      {screenShare ? (
        <div
          className={`rounded-[16px] border p-4 ${
            screenShare.fallback.overdue
              ? "border-[#F3A6A6] bg-[#FFF3F3]"
              : "border-[#CFE0F5] bg-[#F6FAFF]"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-[#344054]">屏幕分享链路</div>
            <span
              className={`text-[11px] font-semibold ${
                screenShare.fallback.overdue ? "text-[#D64545]" : "text-[#6B7F99]"
              }`}
            >
              {screenShare.fallback.active
                ? `兜底 ${Math.round(screenShare.fallback.activeForMs / 1_000)} 秒`
                : "WebRTC 视频"}
            </span>
          </div>
          {hasScreenShareMetrics(screenShare) ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[
                [
                  "请求 / 实际采集",
                  `${screenShare.requested?.width ?? "--"}×${screenShare.requested?.height ?? "--"} @ ${screenShare.requested?.framesPerSecond ?? "--"} / ${screenShare.capture?.width ?? "--"}×${screenShare.capture?.height ?? "--"} @ ${screenShare.capture?.framesPerSecond?.toFixed(0) ?? "--"}`,
                ],
                [
                  "编码 / 码率",
                  (() => {
                    const send = Object.values(screenShare.send)[0];
                    return `${send?.width ?? "--"}×${send?.height ?? "--"} @ ${send?.framesPerSecond?.toFixed(0) ?? "--"} / ${send?.bitrateBps ? `${(send.bitrateBps / 1_000_000).toFixed(2)} Mbps` : "--"}`;
                  })(),
                ],
                [
                  "解码 / 显示",
                  (() => {
                    const receive = Object.values(screenShare.receive)[0];
                    const present = Object.values(screenShare.present)[0];
                    return `${receive?.width ?? "--"}×${receive?.height ?? "--"} @ ${receive?.framesPerSecond?.toFixed(0) ?? "--"} / ${present?.framesPerSecond?.toFixed(0) ?? "--"} FPS`;
                  })(),
                ],
                [
                  "丢帧 / 卡顿 / 延迟",
                  (() => {
                    const receive = Object.values(screenShare.receive)[0];
                    return `${receive?.framesDropped ?? 0} / ${receive?.freezeCount ?? 0} / ${receive?.jitterBufferDelayMs?.toFixed(0) ?? "--"} ms`;
                  })(),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-[12px] border border-white bg-white/80 px-3 py-2"
                >
                  <div className="text-[10px] font-medium text-[#98A2B3]">{label}</div>
                  <div className="mt-1 text-[12px] font-semibold tabular-nums text-[#344054]">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[12px] border border-white bg-white/80 px-3 py-3 text-[12px] font-medium text-[#7A8CA5]">
              未开始屏幕分享
            </div>
          )}
        </div>
      ) : null}
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
            "好友健康",
            peerHealth && Object.keys(peerHealth).length > 0
              ? `${Object.values(peerHealth).filter((peer) => peer.level === "healthy").length}/${Object.keys(peerHealth).length} 正常`
              : "等待好友数据",
          ],
          [
            "长时趋势",
            `${longSessionSampleCount} 个节点 · ${runtimeHealth?.realtime.audioNodeCount ?? 0} AudioNode`,
          ],
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
          [
            "人声保护",
            localAudioDiagnostics?.noiseProcessor === "deepfilter_active"
              ? `${localAudioDiagnostics.speechProtection === "active" ? "保护中" : "待命"} · ${localAudioDiagnostics.currentSuppressionLevel ?? "--"} · 原声 ${Math.round((localAudioDiagnostics.rawProcessedMix?.raw ?? 0) * 100)}%`
              : "未启用",
          ],
          [
            "语音判断",
            localAudioDiagnostics
              ? `${localAudioDiagnostics.processingMode ?? "noise"} · VAD ${Math.round((localAudioDiagnostics.speechProbability ?? 0) * 100)}%${localAudioDiagnostics.doubleTalkDetected ? " · 双讲" : ""}${localAudioDiagnostics.remoteEchoDetected ? " · 回声" : ""}`
              : "等待麦克风",
          ],
          [
            "处理负载",
            localAudioDiagnostics
              ? `平均 ${(localAudioDiagnostics.averageProcessingMs ?? 0).toFixed(1)} ms · 峰值 ${(localAudioDiagnostics.maxProcessingMs ?? 0).toFixed(1)} ms · 超时 ${localAudioDiagnostics.processorOverruns ?? 0}`
              : "等待麦克风",
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
            <Button variant="secondary" onClick={onRepairFirewall} disabled={isRepairingFirewall}>
              {isRepairingFirewall ? "修复中…" : "修复防火墙"}
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
      {import.meta.env.DEV ? (
        <div className="rounded-[16px] border border-dashed border-[#E4B968] bg-[#FFF9EC] p-4">
          <div className="text-[13px] font-semibold text-[#6F5422]">Realtime Fault Lab</div>
          <div className="mt-1 text-[11px] leading-5 text-[#93713A]">
            仅开发环境可见。用于验证断线、旧连接事件、重复关闭、快照超时、单好友音频恢复和屏幕轨丢失。
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
        </div>
      ) : null}
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
