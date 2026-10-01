import { createRoot } from "react-dom/client";
import { useState } from "react";
import "@fontsource-variable/noto-sans-sc";
import {
  RoomLifecycleState,
  RoomConnectionState,
  QUICK_MESSAGE_PRESETS,
} from "@private-voice/shared";
import { QuickMessageRow } from "../../src/renderer/src/components/chat/QuickMessageRow";
import { GameMonitorContent } from "../../src/renderer/src/components/room/GameMonitorContent";
import { SceneCharacterLabel } from "../../src/renderer/src/components/room/SceneCharacterLabel";
import { TopStatusBar } from "../../src/renderer/src/components/layout/TopStatusBar";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useLocalInputRecovery } from "../../src/renderer/src/features/audio/useLocalInputRecovery";
import { MICROPHONE_INPUT_LOST } from "../../src/renderer/src/features/audio/microphoneInputLoss";
import {
  playQuickMessageSound,
  stopQuickMessageMusic,
  getQuickMessageAudioSnapshot,
} from "../../src/renderer/src/features/audio/quickMessageAudio";
import "../../src/renderer/src/styles/index.css";

const roomState = useRoomStore.getState();
const member = {
  ...roomState.room.members[0]!,
  id: "test-member",
  nickname: "Sober 测试",
  activity: "idle" as const,
  presenceState: "online" as const,
  isEmptySlot: false,
  isLocal: true,
};
roomState.setRoom({
  ...roomState.room,
  roomName: "让子弹飞",
  lifecycleState: RoomLifecycleState.Open,
  connectionState: RoomConnectionState.WaitingPeer,
  members: [member],
});
const stream = new MediaStream();
useRoomStore.setState({ localStream: stream, connectionState: RoomConnectionState.WaitingPeer });
const labels = [
  "出泪小曲",
  "出心小曲",
  "得吃小曲",
  "难得真兄弟",
  "卡特小曲",
  "翻译",
  "回手掏",
  "GG WP",
  "等我一下",
  "🎮上号",
];
const items = labels.map((label, i) => ({
  preset: { ...QUICK_MESSAGE_PRESETS[0]!, id: `test-${i}`, label, content: label },
  enabled: true,
  shortcut: "",
}));
let repairs = 0;
let finishRepair: (() => void) | undefined;
const review = {
  lose: () => window.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: stream })),
  stale: () =>
    window.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: new MediaStream() })),
  swapOwner: () => useRoomStore.setState({ localStream: new MediaStream() }),
  finish: () => finishRepair?.(),
  repairs: () => repairs,
  async musicStops() {
    const originalAudio = window.Audio,
      originalFetch = window.fetch;
    let plays = 0,
      pauses = 0,
      finish!: () => void;
    class AudioProbe extends EventTarget {
      preload = "";
      volume = 0;
      currentTime = 0;
      src = "";
      load() {}
      pause() {
        pauses++;
      }
      play() {
        plays++;
        return Promise.resolve();
      }
    }
    try {
      window.Audio = AudioProbe as unknown as typeof Audio;
      window.fetch = () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(new Response(new Uint8Array([1, 2])));
        });
      const sound = QUICK_MESSAGE_PRESETS.find((preset) => preset.mediaType === "music")!.soundId;
      playQuickMessageSound(sound, "fox", 0.1, "测试", "music");
      stopQuickMessageMusic();
      finish();
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (plays !== 0 || getQuickMessageAudioSnapshot().status !== "idle")
        throw new Error("late music restarted");
      window.fetch = async () => new Response(new Uint8Array([1, 2]));
      playQuickMessageSound(sound, "fox", 0.1, "测试", "music");
      await new Promise((resolve) => setTimeout(resolve, 50));
      stopQuickMessageMusic();
      return { plays, pauses, status: getQuickMessageAudioSnapshot().status };
    } finally {
      stopQuickMessageMusic();
      window.Audio = originalAudio;
      window.fetch = originalFetch;
    }
  },
};
Object.assign(window, { review });
const Review = () => {
  const [width, setWidth] = useState(460);
  useLocalInputRecovery(stream, () => {
    repairs++;
    return new Promise<boolean>((resolve) => {
      finishRepair = () => resolve(false);
    });
  });
  return (
    <main style={{ padding: 24, background: "#e7f1fb", minHeight: "100vh", color: "#425976" }}>
      <TopStatusBar onChooseRoom={() => {}} />
      <h2>快捷消息：整项分页</h2>
      <select
        aria-label="测试宽度"
        value={width}
        onChange={(event) => setWidth(Number(event.target.value))}
      >
        {[180, 300, 460, 640].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <div className="chat-quick-actions" style={{ width, margin: "14px 0" }}>
        <QuickMessageRow
          items={items}
          music
          canSend
          coolingDown={false}
          status="idle"
          onSend={() => {}}
        />
      </div>
      <div style={{ display: "flex", gap: 12, margin: "20px 0", height: 85 }}>
        <div
          style={
            {
              "--character-scale": 0.42,
              position: "relative",
              width: 104,
              height: 104,
              transform: "scale(.42)",
              transformOrigin: "center top",
            } as React.CSSProperties
          }
        >
          <SceneCharacterLabel member={member} isAway />
        </div>
      </div>
      <h2>游戏屏幕插画</h2>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", width: 860 }}>
        {[
          "英雄联盟",
          "无畏契约",
          "星露谷物语",
          "火箭联盟",
          "黑神话：悟空",
          "漫威争锋",
          "R.E.P.O.",
          "GTA V",
        ].map((gameName) => (
          <div key={gameName} style={{ width: 180 }}>
            <span>{gameName}</span>
            <div
              style={{
                position: "relative",
                width: 180,
                height: 112,
                overflow: "hidden",
                borderRadius: 9,
                marginTop: 6,
              }}
            >
              <GameMonitorContent gameName={gameName} />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Review />);
