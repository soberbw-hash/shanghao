import { useRef, useState } from "react";
import { Headphones, LogOut, MonitorUp, Volume2 } from "lucide-react";

import { RoomConnectionState } from "@private-voice/shared";

import { MuteButton } from "../components/audio/MuteButton";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { FloatingBuddyBar } from "../components/room/FloatingBuddyBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

const shortDeviceName = (value?: string) => {
  if (!value) return "默认设备";
  return value.replace(/\s*\([^)]*\)\s*$/, "").slice(0, 24);
};

export const RoomPage = () => {
  const { room, leaveRoom, sendChatMessage } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const { inputDevices, outputDevices, isMuted, toggleMute } = useAudioStore();
  const [chatInput, setChatInput] = useState("");
  const [showBuddyBar, setShowBuddyBar] = useState(Boolean(settings?.showFloatingBarOnJoin));
  const enteredAt = useRef(Date.now());

  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    await sendChatMessage(content);
    if (content === chatInput) setChatInput("");
  };

  const invite = async () => {
    await navigator.clipboard.writeText("上号，进开黑频道！");
    pushToast({ tone: "success", title: "邀请话已经复制", description: "发给朋友，叫他打开上号进入频道。" });
  };

  const leave = async () => {
    localStorage.setItem(
      "shanghao:last-session-note",
      JSON.stringify({
        people: room.memberCount,
        minutes: Math.max(1, Math.round((Date.now() - enteredAt.current) / 60_000)),
      }),
    );
    await leaveRoom();
  };

  return (
    <div className="room-page relative flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-2">
      <TopStatusBar onKnock={() => void send("上号？")} onInvite={() => void invite()} />

      <main className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[1.38fr_.62fr]">
        <section className="island-panel min-h-0 overflow-hidden">
          <TeamIsland members={room.members} />
        </section>
        <TemporaryChatPanel
          className="h-full"
          messages={chatMessages}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={() => void send()}
          onQuickSend={(message) => void send(message)}
          canSend={canSend}
          unavailableLabel="正在回来…"
        />
      </main>

      <footer className="voice-dock flex items-center gap-3 px-4 py-3">
        <MuteButton isMuted={isMuted} onClick={toggleMute} />
        <div className="hidden min-w-0 flex-1 items-center gap-5 md:flex">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[#71849b]">
            <Headphones className="h-4 w-4 shrink-0" />
            <span className="truncate">{shortDeviceName(inputDevices.find((device) => device.id === settings?.preferredInputDeviceId)?.label || inputDevices[0]?.label)}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-[#71849b]">
            <Volume2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{shortDeviceName(outputDevices.find((device) => device.id === settings?.preferredOutputDeviceId)?.label || outputDevices[0]?.label)}</span>
          </div>
        </div>
        <Button variant="ghost" className="whitespace-nowrap" onClick={() => setShowBuddyBar((value) => !value)}>
          <MonitorUp className="h-4 w-4" />
          悬浮小窗
        </Button>
        <Button variant="danger" className="whitespace-nowrap" onClick={() => void leave()}>
          <LogOut className="h-4 w-4" />
          退出频道
        </Button>
      </footer>

      {showBuddyBar ? <FloatingBuddyBar members={room.members} isMuted={isMuted} onClose={() => setShowBuddyBar(false)} /> : null}
    </div>
  );
};
