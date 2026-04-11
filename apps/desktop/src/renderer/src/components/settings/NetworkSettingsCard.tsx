import type {
  AppSettings,
  NetworkStatusSnapshot,
  RuntimeInfo,
  TailscaleStatus,
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
  onChange,
  onRefresh,
}: {
  settings: AppSettings;
  tailscaleStatus?: TailscaleStatus;
  networkSnapshot?: NetworkStatusSnapshot;
  runtimeInfo?: RuntimeInfo;
  onChange: (patch: Partial<AppSettings>) => void;
  onRefresh: () => void;
}) => (
  <SettingsSection title="网络与连接" description="连接方式手动选择，不做自动瞎猜。">
    <div className="space-y-3">
      <SettingsItemRow label="默认连接模式">
        <SegmentedControl
          value={settings.connectionMode}
          options={[
            { value: "direct_host", label: "房主直连" },
            { value: "tailscale", label: "Tailscale" },
            { value: "relay", label: "云中继" },
          ]}
          onChange={(connectionMode) => onChange({ connectionMode: connectionMode as AppSettings["connectionMode"] })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="手动公网地址" description="DDNS、公网 IP 或端口映射地址。留空时自动尝试检测公网 IP。">
        <Input
          value={settings.manualDirectHost || ""}
          placeholder="例如 game.example.com"
          onChange={(event) => onChange({ manualDirectHost: event.target.value })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="中继服务器地址" description="云中继模式才会使用。">
        <Input
          value={settings.relayServerUrl || ""}
          placeholder="例如 wss://relay.example.com/room"
          onChange={(event) => onChange({ relayServerUrl: event.target.value })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="自动复制开房地址">
        <Button
          variant={settings.shouldAutoCopyInviteLink ? "primary" : "secondary"}
          onClick={() =>
            onChange({ shouldAutoCopyInviteLink: !settings.shouldAutoCopyInviteLink })
          }
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
        <div className="mt-1">
          协议版本：{runtimeInfo?.protocolVersion ?? "未知"} / 构建号：{runtimeInfo?.buildNumber ?? "未知"}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onRefresh}>
          重新检测
        </Button>
        <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
          打开 Tailscale 页面
        </Button>
      </div>
    </div>
  </SettingsSection>
);
