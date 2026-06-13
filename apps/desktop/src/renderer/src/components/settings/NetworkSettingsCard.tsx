import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert, XCircle } from "lucide-react";

import type {
  AppSettings,
  DirectHostProbeSummary,
  NetworkStatusSnapshot,
  RelayStatusSnapshot,
  RuntimeInfo,
  TailscaleStatus,
  UpdateCheckResult,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { SegmentedControl } from "../base/SegmentedControl";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

type FeedbackTone = "neutral" | "loading" | "success" | "warning" | "error";

const feedbackStyles: Record<FeedbackTone, string> = {
  neutral: "border-[#E7ECF2] bg-[#F8FAFC] text-[#667085]",
  loading: "border-[#C7D7EB] bg-[#F3F8FE] text-[#377CB8]",
  success: "border-[#BDE8D0] bg-[#F2FBF6] text-[#237A4B]",
  warning: "border-[#F4D7A2] bg-[#FFF9ED] text-[#9A6700]",
  error: "border-[#F2C6C6] bg-[#FFF5F5] text-[#B42318]",
};

const FeedbackBadge = ({ tone, children }: { tone: FeedbackTone; children: string }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${feedbackStyles[tone]}`}>
    {tone === "loading" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
    {tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
    {tone === "warning" ? <TriangleAlert className="h-3.5 w-3.5" /> : null}
    {tone === "error" ? <XCircle className="h-3.5 w-3.5" /> : null}
    {children}
  </span>
);

const connectionModeNames: Record<AppSettings["connectionMode"], string> = {
  cloudflare_tunnel: "临时公网",
  relay: "云中继",
  tailscale: "Tailscale",
  direct_host: "房主直连",
};

const isRelayUrlValid = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const normalized = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
    const url = new URL(normalized);
    return (url.protocol === "ws:" || url.protocol === "wss:") && Boolean(url.hostname);
  } catch {
    return false;
  }
};

export const NetworkSettingsCard = ({
  settings,
  tailscaleStatus,
  networkSnapshot,
  runtimeInfo,
  updateInfo,
  onChange,
  onRefresh,
  onTestRelay,
  onTestDirectHost,
  onCheckUpdates,
  onOpenReleases,
}: {
  settings: AppSettings;
  tailscaleStatus?: TailscaleStatus;
  networkSnapshot?: NetworkStatusSnapshot;
  runtimeInfo?: RuntimeInfo;
  updateInfo?: UpdateCheckResult;
  onChange: (patch: Partial<AppSettings>) => Promise<void>;
  onRefresh: () => void;
  onTestRelay: () => Promise<RelayStatusSnapshot | undefined>;
  onTestDirectHost: () => Promise<DirectHostProbeSummary | undefined>;
  onCheckUpdates: () => void;
  onOpenReleases: () => void;
}) => {
  const [relayDraft, setRelayDraft] = useState(settings.relayServerUrl || "");
  const [directDraft, setDirectDraft] = useState(settings.manualDirectHost || "");
  const [relayFeedback, setRelayFeedback] = useState<{ tone: FeedbackTone; message: string }>({
    tone: "neutral",
    message: "未测试",
  });
  const [directFeedback, setDirectFeedback] = useState<{ tone: FeedbackTone; message: string }>({
    tone: "warning",
    message: "需要公网 IP 和端口映射",
  });
  const [modeFeedback, setModeFeedback] = useState(`当前：${connectionModeNames[settings.connectionMode]}`);

  useEffect(() => setRelayDraft(settings.relayServerUrl || ""), [settings.relayServerUrl]);
  useEffect(() => setDirectDraft(settings.manualDirectHost || ""), [settings.manualDirectHost]);

  const saveRelay = async () => {
    if (relayDraft.trim() && !isRelayUrlValid(relayDraft)) {
      setRelayFeedback({ tone: "error", message: "地址格式不正确" });
      return;
    }
    setRelayFeedback({ tone: "loading", message: "正在保存…" });
    try {
      await onChange({ relayServerUrl: relayDraft });
      setRelayFeedback({ tone: "neutral", message: relayDraft.trim() ? "已保存，未测试" : "已清空" });
    } catch {
      setRelayFeedback({ tone: "error", message: "保存失败" });
    }
  };

  const testRelay = async () => {
    await saveRelay();
    if (!relayDraft.trim() || !isRelayUrlValid(relayDraft)) {
      return;
    }
    setRelayFeedback({ tone: "loading", message: "正在测试…" });
    const result = await onTestRelay();
    if (result?.isReachable && result.isHealthReachable === false) {
      setRelayFeedback({ tone: "warning", message: result.message });
    } else if (result?.isReachable && result.hasVersionMismatch) {
      setRelayFeedback({ tone: "warning", message: result.message });
    } else if (result?.isReachable) {
      setRelayFeedback({ tone: "success", message: `服务器可用 · ${result.message}` });
    } else {
      setRelayFeedback({ tone: "error", message: result?.message || "服务器不可用" });
    }
  };

  const saveDirect = async () => {
    setDirectFeedback({ tone: "loading", message: "正在保存…" });
    try {
      await onChange({ manualDirectHost: directDraft });
      setDirectFeedback({
        tone: "warning",
        message: directDraft.trim() ? "已保存，仍需公网 IP 和端口映射" : "已清空",
      });
    } catch {
      setDirectFeedback({ tone: "error", message: "保存失败" });
    }
  };

  const testDirect = async () => {
    await saveDirect();
    setDirectFeedback({ tone: "loading", message: "正在测试…" });
    const result = await onTestDirectHost();
    setDirectFeedback({
      tone: result?.reachability === "reachable" ? "success" : result?.reachability === "pending" ? "loading" : "warning",
      message: result?.message || "暂时无法确认公网可达性",
    });
  };

  const changeMode = async (connectionMode: AppSettings["connectionMode"]) => {
    setModeFeedback("正在切换…");
    await onChange({ connectionMode });
    setModeFeedback(`已切换为 ${connectionModeNames[connectionMode]}`);
  };

  return (
    <SettingsSection title="高级连接" description="固定频道优先使用自定义服务器，其他方式仅用于排障。">
      <div className="space-y-3">
        <SettingsItemRow label="默认连接模式">
          <div className="space-y-2">
            <SegmentedControl
              value={settings.connectionMode}
              options={[
                { value: "cloudflare_tunnel", label: "临时公网" },
                { value: "relay", label: "云中继" },
                { value: "tailscale", label: "Tailscale" },
                { value: "direct_host", label: "房主直连" },
              ]}
              onChange={(connectionMode) => void changeMode(connectionMode as AppSettings["connectionMode"])}
            />
            <div className="text-xs text-[#667085]">{modeFeedback}</div>
          </div>
        </SettingsItemRow>
        <SettingsItemRow label="手动公网地址" description="高级模式，填写地址并不代表公网一定可达。">
          <div className="min-w-[420px] space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={directDraft}
                placeholder="例如 game.example.com"
                onChange={(event) => {
                  setDirectDraft(event.target.value);
                  setDirectFeedback({ tone: "neutral", message: "未保存" });
                }}
                onBlur={() => void saveDirect()}
              />
              <Button variant="secondary" className="min-w-[104px] whitespace-nowrap" onClick={() => void testDirect()} disabled={directFeedback.tone === "loading"}>
                测试地址
              </Button>
            </div>
            <FeedbackBadge tone={directFeedback.tone}>{directFeedback.message}</FeedbackBadge>
          </div>
        </SettingsItemRow>
        <SettingsItemRow label="固定频道服务器" description="普通使用只需要配置这一项。">
          <div className="min-w-[420px] space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={relayDraft}
                placeholder="例如 wss://voice.example.com"
                onChange={(event) => {
                  setRelayDraft(event.target.value);
                  setRelayFeedback({ tone: "neutral", message: "未测试" });
                }}
                onBlur={() => void saveRelay()}
              />
              <Button variant="secondary" className="min-w-[104px] whitespace-nowrap" onClick={() => void testRelay()} disabled={relayFeedback.tone === "loading"}>
                {relayFeedback.tone === "loading" ? "测试中…" : "测试连接"}
              </Button>
            </div>
            <FeedbackBadge tone={relayFeedback.tone}>{relayFeedback.message}</FeedbackBadge>
          </div>
        </SettingsItemRow>
        <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 text-sm text-[#667085]">
          <div className="font-medium text-[#111827]">当前网络摘要</div>
          <div className="mt-2">Tailscale：{tailscaleStatus?.message ?? "待检测"}</div>
          <div className="mt-1">公网 IP：{networkSnapshot?.publicIp ?? "未检测到"}</div>
          <div className="mt-1">代理 / TUN：{networkSnapshot?.proxy?.message ?? "未检测到明显异常"}</div>
          <div className="mt-1">直连探测：{networkSnapshot?.directHost?.message ?? "待检测"}</div>
          <div className="mt-1">中继状态：{networkSnapshot?.relay?.message ?? "待检测"}</div>
          <div className="mt-1">
            协议版本：{runtimeInfo?.protocolVersion ?? "未知"} / 构建号：{runtimeInfo?.buildNumber ?? "未知"}
          </div>
          <div className="mt-1">当前版本：{runtimeInfo?.version ?? "未知"}</div>
          <div className="mt-1">更新状态：{updateInfo?.message ?? "还没有检查更新"}</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" className="whitespace-nowrap" onClick={onRefresh}>重新检测</Button>
          <Button variant="secondary" className="whitespace-nowrap" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
            打开 Tailscale 页面
          </Button>
          <Button variant="secondary" className="whitespace-nowrap" onClick={onCheckUpdates}>检查更新</Button>
          <Button variant="secondary" className="whitespace-nowrap" onClick={onOpenReleases}>查看 Releases</Button>
        </div>
      </div>
    </SettingsSection>
  );
};
