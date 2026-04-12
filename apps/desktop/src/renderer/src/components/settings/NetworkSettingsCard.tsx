import type {
  AppSettings,
  NetworkStatusSnapshot,
  RuntimeInfo,
  TailscaleStatus,
  UpdateCheckResult,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { SegmentedControl } from "../base/SegmentedControl";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const NetworkSettingsCard = ({
  settings,
  tailscaleStatus,
  networkSnapshot,
  runtimeInfo,
  updateInfo,
  onChange,
  onRefresh,
  onCheckUpdates,
  onOpenReleases,
}: {
  settings: AppSettings;
  tailscaleStatus?: TailscaleStatus;
  networkSnapshot?: NetworkStatusSnapshot;
  runtimeInfo?: RuntimeInfo;
  updateInfo?: UpdateCheckResult;
  onChange: (patch: Partial<AppSettings>) => void;
  onRefresh: () => void;
  onCheckUpdates: () => void;
  onOpenReleases: () => void;
}) => (
  <SettingsSection title="网络与连接" description="连接方式手动选择，不做自动猜测。">
    <div className="space-y-3">
      <SettingsItemRow label="默认连接模式">
        <SegmentedControl
          value={settings.connectionMode}
          options={[
            { value: "direct_host", label: "房主直连" },
            { value: "tailscale", label: "Tailscale" },
            { value: "relay", label: "云中继" },
          ]}
          onChange={(connectionMode) =>
            onChange({ connectionMode: connectionMode as AppSettings["connectionMode"] })
          }
        />
      </SettingsItemRow>
      <SettingsItemRow label="手动公网地址" description="DDNS、公网 IP 或你已经做好的端口映射地址。">
        <Input
          value={settings.manualDirectHost || ""}
          placeholder="例如 game.example.com"
          onChange={(event) => onChange({ manualDirectHost: event.target.value })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="云中继地址">
        <Input
          value={settings.relayServerUrl || ""}
          placeholder="例如 wss://relay.example.com/room"
          onChange={(event) => onChange({ relayServerUrl: event.target.value })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="自动复制开房地址">
        <Button
          variant={settings.shouldAutoCopyInviteLink ? "primary" : "secondary"}
          onClick={() => onChange({ shouldAutoCopyInviteLink: !settings.shouldAutoCopyInviteLink })}
        >
          {settings.shouldAutoCopyInviteLink ? "已开启" : "已关闭"}
        </Button>
      </SettingsItemRow>
      <div className="rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4 text-sm text-[#667085]">
        <div className="font-medium text-[#111827]">当前网络状态</div>
        <div className="mt-2">Tailscale：{tailscaleStatus?.message ?? "待检测"}</div>
        <div className="mt-1">公网 IP：{networkSnapshot?.publicIp ?? "未检测到"}</div>
        <div className="mt-1">
          代理 / TUN：{networkSnapshot?.proxy?.message ?? "未检测到异常代理环境"}
        </div>
        <div className="mt-1">直连探测：{networkSnapshot?.directHost?.message ?? "待检测"}</div>
        <div className="mt-1">中继状态：{networkSnapshot?.relay?.message ?? "待检测"}</div>
        <div className="mt-1">
          协议版本：{runtimeInfo?.protocolVersion ?? "未知"} / 构建号：
          {runtimeInfo?.buildNumber ?? "未知"}
        </div>
        <div className="mt-1">当前版本：{runtimeInfo?.version ?? "未知"}</div>
        <div className="mt-1">更新状态：{updateInfo?.message ?? "还没有检查更新"}</div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onRefresh}>
          重新检测
        </Button>
        <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
          打开 Tailscale 页面
        </Button>
        <Button variant="secondary" onClick={onCheckUpdates}>
          检查更新
        </Button>
        <Button variant="secondary" onClick={onOpenReleases}>
          查看 Releases
        </Button>
      </div>
    </div>
  </SettingsSection>
);
