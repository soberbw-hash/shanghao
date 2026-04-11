import {
  AlertCircle,
  Clipboard,
  Copy,
  Link2,
  Mic,
  Radio,
  Settings2,
  Waves,
} from "lucide-react";

import { type ConnectionMode, MicPermissionState, TailscaleState } from "@private-voice/shared";

import { DeviceHealthNotice } from "../components/audio/DeviceHealthNotice";
import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { SegmentedControl } from "../components/base/SegmentedControl";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { MemberGrid } from "../components/room/MemberGrid";
import { useMicTest } from "../hooks/useMicTest";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

const connectionModeOptions = [
  { value: "direct_host", label: "房主直连" },
  { value: "tailscale", label: "Tailscale" },
  { value: "relay", label: "云中继" },
] satisfies { value: ConnectionMode; label: string }[];

const modeCopy: Record<
  ConnectionMode,
  {
    label: string;
    hint: string;
    placeholder: string;
  }
> = {
  direct_host: {
    label: "公网直连",
    hint: "默认模式。适合你有公网 IP、端口映射、DDNS 或手动公网地址时使用。",
    placeholder: "ws://你的公网地址:43821?roomId=...",
  },
  tailscale: {
    label: "Tailscale",
    hint: "适合固定朋友长期使用。优先用 MagicDNS，其次用 100.x 地址。",
    placeholder: "ws://your-name.ts.net:43821?roomId=...",
  },
  relay: {
    label: "云中继",
    hint: "当直连和 Tailscale 都不方便时，用你自建或第三方中继地址兜底。",
    placeholder: "wss://relay.example.com/room?roomId=...",
  },
};

