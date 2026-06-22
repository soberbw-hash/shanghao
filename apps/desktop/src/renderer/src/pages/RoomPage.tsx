import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Headphones, LogOut, MonitorUp, Volume2, VolumeX } from "lucide-react";
import { gsap } from "gsap";

import {
  RecordingEncoderState,
  RecordingState,
  RoomConnectionState,
  type GameDetectionSnapshot,
  type MemberActivity,
  type SceneZoneId,
} from "@private-voice/shared";

import { MuteButton } from "../components/audio/MuteButton";
import { RecordingButton } from "../components/audio/RecordingButton";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { playUiSound } from "../features/audio/uiSound";
import { chatWithLLM, shouldCallLLM, type LlmHistoryEntry } from "../features/chat/llmService";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRecordingController } from "../hooks/useRecordingController";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

const KNOCK_COOLDOWN_MS = 5_000;
const naturalActivityZones: Array<{ zone: SceneZoneId; activity: MemberActivity }> = [
  { zone: "coffeeBar", activity: "drinking" },
  { zone: "fitnessZone", activity: "fitness" },
  { zone: "restroomZone", activity: "restroom" },
  { zone: "gameDesk1", activity: "idle" },
];

export const RoomPage = () => {
  const {
    room,
    leaveRoom,
    sendChatMessage,
    sendKnock,
    replaceInputDevice,
    copyInviteLink,
    moveLocalMember,
  } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const { inputDevices, outputDevices, isMuted, isDeafened, toggleMute, toggleDeafen } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const { capability, startRecording, stopRecording } = useRecordingController();
  const pageRef = useRef<HTMLDivElement>(null);
  const voicePulseRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");
  const [isLLMLoading, setIsLLMLoading] = useState(false);
  const enteredAt = useRef(Date.now());
  const lastKnockAt = useRef(0);
  const detectedGameRef = useRef<string>();
  const moveLocalMemberRef = useRef(moveLocalMember);
  moveLocalMemberRef.current = moveLocalMember;
  const llmHistoryRef = useRef<LlmHistoryEntry[]>([]);
  const reduceMotion = usePrefersReducedMotion(settings?.reduceMotion ?? false);

  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  useLayoutEffect(() => {
    if (!pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-gsap-room]", { clearProps: "all" });
        return;
      }

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .fromTo(
          "[data-gsap-room='topbar']",
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.3 },
        )
        .fromTo(
          "[data-gsap-room='island']",
          { autoAlpha: 0, y: 10, scale: 0.985, filter: "blur(6px)" },
          { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.52, ease: "expo.out" },
          "-=0.14",
        )
        .fromTo(
          "[data-gsap-room='chat']",
          { autoAlpha: 0, x: 14 },
          { autoAlpha: 1, x: 0, duration: 0.42 },
          "-=0.38",
        )
        .fromTo(
          "[data-gsap-room='dock']",
          { autoAlpha: 0, y: 14, scale: 0.985 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.36, ease: "back.out(1.35)" },
          "-=0.24",
        );
    }, pageRef);

    return () => context.revert();
  }, [reduceMotion]);

  useLayoutEffect(() => {
    if (reduceMotion || !voicePulseRef.current) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-gsap-voice='primary']",
        { scale: 0.96 },
        { scale: 1, duration: 0.22, ease: "back.out(1.9)", overwrite: true },
      );
    }, voicePulseRef);

    return () => context.revert();
  }, [isDeafened, isMuted, reduceMotion]);

  useEffect(() => {
    void window.desktopApi.overlay.update({
      members: room.members,
      isMuted,
      isDeafened,
      connectionState: room.connectionState,
    });
  }, [isDeafened, isMuted, room.connectionState, room.members]);

  useEffect(() => {
    const applyGameDetection = (snapshot: GameDetectionSnapshot) => {
      const previousGame = detectedGameRef.current;
      detectedGameRef.current = snapshot.gameName;
      const localMember = useRoomStore.getState().room.members.find((member) => member.isLocal);
      const currentZone = localMember?.sceneZone ?? "gameDesk1";

      if (snapshot.gameName) {
        const gameZone = currentZone.startsWith("gameDesk") ? currentZone : "gameDesk1";
        moveLocalMemberRef.current(gameZone, "gaming", snapshot.gameName);
      } else if (previousGame) {
        moveLocalMemberRef.current(currentZone, "idle");
      }
    };

    void window.desktopApi.games.getSnapshot().then(applyGameDetection);
    return window.desktopApi.games.onDetected(applyGameDetection);
  }, []);

  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!detectedGameRef.current) {
          const next =
            naturalActivityZones[Math.floor(Math.random() * naturalActivityZones.length)] ??
            naturalActivityZones[3];
          if (next) moveLocalMemberRef.current(next.zone, next.activity);
        }
        schedule();
      }, 5 * 60_000 + Math.round(Math.random() * 5 * 60_000));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    await sendChatMessage(content);
    playUiSound("send-message");
    if (content === chatInput) setChatInput("");

    if (shouldCallLLM(content) && !isLLMLoading) {
      setIsLLMLoading(true);
      const { addChatMessage } = useRoomStore.getState();
      const placeholderId = "llm-thinking-" + Date.now();

      addChatMessage({
        id: placeholderId,
        peerId: "llm-assistant",
        nickname: "上号",
        content: "上号正在想…",
        createdAt: new Date().toISOString(),
        isLocal: false,
        kind: "chat",
        isBot: true,
      });

      try {
        const reply = await chatWithLLM(content, llmHistoryRef.current);
        llmHistoryRef.current.push(
          { role: "user", content },
          { role: "assistant", content: reply },
        );
        if (llmHistoryRef.current.length > 20) {
          llmHistoryRef.current.splice(0, llmHistoryRef.current.length - 20);
        }

        const { replaceChatMessage } = useRoomStore.getState();
        replaceChatMessage(placeholderId, reply);
      } catch {
        const { replaceChatMessage } = useRoomStore.getState();
        replaceChatMessage(placeholderId, "助手没接通，稍后再试。");
      } finally {
        setIsLLMLoading(false);
      }
    }
  };

  const knock = async () => {
    const remaining = KNOCK_COOLDOWN_MS - (Date.now() - lastKnockAt.current);
    if (remaining > 0) {
      pushToast({
        tone: "neutral",
        title: "刚刚已经敲过啦",
        description: `${Math.ceil(remaining / 1000)} 秒后可以再敲一次。`,
      });
      return;
    }
    lastKnockAt.current = Date.now();
    await sendKnock();
  };

  const toggleRecording = async () => {
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        await stopRecording();
        playUiSound("record-stop");
        return;
      }

      startRecording();
      playUiSound("record-start");
    } catch {
      pushToast({ tone: "danger", title: "录音失败", description: "请稍后再试。" });
    }
  };

  const leave = async () => {
    localStorage.setItem(
      "shanghao:last-session-note",
      JSON.stringify({
        people: room.memberCount,
        minutes: Math.max(1, Math.round((Date.now() - enteredAt.current) / 60_000)),
      }),
    );
    await window.desktopApi.overlay.close();
    await leaveRoom();
  };

  const switchInputDevice = async (preferredInputDeviceId?: string) => {
    await saveSettings({ preferredInputDeviceId });
    await replaceInputDevice(preferredInputDeviceId);
    playUiSound("device-switch");
    pushToast({ tone: "success", title: "麦克风已切换", description: "新的输入设备已经生效。" });
  };

  const switchOutputDevice = async (preferredOutputDeviceId?: string) => {
    await saveSettings({ preferredOutputDeviceId });
    playUiSound("device-switch");
    pushToast({ tone: "success", title: "扬声器已切换", description: "新的输出设备已经生效。" });
  };

  return (
    <div ref={pageRef} className="room-page relative flex h-full flex-col gap-2.5 overflow-hidden px-3.5 pb-3.5 pt-2">
      <div data-gsap-room="topbar">
        <TopStatusBar onKnock={() => void knock()} onInvite={() => void copyInviteLink()} />
      </div>

      <main className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.44fr)_minmax(280px,.56fr)]">
        <section data-gsap-room="island" className="island-panel min-h-0 overflow-hidden">
          <TeamIsland
            members={room.members}
            onZoneSelect={(zone, activity) => moveLocalMember(zone, activity)}
            reduceMotion={settings?.reduceMotion ?? false}
          />
        </section>
        <div data-gsap-room="chat" className="min-h-0">
          <TemporaryChatPanel
            className="h-full"
            messages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSend={() => void send()}
            onQuickSend={(message) => void send(message)}
            canSend={canSend}
            unavailableLabel="正在重连..."
            reduceMotion={settings?.reduceMotion ?? false}
          />
        </div>
      </main>

      <footer ref={voicePulseRef} data-gsap-room="dock" className="voice-dock flex items-center gap-2 px-3 py-2.5">
        <span data-gsap-voice="primary" className="inline-flex">
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
        </span>
        <Button
          variant={isDeafened ? "danger" : "ghost"}
          data-gsap-voice="primary"
          className={`voice-action-button-with-text voice-main-control ${isDeafened ? "voice-main-control-danger" : ""}`}
          onClick={toggleDeafen}
        >
          {isDeafened ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          <span className="voice-action-label">{isDeafened ? "扬声器关" : "扬声器开"}</span>
        </Button>
        <label className="device-select" title="选择麦克风">
          <Headphones className="h-4 w-4" />
          <select
            value={settings?.preferredInputDeviceId || ""}
            onChange={(event) => {
              const preferredInputDeviceId = event.target.value || undefined;
              void switchInputDevice(preferredInputDeviceId);
            }}
          >
            <option value="">默认麦克风</option>
            {inputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "麦克风"}</option>
            ))}
          </select>
        </label>
        <label className="device-select" title="选择扬声器">
          <Volume2 className="h-4 w-4" />
          <select
            value={settings?.preferredOutputDeviceId || ""}
            onChange={(event) => void switchOutputDevice(event.target.value || undefined)}
          >
            <option value="">默认扬声器</option>
            {outputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "扬声器"}</option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <RecordingButton
          isRecording={recordingStatus.state === RecordingState.Recording}
          onClick={() => void toggleRecording()}
          disabled={capability.encoderState === RecordingEncoderState.Unsupported}
        />
        <Button
          variant="ghost"
          className="voice-action-button-with-text"
          onClick={() => {
            playUiSound("popup-open");
            void window.desktopApi.overlay.toggle();
          }}
        >
          <MonitorUp className="h-4 w-4" />
          <span className="voice-action-label">悬浮窗</span>
        </Button>
        <Button
          variant="danger"
          className="voice-action-button-with-text"
          onClick={() => void leave()}
        >
          <LogOut className="h-4 w-4" />
          <span className="voice-action-label">退出</span>
        </Button>
      </footer>

    </div>
  );
};
