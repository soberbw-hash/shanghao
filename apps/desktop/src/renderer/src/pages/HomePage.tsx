import { useMemo, useState } from "react";
import { Clipboard, Link2, MessageCircle, Radio, Send, SmilePlus } from "lucide-react";

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

const emojiShortcuts = ["😀", "👍", "🎧", "🔥", "上号"];

const modeCopy: Record<
  ConnectionMode,
  {
    hint: string;
    placeholder: string;
    startDescription: string;
  }
> = {
  direct_host: {
    hint: "默认模式。会尝试公网地址、端口映射和外网可达性检测。",
    placeholder: "ws://你的公网地址:43821?roomId=...",
    startDescription: "适合已经有公网 IP、DDNS 或端口映射的网络环境。",
  },
  tailscale: {
    hint: "适合固定好友长期使用，优先走 MagicDNS，其次走 100.x 地址。",
    placeholder: "ws://your-name.ts.net:43821?roomId=...",
    startDescription: "适合同一个 tailnet 里的固定好友，稳定直接。",
  },
  relay: {
    hint: "当直连和 Tailscale 都不方便时，走云中继兜底。",
    placeholder: "wss://relay.example.com/room?roomId=...",
    startDescription: "适合复杂网络环境，优先保证能连上。",
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
    return "正在启动房间，请稍等。";
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
    return tailscaleMessage || "先确认 Tailscale 已连接到同一个 tailnet。";
  }

  return relayMessage || "先确认云中继地址可用，再开启房间。";
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
  const recentHostEvents = useRoomStore((state) => state.room.recentHostEvents);
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
    return <StartupSplashPage message="正在准备首页…" />;
  }

  const currentMode = settings.connectionMode;
  const currentModeCopy = modeCopy[currentMode];
  const currentAddress = hostSession?.signalingUrl ?? room.signalingUrl;
  const currentDirectHost = networkSnapshot?.directHost;
  const relaySummary = networkSnapshot?.relay;
  const latestHostEvent = recentHostEvents?.[0]?.message;
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

    if (networkSnapshot?.proxy?.compatibilityModeEnabled) {
      return {
        tone: "neutral" as const,
        message: networkSnapshot.proxy.message,
      };
    }

    return undefined;
  }, [
    currentMode,
    inputDevices.length,
    networkSnapshot?.proxy?.compatibilityModeEnabled,
    networkSnapshot?.proxy?.message,
    outputDevices.length,
    permissionState,
    tailscaleStatus?.state,
  ]);

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
    <PageContainer className="min-h-0 gap-3 overflow-hidden py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 text-sm text-[#667085]">
          {currentAddress ? (
            <span className="line-clamp-1">当前分享地址：{currentAddress}</span>
          ) : (
            <span>一句话上号，开房、加入和状态都在这里。</span>
          )}
        </div>
        <TopStatusBar />
      </div>

      <InlineBanner tone={room.latestFailureReason ? "danger" : "neutral"}>{statusLine}</InlineBanner>

      {environmentBanner ? (
        <InlineBanner tone={environmentBanner.tone}>{environmentBanner.message}</InlineBanner>
      ) : null}

      <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.22fr)_minmax(360px,0.78fr)]">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="rounded-[24px] border border-[#E7ECF2] bg-white p-4 shadow-[0_20px_40px_rgba(17,24,39,0.06)]">
            <div>
              <div className="text-[22px] font-semibold text-[#111827]">开房或加入</div>
              <p className="mt-1 text-sm text-[#667085]">先选模式，再开房或加入。</p>
            </div>

            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <div className="text-sm font-medium text-[#111827]">连接模式</div>
                <SegmentedControl
                  value={currentMode}
                  options={connectionModeOptions}
                  onChange={handleModeChange}
                />
                <div className="text-sm text-[#667085]">{currentModeCopy.hint}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex min-h-[228px] flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                    <Radio className="h-4 w-4 text-[#4DA3FF]" />
                    开启房间
                  </div>
                  <div className="mt-2 text-sm text-[#667085]">{currentModeCopy.startDescription}</div>

                  {currentMode === "direct_host" ? (
                    <div className="mt-3 rounded-[14px] border border-[#DCE8F7] bg-white px-3 py-3 text-sm text-[#667085]">
                      <div className="font-medium text-[#111827]">直连探测</div>
                      <div className="mt-1">
                        {currentDirectHost?.message ?? "还没有可用的公网直连地址。"}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-auto flex items-end gap-3 pt-5">
                    <Button onClick={() => void startHost()} disabled={roomAction !== "idle"}>
                      {roomAction === "starting" ? "正在开启…" : "开启房间"}
                    </Button>
                    {currentAddress ? (
                      <Button variant="secondary" onClick={() => void copyInviteLink()}>
                        复制地址
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-[228px] flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
                    <Link2 className="h-4 w-4 text-[#4DA3FF]" />
                    加入房间
                  </div>
                  <div className="mt-2 text-sm text-[#667085]">
                    模式会写进邀请地址里，加入前仍会显示当前选中的模式。
                  </div>

                  <div className="mt-4 space-y-3">
                    <Input
                      placeholder={currentModeCopy.placeholder}
                      value={joinSignalUrl}
                      onChange={(event) => setJoinSignalUrl(event.target.value)}
                    />
                  </div>

                  <div className="mt-auto flex items-end gap-3 pt-5">
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

          <div className="flex min-h-0 flex-col gap-3">
            <div className="text-sm font-medium text-[#667085]">开黑位</div>
            <MemberGrid
              members={room.members}
              onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-[#E7ECF2] bg-white p-4 shadow-[0_20px_40px_rgba(17,24,39,0.06)]">
            <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
              <MessageCircle className="h-4 w-4 text-[#4DA3FF]" />
              临时聊天
            </div>
            <div className="mt-2 text-sm text-[#667085]">只发文字和 emoji，不抢语音主流程。</div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-3">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {chatMessages.length === 0 ? (
                  <div className="flex h-full min-h-[180px] items-center justify-center rounded-[16px] border border-dashed border-[#D6DEE8] bg-white px-4 text-center text-sm text-[#98A2B3]">
                    房间里还没有消息。进房后可以先发一句“上号”试试。
                  </div>
                ) : (
                  chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`max-w-[88%] rounded-[16px] px-3 py-2 text-sm shadow-[0_4px_12px_rgba(17,24,39,0.04)] ${
                        message.isLocal
                          ? "ml-auto bg-[#4DA3FF] text-white"
                          : "bg-white text-[#111827]"
                      }`}
                    >
                      <div
                        className={`text-[11px] ${
                          message.isLocal ? "text-white/80" : "text-[#98A2B3]"
                        }`}
                      >
                        {message.nickname}
                      </div>
                      <div className="mt-1 break-words leading-6">{message.content}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {emojiShortcuts.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded-full border border-[#E7ECF2] bg-white px-3 py-1 text-sm text-[#667085] transition hover:border-[#C7D7EB] hover:text-[#111827]"
                    onClick={() => setChatInput((value) => `${value}${emoji}`)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="relative flex-1">
                  <SmilePlus className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
                  <Input
                    className="pl-10"
                    placeholder="发一句话，或者来个 emoji"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleSendChat();
                      }
                    }}
                  />
                </div>
                <Button onClick={handleSendChat} disabled={!chatInput.trim()}>
                  <Send className="h-4 w-4" />
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

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
