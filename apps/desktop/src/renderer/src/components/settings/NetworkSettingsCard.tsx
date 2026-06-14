import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

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

type Feedback = { tone: "idle" | "loading" | "good" | "warn"; message: string };

const modeNames: Record<AppSettings["connectionMode"], string> = {
  relay: "常驻频道",
  tailscale: "好友内网",
  direct_host: "本机临时入口",
  cloudflare_tunnel: "临时公网",
};

const isAddressValid = (value: string) => {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `ws://${value.trim()}`);
    return Boolean(url.hostname);
  } catch {
    return false;
  }
};

const Status = ({ feedback }: { feedback: Feedback }) => (
  <div className={`flex items-center gap-2 text-xs ${feedback.tone === "good" ? "text-[#188c55]" : feedback.tone === "warn" ? "text-[#a36a09]" : "text-[#718096]"}`}>
    {feedback.tone === "loading" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
    {feedback.tone === "good" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
    {feedback.tone === "warn" ? <TriangleAlert className="h-3.5 w-3.5" /> : null}
    {feedback.message}
  </div>
);

export const NetworkSettingsCard = ({
  settings,
  networkSnapshot,
  runtimeInfo,
  updateInfo,
  onChange,
  onRefresh,
  onTestRelay,
  onTestDirectHost,
  onCheckUpdates,
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
  const [serverDraft, setServerDraft] = useState(settings.relayServerUrl || "");
  const [temporaryDraft, setTemporaryDraft] = useState(settings.manualDirectHost || "");
  const [serverStatus, setServerStatus] = useState<Feedback>({ tone: "idle", message: "使用默认常驻频道" });
  const [temporaryStatus, setTemporaryStatus] = useState<Feedback>({ tone: "idle", message: "仅在朋友让你填写时使用" });
  const [modeFeedback, setModeFeedback] = useState(`当前：${modeNames[settings.connectionMode]}`);

  useEffect(() => setServerDraft(settings.relayServerUrl || ""), [settings.relayServerUrl]);
  useEffect(() => setTemporaryDraft(settings.manualDirectHost || ""), [settings.manualDirectHost]);

  const saveServer = async () => {
    if (!isAddressValid(serverDraft)) {
      setServerStatus({ tone: "warn", message: "地址格式不正确" });
      return false;
    }
    await onChange({ relayServerUrl: serverDraft });
    return true;
  };

  const testServer = async () => {
    setServerStatus({ tone: "loading", message: "正在测试…" });
    if (!(await saveServer())) return;
    const result = await onTestRelay();
    setServerStatus({
      tone: result?.isReachable ? "good" : "warn",
      message: result?.isReachable ? "服务器可用，朋友可以进入频道" : "暂时连不上频道，请稍后再试",
    });
  };

  const testTemporary = async () => {
    setTemporaryStatus({ tone: "loading", message: "正在测试…" });
    await onChange({ manualDirectHost: temporaryDraft });
    const result = await onTestDirectHost();
    setTemporaryStatus({
      tone: result?.reachability === "reachable" ? "good" : "warn",
      message: result?.reachability === "reachable" ? "测试地址可以使用" : "暂时无法确认这个地址",
    });
  };

  return (
    <SettingsSection title="高级连接" description="默认设置已经适合日常使用，只有排障时才需要修改。">
      <div className="space-y-3">
        <SettingsItemRow label="连接方式">
          <div className="space-y-2">
            <SegmentedControl
              value={settings.connectionMode}
              options={[
                { value: "relay", label: "常驻频道" },
                { value: "tailscale", label: "好友内网" },
                { value: "direct_host", label: "本机入口" },
                { value: "cloudflare_tunnel", label: "临时公网" },
              ]}
              onChange={(value) => {
                const connectionMode = value as AppSettings["connectionMode"];
                void onChange({ connectionMode }).then(() => setModeFeedback(`已切换为 ${modeNames[connectionMode]}`));
              }}
            />
            <div className="text-xs text-[#718096]">{modeFeedback}</div>
          </div>
        </SettingsItemRow>

        <SettingsItemRow label="自定义常驻频道">
          <div className="min-w-[420px] space-y-2">
            <div className="flex gap-2">
              <Input value={serverDraft} onChange={(event) => setServerDraft(event.target.value)} onBlur={() => void saveServer()} />
              <Button variant="secondary" className="whitespace-nowrap" onClick={() => void testServer()}>测试连接</Button>
            </div>
            <Status feedback={serverStatus} />
          </div>
        </SettingsItemRow>

        <SettingsItemRow label="临时链接" description="只有朋友让你填写时才使用。">
          <div className="min-w-[420px] space-y-2">
            <div className="flex gap-2">
              <Input value={temporaryDraft} placeholder="朋友发来的地址" onChange={(event) => setTemporaryDraft(event.target.value)} />
              <Button variant="secondary" className="whitespace-nowrap" onClick={() => void testTemporary()}>测试地址</Button>
            </div>
            <Status feedback={temporaryStatus} />
          </div>
        </SettingsItemRow>

        <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-white/90 bg-white/60 p-4">
          <div className="mr-auto">
            <div className="text-sm font-semibold text-[#26354a]">连接体检</div>
            <div className="mt-1 text-xs text-[#7d8da2]">
              {networkSnapshot?.relay?.isReachable ? "常驻频道连接稳定" : "还没有完成连接体检"}
            </div>
          </div>
          <Button variant="secondary" onClick={onRefresh}>重新体检</Button>
          <Button variant="secondary" onClick={onCheckUpdates}>检查更新</Button>
        </div>
        <div className="text-xs text-[#8b99aa]">当前版本：{runtimeInfo?.version ?? "读取中…"} · {updateInfo?.message ?? "还没有检查更新"}</div>
      </div>
    </SettingsSection>
  );
};
