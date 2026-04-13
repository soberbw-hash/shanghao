import { useMemo, useState } from "react";
import { Clipboard, Link2, Radio } from "lucide-react";

import {
  MicPermissionState,
  TailscaleState,
  type ConnectionMode,
} from "@private-voice/shared";

import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { SegmentedControl } from "../components/base/SegmentedControl";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { MemberGrid } from "../components/room/MemberGrid";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
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
    hint: string;
    placeholder: string;
    startDescription: string;
    joinDescription: string;
  }
> = {
  direct_host: {
    hint: "先启动本地房间，再后台检测公网 IP、端口映射和外网可达性。",
    placeholder: "ws://你的公网地址:43821/?roomId=...",
    startDescription: "本机先开房，房间起来后继续检测公网直连能力。",
    joinDescription: "适合已经拿到公网可达地址的房主邀请。",
  },
  tailscale: {
    hint: "适合固定好友长期使用，优先走 MagicDNS，其次走 100.x 地址。",
    placeholder: "ws://your-name.ts.net:43821/?roomId=...",
    startDescription: "同一个 tailnet 里的好友可以稳定加入，不依赖公网端口映射。",
    joinDescription: "把房主发来的 Tailscale 地址粘贴进来即可加入。",
  },
  relay: {
    hint: "复杂网络环境下的兜底方案，优先保证能连上。",
    placeholder: "wss://relay.example.com/room?roomId=...",
    startDescription: "适合公网不通、Tailscale 不方便时的稳定兜底。",
    joinDescription: "加入地址会带上房间信息，不需要你再判断模式。",
  },
};

const getStatusLine = ({
  roomAction,
  latestFailureReason,
  latestHostEvent,
  currentMode,
  currentDirectMessage,
  relayMessage,
  tailscaleMessage,
}: {
  roomAction: string;
  latestFailureReason?: string;
  latestHostEvent?: string;
  currentMode: ConnectionMode;
  currentDirectMessage?: string;
  relayMessage?: string;
  tailscaleMessage?: string;
}) => {
  if (roomAction === "starting") {
    return "正在启动房间，本地会先进入，公网直连能力稍后补充。";
  }

  if (latestFailureReason) {
    return latestFailureReason;
  }

  if (latestHostEvent) {
    return latestHostEvent;
  }

  if (currentMode === "direct_host") {
    return currentDirectMessage || "准备检测公网直连条件。";
  }

  if (currentMode === "tailscale") {
    return tailscaleMessage || "确认 Tailscale 已连接到同一个 tailnet 后再开房。";
  }

  return relayMessage || "确认云中继地址可用后，再把地址发给队友。";
};

