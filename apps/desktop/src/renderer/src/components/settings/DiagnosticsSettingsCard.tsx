import { useState } from "react";
import { ArrowRight, Download, HelpCircle } from "lucide-react";
import type {
  LocalAudioDiagnostics,
  PeerHealthDiagnostics,
  RelayStatusSnapshot,
  RuntimeHealthSnapshot,
  ScreenSharePipelineDiagnostics,
  WindowsIntegrationStatus,
} from "@private-voice/shared";
import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";
import { useSettingsStore } from "../../store/settingsStore";
import type { AudioRuntimeSnapshot } from "../../features/audio/audioRuntimeSnapshot";
import type { RemoteAudioMixerDiagnostics } from "../../features/audio/RemoteAudioMixer";
import {
  microphoneHealth,
  speakerHealth,
  roomAudioHealth,
  screenShareHealth,
} from "../../features/diagnostics/healthProjection";
import {
  networkHealth,
  networkPermissionHealth,
} from "../../features/diagnostics/networkPermissionHealth";

const situations = [
  ["microphone", "朋友听不到我", "检查麦克风与静音设置"],
  ["speaker", "听不到朋友", "检查耳机、扬声器和房间声音"],
  ["connection", "进不去房间 / 声音断断续续", "检查连接和系统网络权限"],
  ["transcription", "录音转不出文字", "检查转录配置与任务进度"],
  ["sharing", "共享画面异常", "检查分享来源与房间画面"],
] as const;
type Situation = (typeof situations)[number][0];

export interface DiagnosticsSettingsCardProps {
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
  isExportingBundle?: boolean;
  checkFeedback?: string;
}

