import { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Music2 } from "lucide-react";
import type { ChatMessage } from "@private-voice/shared";
import { Button } from "../../src/renderer/src/components/base/Button";
import { TemporaryChatPanel } from "../../src/renderer/src/components/chat/TemporaryChatPanel";
import { ApplicationAudioPicker } from "../../src/renderer/src/components/audio/ApplicationAudioPicker";
import { ScreenSourcePicker } from "../../src/renderer/src/components/room/ScreenSourcePicker";
import { useScreenSourcePicker } from "../../src/renderer/src/features/screen-share/useScreenSourcePicker";
import {
  clearGlassPointerHighlight,
  updateGlassPointerHighlight,
} from "../../src/renderer/src/features/motion/glassPointerHighlight";
import roomArt from "../../src/renderer/src/assets/scenes/shanghao-room/environment-v3-extended.png";
import "../../src/renderer/src/styles/index.css";

const examples = [
  "房间已经开好啦。",
  "稍等，我先把语音调一下。",
  "好了，能听清。",
  "放首小曲热热场？",
  "可以，麦不用关。",
  "那我先放这首。",
  "声音刚好。",
  "打完这把再换下一首吧。",
];
const initialMessages: ChatMessage[] = Array.from({ length: 32 }, (_, index) => ({
  id: `demo-${index}`,
  peerId: index % 2 ? "local" : "friend",
  nickname: index % 2 ? "小屿" : "小川",
  content: examples[index % examples.length]!,
  createdAt: new Date(2026, 10, 19, 20, index * 6).toISOString(),
  isLocal: index % 2 === 1,
}));

function RoomEffectsFixture() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [gain, setGain] = useState(0.72);
  const [sent, setSent] = useState("");
  const [image, setImage] = useState("");
  const [screenStarted, setScreenStarted] = useState("");
  const screen = useScreenSourcePicker(
    async () => {
      setScreenStarted(
        document.querySelector(".screen-source-picker-confirm:modal") ? "visible" : "not-visible",
      );
      return [{ id: "screen:1", kind: "screen", name: "显示器", thumbnailDataUrl: "" }];
    },
    async () => {},
  );
  return (
    <main
      className="room-page"
      data-sent={sent}
      data-image={image}
      data-screen-started={screenStarted}
      style={
        {
          "--room-wallpaper": `url(${roomArt})`,
          height: "100dvh",
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(280px,360px)",
          gap: 12,
          padding: 12,
          background: `url(${roomArt}) center / cover`,
        } as CSSProperties
      }
    >
      <div
        style={{
          display: "flex",
          alignItems: "end",
          justifyContent: "space-between",
          flexDirection: "column",
        }}
      >
        <header
          className="room-topbar"
          style={{ width: "100%", padding: "10px 16px" }}
          onPointerMove={(event) =>
            updateGlassPointerHighlight(event.currentTarget, event.clientX, event.clientY)
          }
          onPointerLeave={(event) => clearGlassPointerHighlight(event.currentTarget)}
        >
          <span className="room-glass-light" aria-hidden="true" />
          <span>上号语音房</span>
        </header>
        <Button variant="secondary" onClick={() => setOpen(true)} aria-label="打开音乐演示">
          <Music2 size={16} /> 放歌
        </Button>
        <Button variant="secondary" onClick={() => void screen.openScreenSourcePicker()}>
          屏幕分享
        </Button>
      </div>
      <button
        hidden
        data-testid="confirm-chat-message"
        onClick={() =>
          setMessages((previous) => [
            ...previous.slice(0, -1),
            { ...previous.at(-1)!, id: "confirmed", deliveryState: "sent" },
          ])
        }
      />
      <TemporaryChatPanel
        messages={messages}
        chatInput={draft}
        onChatInputChange={setDraft}
        onSend={() => {
          setSent(draft);
          setMessages((previous) => [
            ...previous,
            {
              id: "pending",
              clientMessageId: "fixture-send",
              peerId: "local",
              nickname: "小屿",
              content: draft,
              isLocal: true,
              createdAt: "2026-11-19T23:30:00+08:00",
              deliveryState: "sending",
            },
          ]);
          setDraft("");
        }}
        onSendImage={async (file) => setImage(file.name)}
        canSend
      />
      <ApplicationAudioPicker
        open={open}
        sources={[{ id: "music-demo", name: "房间音乐", processName: "房间音乐.exe" }]}
        selectedId="music-demo"
        loading={false}
        busy={false}
        error=""
        sharingName={sharing ? "房间音乐" : undefined}
        gain={gain}
        onSelect={() => {}}
        onRefresh={() => {}}
        onStart={() => setSharing(true)}
        onStop={() => {
          setSharing(false);
          setOpen(false);
        }}
        onGain={setGain}
        onClose={() => setOpen(false)}
      />
      <ScreenSourcePicker
        isOpen={screen.isScreenSourcePickerOpen}
        reduceMotion={false}
        sources={screen.screenSourcePickerSources}
        status={screen.screenSourcePickerStatus}
        includeSystemAudio={screen.pendingIncludeSystemAudio}
        onIncludeSystemAudioChange={screen.setPendingIncludeSystemAudio}
        onSelect={() => screen.closeScreenSourcePicker(false)}
        onRetry={() => void screen.openScreenSourcePicker()}
        onClose={() => screen.closeScreenSourcePicker()}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<RoomEffectsFixture />);