export const HomePage = () => {
  const {
    room,
    joinSignalUrl,
    setJoinSignalUrl,
    startHost,
    joinRoom,
    replaceInputDevice,
    copyInviteLink,
    sendChatMessage,
  } = useRoomState();
  const roomAction = useAppStore((state) => state.roomAction);
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const networkSnapshot = useSettingsStore((state) => state.networkSnapshot);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const refreshNetworkSnapshot = useSettingsStore((state) => state.refreshNetworkSnapshot);
  const hostSession = useRoomStore((state) => state.hostSession);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    toggleMute,
    setPushToTalkEnabled,
    permissionState,
  } = useAudioStore();
  const [chatInput, setChatInput] = useState("");

  if (!settings) {
    return <StartupSplashPage message="正在准备首页..." />;
  }

  const currentMode = settings.connectionMode;
  const currentModeCopy = modeCopy[currentMode];
  const currentAddress = hostSession?.signalingUrl ?? room.signalingUrl;
  const currentDirectHost = hostSession?.directHostProbe ?? networkSnapshot?.directHost;
  const relaySummary = networkSnapshot?.relay;
  const latestHostEvent = room.recentHostEvents?.[0]?.message;

  const statusLine = getStatusLine({
    roomAction,
    latestFailureReason: room.latestFailureReason,
    latestHostEvent,
    currentMode,
    currentDirectMessage: currentDirectHost?.message,
    relayMessage: relaySummary?.message,
    tailscaleMessage: tailscaleStatus?.message,
  });

  const environmentBanner = useMemo(() => {
    if (permissionState === MicPermissionState.Denied) {
      return {
        tone: "danger" as const,
        message: "还没有给上号麦克风权限，请先在 Windows 设置里允许访问麦克风。",
      };
    }

    if (inputDevices.length === 0 || outputDevices.length === 0) {
      return {
        tone: "warning" as const,
        message: "当前缺少输入或输出设备，先接好麦克风和耳机再继续。",
      };
    }

    if (tailscaleStatus?.state === TailscaleState.NotInstalled && currentMode === "tailscale") {
      return {
        tone: "warning" as const,
        message: "你现在选中了 Tailscale 模式，但这台电脑还没有安装 Tailscale。",
      };
    }

    return undefined;
  }, [currentMode, inputDevices.length, outputDevices.length, permissionState, tailscaleStatus?.state]);

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

  const handleSendChat = () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }

    void sendChatMessage(message).then(() => {
      setChatInput("");
    });
  };

  return (
    <PageContainer className="min-h-0 gap-3 overflow-hidden py-2.5">
      <div className="flex items-center gap-4" data-testid="home-status-row">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 text-sm font-medium text-[#111827]">{statusLine}</div>
          <div className="mt-1 line-clamp-1 text-xs text-[#98A2B3]">
            {currentAddress || currentModeCopy.hint}
          </div>
        </div>
        <TopStatusBar />
      </div>

      {environmentBanner ? (
        <InlineBanner tone={environmentBanner.tone}>{environmentBanner.message}</InlineBanner>
      ) : null}

      <section className="grid items-stretch gap-4 xl:grid-cols-2">
        <div
          className="flex min-h-[376px] flex-col rounded-[24px] border border-[#E7ECF2] bg-white p-4 shadow-[0_18px_40px_rgba(17,24,39,0.06)]"
          data-testid="home-action-card"
        >
          <div>
            <div className="text-[22px] font-semibold text-[#111827]">开房或加入</div>
            <p className="mt-1 text-sm text-[#667085]">先选模式，再开房或加入。</p>
          </div>

          <div className="mt-4 min-h-[84px] space-y-2">
            <div className="text-sm font-medium text-[#111827]">连接模式</div>
            <SegmentedControl
              value={currentMode}
              options={connectionModeOptions}
              onChange={handleModeChange}
            />
            <div className="line-clamp-2 text-sm text-[#667085]">{currentModeCopy.hint}</div>
          </div>

          <div className="mt-4 grid flex-1 gap-4 lg:grid-cols-2">
            <div
              className="flex min-h-[218px] flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4"
              data-testid="home-start-card"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                <Radio className="h-4 w-4 text-[#4DA3FF]" />
                开启房间
              </div>
              <div className="mt-2 min-h-[44px] text-sm text-[#667085]">
                {currentModeCopy.startDescription}
              </div>

              <div className="mt-3 min-h-[88px] rounded-[14px] border border-[#DCE8F7] bg-white px-3 py-3 text-sm text-[#667085]">
                <div className="font-medium text-[#111827]">当前状态</div>
                <div className="mt-1">
                  {currentMode === "direct_host"
                    ? currentDirectHost?.message ?? "房间会先启动，本地成功后再检测公网直连。"
                    : currentMode === "tailscale"
                      ? tailscaleStatus?.message ?? "请确认 Tailscale 已连接。"
                      : relaySummary?.message ?? "请确认云中继地址可用。"}
                </div>
              </div>

              <div className="mt-auto flex items-end gap-3 pt-5" data-testid="home-start-actions">
                <Button onClick={() => void startHost()} disabled={roomAction !== "idle"}>
                  {roomAction === "starting" ? "正在开启..." : "开启房间"}
                </Button>
                {currentAddress ? (
                  <Button variant="secondary" onClick={() => void copyInviteLink()}>
                    复制地址
                  </Button>
                ) : null}
              </div>
            </div>

            <div
              className="flex min-h-[218px] flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4"
              data-testid="home-join-card"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                <Link2 className="h-4 w-4 text-[#4DA3FF]" />
                加入房间
              </div>
              <div className="mt-2 min-h-[48px] text-sm text-[#667085]">
                {currentModeCopy.joinDescription}
              </div>

              <div className="mt-3 min-h-[88px] rounded-[14px] border border-[#DCE8F7] bg-white p-3">
                <Input
                  placeholder={currentModeCopy.placeholder}
                  value={joinSignalUrl}
                  onChange={(event) => setJoinSignalUrl(event.target.value)}
                />
              </div>

              <div className="mt-auto flex items-end gap-3 pt-5" data-testid="home-join-actions">
                <Button variant="secondary" onClick={handlePasteSignalUrl}>
                  <Clipboard className="h-4 w-4" />
                  粘贴地址
                </Button>
                <Button
                  onClick={() => void joinRoom()}
                  disabled={Boolean(roomAction !== "idle" || !joinSignalUrl.trim())}
                >
                  {roomAction === "joining" ? "正在加入..." : "立即加入"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <TemporaryChatPanel
          className="h-full"
          messages={chatMessages}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={handleSendChat}
        />
      </section>

      <div className="flex min-h-0 flex-col gap-3">
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