export const DiagnosticsSettingsCard = (props: DiagnosticsSettingsCardProps) => {
  const [selected, setSelected] = useState<Situation>();
  const provider = useSettingsStore((state) => state.settings?.aiTranscriptionProvider ?? "cloud");
  const mic = microphoneHealth(props.audioRuntime, props.localAudioDiagnostics);
  const output = speakerHealth(props);
  const room = roomAudioHealth(props);
  const network = networkHealth(props.relay);
  const screen = screenShareHealth(props.screenShare);
  const permissions = networkPermissionHealth(props.windowsStatus?.firewall);
  const busy = props.isRefreshingHealth || props.isRefreshingWindows;
  const guidance = {
    microphone: {
      title: "先确认麦克风能收到你的声音",
      finding: mic.description,
      steps: [
        "确认麦克风没有静音，耳机或麦克风已插好。",
        "在语音设置里选择正在使用的麦克风，做一次声音测试。",
        "本机有输入不代表朋友已听到，测试后请朋友帮忙确认。",
      ],
      action: "去语音设置测试",
      onClick: props.onOpenAudioSettings,
    },
    speaker: {
      title: "先确认声音播放到正确的设备",
      finding: output.description,
      steps: [
        "确认没有关闭房间声音，朋友也没有静音。",
        "在语音设置里选择正在使用的耳机或扬声器，检查音量。",
        "仍听不到某位朋友时，回到房间检查对方的音量。",
      ],
      action: "检查耳机和音量",
      onClick: props.onOpenAudioSettings,
    },
    connection: {
      title: "先检查网络，再看系统授权",
      finding:
        props.relay && !props.relay.isReachable
          ? "暂时连接不上房间服务器，请先确认网络可用。"
          : network.level === "需要看看"
            ? "当前网络响应偏慢，可能影响语音。"
            : !props.roomActive && props.relay?.isReachable
              ? "房间服务器可以连接，回首页选择房间后再试。"
              : room.description,
      steps: [
        "确认电脑能正常上网，再回到房间重试。",
        "连接异常会自动尝试恢复，也可回到房间查看连接状态。",
        permissions.retry
          ? "使用下方“修复网络权限”，按 Windows 提示确认授权。"
          : "重试后仍连接不上时，导出诊断包，方便开发者定位。",
      ],
      action: props.roomActive ? "回到房间查看" : "回首页选择房间",
      onClick: props.roomActive ? props.onOpenRoom : props.onOpenHome,
    },
    transcription: {
      title: "先查看任务进度和转录配置",
      finding:
        provider === "local"
          ? "当前使用本地转录，需要准备所选模型和运行组件。"
          : "当前使用云端转录，需要可用的密钥和网络连接。",
      steps: [
        "录音库里显示“排队中”时，会等待前一条处理完成。",
        "到 AI 功能检查所选服务是否配置完成；本地辅助缺模型时，先只用云端。",
        "若显示失败，保留已有结果后重试；仍失败时导出诊断包。",
      ],
      action: "检查转录设置",
      onClick: props.onOpenAiSettings,
    },
    sharing: {
      title: "回到房间检查正在分享的画面",
      finding: screen.description,
      steps: [
        "确认选择的是想分享的窗口或屏幕。",
        "请朋友确认是否能看到画面；只有本机预览不能证明对方已收到。",
        "画面卡住时可停止后重新选择分享来源，语音不需要退出。",
      ],
      action: "回到房间",
      onClick: props.onOpenRoom,
    },
  };
  const current = selected ? guidance[selected] : undefined;
  return (
    <SettingsSection
      title="帮助与修复"
      description="选一个遇到的情况，按提示处理；需要帮助时导出诊断包。"
    >
      <div className="diagnostics-user-view text-[var(--sg-ink-1)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#dce8f5] pb-5">
          <div className="max-w-[55ch]">
            <p className="text-sm font-medium">需要帮忙定位问题？</p>
            <p className="mt-1 text-xs leading-5 text-[#52657d]">
              导出后把诊断包发给开发者，无需读懂里面的技术信息。
            </p>
          </div>
          <Button disabled={props.isExportingBundle} onClick={props.onExportBundle}>
            <Download className="size-4" aria-hidden="true" />
            {props.isExportingBundle ? "正在导出…" : "导出完整诊断包"}
          </Button>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
          <div role="group" aria-label="遇到了什么问题">
            <h3 className="mb-3 text-sm font-semibold">遇到了什么问题？</h3>
            <div className="space-y-1">
              {situations.map(([id, title, description]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected === id}
                  aria-controls="diagnostics-guidance"
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3978bd] ${selected === id ? "border-[#b8d5f6] bg-[#eaf3ff]" : "border-transparent hover:bg-[#f3f8ff]"}`}
                  onClick={() => setSelected(id)}
                >
                  <span>
                    <strong className="block text-[13px] font-medium">{title}</strong>
                    <span className="mt-1 block text-xs text-[#52657d]">{description}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-[#52657d]" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <section
            id="diagnostics-guidance"
            className="min-w-0 md:border-l md:border-[#dce8f5] md:pl-6"
            aria-live="polite"
          >
            {current ? (
              <>
                <h3 className="text-base font-semibold">{current.title}</h3>
                <p className="mt-3 text-[13px] leading-6 text-[#52657d]">{current.finding}</p>
                <ol className="mt-4 list-decimal space-y-3 pl-5 text-[13px] leading-6">
                  {current.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {selected === "connection" && (permissions.retry || props.isRepairingFirewall) ? (
                  <div className="mt-4 border-l-2 border-[#b8d5f6] pl-3">
                    <p className="text-xs leading-5 text-[#52657d]">
                      上号的网络权限需要处理。修复时若出现 Windows 授权框，请确认后继续。
                    </p>
                    <Button
                      className="mt-2"
                      variant="secondary"
                      disabled={props.isRepairingFirewall || busy}
                      onClick={props.onRepairFirewall}
                    >
                      {props.isRepairingFirewall ? "修复中…" : "修复网络权限"}
                    </Button>
                  </div>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button variant="secondary" data-action="primary" onClick={current.onClick}>
                    {current.action}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={props.onRefreshHealth}>
                    {busy ? "检查中…" : "重新检查"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center text-[#52657d]">
                <HelpCircle className="size-7" aria-hidden="true" />
                <p className="text-sm">选择一种情况，查看下一步</p>
                <p className="max-w-[32ch] text-xs leading-5">
                  不用判断技术指标，也不用先重置设置。
                </p>
              </div>
            )}
            {props.checkFeedback ? (
              <p className="mt-3 text-xs leading-5 text-[#52657d]" role="status">
                {props.checkFeedback}
              </p>
            ) : null}
          </section>
        </div>
        <details className="mt-6 border-t border-[#dce8f5] pt-4">
          <summary className="cursor-pointer text-xs text-[#52657d]">其他帮助工具</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={props.onCopySummary}>
              复制问题摘要
            </Button>
            <Button variant="ghost" onClick={props.onOpenLogs}>
              打开诊断文件夹
            </Button>
          </div>
        </details>
      </div>
    </SettingsSection>
  );
};