export const HomePage = () => {
  const { room, joinSignalUrl, setJoinSignalUrl, startHost, joinRoom, replaceInputDevice, copyInviteLink } =
    useRoomState();
  const roomAction = useAppStore((state) => state.roomAction);
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const networkSnapshot = useSettingsStore((state) => state.networkSnapshot);
  const refreshNetworkSnapshot = useSettingsStore((state) => state.refreshNetworkSnapshot);
  const hostSession = useRoomStore((state) => state.hostSession);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const navigate = useAppStore((state) => state.navigate);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    toggleMute,
    setPushToTalkEnabled,
    permissionState,
  } = useAudioStore();

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
  });

  if (!settings) {
    return null;
  }

  const currentMode = settings.connectionMode;
  const currentModeCopy = modeCopy[currentMode];
  const currentAddress = hostSession?.signalingUrl ?? room.signalingUrl;
  const proxyMessage = networkSnapshot?.proxy?.message;

  const handlePasteSignalUrl = () => {
    void navigator.clipboard
      .readText()
      .then((value) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
          pushToast({
            tone: "warning",
            title: "剪贴板没有有效地址",
            description: "请先复制房主分享的完整房间地址。",
          });
          return;
        }

        setJoinSignalUrl(trimmed);
        pushToast({
          tone: "success",
          title: "已粘贴房间地址",
          description: "现在可以直接加入了。",
        });
      })
      .catch(() => {
        pushToast({
          tone: "warning",
          title: "读取剪贴板失败",
          description: "你也可以手动粘贴房主发来的地址。",
        });
      });
  };

  const handleModeChange = (value: string) => {
    const nextMode = value as ConnectionMode;
    void saveSettings({ connectionMode: nextMode }).then(() => {
      void refreshNetworkSnapshot();
    });
  };

  const handleMicTest = () => {
    void micTest.toggle().catch((error) => {
      pushToast({
        tone: "danger",
        title: "试音失败",
        description:
          error instanceof Error ? error.message : "当前无法启动试音，请检查麦克风权限。",
      });
    });
  };

  const handleCopyAddress = () => {
    void copyInviteLink();
  };

  const currentStatusLine =
    currentMode === "relay"
      ? settings.relayServerUrl?.trim()
        ? `中继地址：${settings.relayServerUrl}`
        : "还没有填写中继服务器地址"
      : currentMode === "direct_host"
        ? settings.manualDirectHost?.trim()
          ? `手动公网地址：${settings.manualDirectHost}`
          : networkSnapshot?.publicIp
            ? `检测到公网 IP：${networkSnapshot.publicIp}`
            : "还没有可用的公网直连地址"
        : tailscaleStatus?.magicDnsName
          ? `推荐地址：${tailscaleStatus.magicDnsName}`
          : tailscaleStatus?.ip
            ? `当前地址：${tailscaleStatus.ip}`
            : "还没有可用的 Tailscale 地址";

  return (
    <PageContainer className="overflow-y-auto">
      <TopStatusBar />

      {permissionState === MicPermissionState.Denied ? (
        <DeviceHealthNotice message="还没有给上号麦克风权限，先去 Windows 设置里允许访问。" />
      ) : null}
      {inputDevices.length === 0 || outputDevices.length === 0 ? (
        <DeviceHealthNotice message="当前缺少输入或输出设备，先接好麦克风和耳机。" />
      ) : null}
      {tailscaleStatus?.state === TailscaleState.NotInstalled && currentMode === "tailscale" ? (
        <InlineBanner tone="warning">当前选中了 Tailscale 模式，但这台机器还没有安装 Tailscale。</InlineBanner>
      ) : null}
      {networkSnapshot?.proxy ? (
        <InlineBanner tone="neutral">
          {proxyMessage || "检测到代理或 TUN 环境，房间连接已自动启用直连兼容模式。"}
        </InlineBanner>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
        <div className="rounded-[24px] border border-[#E7ECF2] bg-white p-5 shadow-[0_20px_40px_rgba(17,24,39,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[24px] font-semibold text-[#111827]">开房或加入</div>
              <p className="text-sm text-[#667085]">先选连接方式，再开房或加入。</p>
            </div>
            <Button variant="secondary" onClick={() => navigate("settings")}>
              <Settings2 className="h-4 w-4" />
              连接设置
            </Button>
          </div>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-[#111827]">连接模式</div>
              <SegmentedControl
                value={currentMode}
                options={connectionModeOptions}
                onChange={handleModeChange}
              />
              <div className="text-sm text-[#667085]">{currentModeCopy.hint}</div>
            </div>

            <div className="rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                <Radio className="h-4 w-4 text-[#4DA3FF]" />
                开启房间
              </div>
              <div className="mt-2 text-sm text-[#667085]">{currentStatusLine}</div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button onClick={() => void startHost()} disabled={roomAction !== "idle"}>
                  {roomAction === "starting" ? "正在开启…" : "开启房间"}
                </Button>
                {currentAddress ? (
                  <Button variant="secondary" onClick={handleCopyAddress}>
                    <Copy className="h-4 w-4" />
                    复制当前地址
                  </Button>
                ) : null}
              </div>
              {hostSession ? (
                <div className="mt-3 rounded-[14px] border border-[#DCE8F7] bg-white px-3 py-3 text-sm text-[#667085]">
                  <div className="font-medium text-[#111827]">房间已开启</div>
                  <div className="mt-1 break-all">{hostSession.signalingUrl}</div>
                  <div className="mt-1 text-[#98A2B3]">现在把地址发给朋友就行。</div>
                </div>
              ) : null}
            </div>

            <div className="rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                <Link2 className="h-4 w-4 text-[#4DA3FF]" />
                加入房间
              </div>
              <div className="mt-2 text-sm text-[#667085]">模式会写进邀请地址里，加入前仍会显示当前选中模式。</div>
              <div className="mt-4 flex flex-col gap-3">
                <Input
                  placeholder={currentModeCopy.placeholder}
                  value={joinSignalUrl}
                  onChange={(event) => setJoinSignalUrl(event.target.value)}
                />
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={handlePasteSignalUrl}>
                    <Clipboard className="h-4 w-4" />
                    粘贴地址
                  </Button>
                  <Button
                    onClick={() => void joinRoom()}
                    disabled={Boolean(roomAction !== "idle" || !joinSignalUrl.trim())}
                  >
                    {roomAction === "joining" ? "正在加入…" : "立即加入"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[24px] border border-[#E7ECF2] bg-white p-5 shadow-[0_20px_40px_rgba(17,24,39,0.06)]">
            <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
              <Mic className="h-4 w-4 text-[#4DA3FF]" />
              试音
            </div>
            <div className="mt-2 text-sm text-[#667085]">开始后会把你的麦克风回放到当前输出设备。建议戴耳机测试。</div>
            <div className="mt-4 flex items-center gap-3">
              <Button variant={micTest.isTesting ? "danger" : "secondary"} onClick={handleMicTest}>
                <Waves className="h-4 w-4" />
                {micTest.isTesting ? "停止试音" : "开始试音"}
              </Button>
              <div className="text-sm text-[#667085]">{micTest.isTesting ? "试音中" : "未开始"}</div>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#EEF2F6]">
              <div
                className="h-full rounded-full bg-[#4DA3FF] transition-[width] duration-150"
                style={{ width: `${Math.max(6, micTest.level * 100)}%` }}
              />
            </div>
            {micTest.error ? (
              <div className="mt-3 flex items-start gap-2 rounded-[14px] border border-[#F9D3D0] bg-[#FEF3F2] px-3 py-3 text-sm text-[#B42318]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{micTest.error}</span>
              </div>
            ) : null}
          </div>

          <div className="rounded-[24px] border border-[#E7ECF2] bg-white p-5 shadow-[0_20px_40px_rgba(17,24,39,0.06)]">
            <div className="text-sm font-medium text-[#111827]">连接自检</div>
            <div className="mt-3 space-y-2 text-sm text-[#667085]">
              <div>当前模式：{modeCopy[currentMode].label}</div>
              <div>当前地址：{currentAddress || "还没有生成"}</div>
              <div>Tailscale：{tailscaleStatus?.message || "待检测"}</div>
              <div>代理 / TUN：{proxyMessage || "未检测到异常代理环境"}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-3">
        <div className="text-sm font-medium text-[#667085]">开黑位</div>
        <MemberGrid
          members={room.members}
          onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)}
        />
      </div>

      <BottomControlDock>
        <div className="flex flex-wrap items-center gap-3">
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
          <PushToTalkToggle
            isEnabled={isPushToTalkEnabled}
            onClick={() => {
              setPushToTalkEnabled(!isPushToTalkEnabled);
              void saveSettings({ isPushToTalkEnabled: !isPushToTalkEnabled });
            }}
          />
        </div>
        <div className="grid min-w-[280px] flex-1 gap-3 md:grid-cols-2">
          <InputDevicePicker
            devices={inputDevices}
            value={settings.preferredInputDeviceId}
            onChange={(preferredInputDeviceId) => {
              void saveSettings({ preferredInputDeviceId }).then(() =>
                replaceInputDevice(preferredInputDeviceId),
              );
            }}
          />
          <OutputDevicePicker
            devices={outputDevices}
            value={settings.preferredOutputDeviceId}
            onChange={(preferredOutputDeviceId) => void saveSettings({ preferredOutputDeviceId })}
          />
        </div>
      </BottomControlDock>
    </PageContainer>
  );
};
