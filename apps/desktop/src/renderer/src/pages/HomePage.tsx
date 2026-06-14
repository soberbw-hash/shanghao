import { useEffect, useState } from "react";
import { ArrowRight, Dices, Mic, MicOff, Settings2, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

import { MicPermissionState, type BuiltInAvatarId } from "@private-voice/shared";

import { BrandMark } from "../components/brand/BrandMark";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { AvatarPicker } from "../components/profile/AvatarPicker";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { randomAvatarId, randomNickname } from "../utils/profile";

type SessionNote = {
  people: number;
  minutes: number;
};

export const HomePage = () => {
  const { joinChannel } = useRoomState();
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const roomAction = useAppStore((state) => state.roomAction);
  const navigate = useAppStore((state) => state.navigate);
  const permissionState = useAudioStore((state) => state.permissionState);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [channelCode, setChannelCode] = useState("");
  const [sessionNote, setSessionNote] = useState<SessionNote>();

  useEffect(() => {
    if (!settings) return;
    setNickname(settings.nickname || randomNickname());
    setAvatarId(settings.avatarId || randomAvatarId());
    setChannelCode(settings.channelAccessCode || "");
    const stored = localStorage.getItem("shanghao:last-session-note");
    if (stored) {
      try {
        setSessionNote(JSON.parse(stored) as SessionNote);
      } catch {
        setSessionNote(undefined);
      }
    }
  }, [settings]);

  if (!settings) {
    return <StartupSplashPage message="正在准备开黑频道…" />;
  }

  const micCopy =
    permissionState === MicPermissionState.Denied
      ? { title: "没有权限", detail: "请允许麦克风权限", tone: "bad" }
      : inputDevices.length === 0
        ? { title: "听不到你", detail: "没有找到可用麦克风", tone: "warn" }
        : { title: "麦克风正常", detail: inputDevices[0]?.label || "已经准备好", tone: "good" };

  const enterChannel = async () => {
    const nextNickname = nickname.trim() || randomNickname();
    await saveSettings({
      nickname: nextNickname.slice(0, 24),
      avatarId,
      avatarPath: undefined,
      channelAccessCode: channelCode.trim(),
      hasCompletedProfileSetup: true,
    });
    await joinChannel();
  };

  return (
    <div className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="entry-card relative z-10 grid w-full max-w-[1080px] gap-8 p-7 lg:grid-cols-[0.78fr_1.22fr] lg:p-10"
      >
        <section className="flex flex-col justify-between rounded-[30px] border border-white/80 bg-white/45 p-7">
          <div>
            <BrandMark size="lg" />
            <div className="mt-7 text-xs font-semibold tracking-[0.2em] text-[#7c91ad]">SHANGHAO</div>
            <h1 className="mt-2 text-[38px] font-[740] tracking-[-0.055em] text-[#111827]">进入开黑频道</h1>
            <p className="mt-3 max-w-[360px] text-[15px] leading-7 text-[#667085]">
              朋友说一句上号，打开软件就能碰面。
            </p>
          </div>

          <div className="mt-9 space-y-3">
            <button
              type="button"
              onClick={() => void refreshDevices()}
              className="flex w-full items-center gap-3 rounded-[20px] border border-white/90 bg-white/75 p-4 text-left shadow-[0_12px_34px_rgba(43,68,108,.08)]"
            >
              <span className={`grid h-10 w-10 place-items-center rounded-full bg-white ${micCopy.tone === "good" ? "text-[#18b669]" : "text-[#d18b19]"}`}>
                {micCopy.tone === "good" ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#243247]">{micCopy.title}</span>
                <span className="mt-0.5 block truncate text-xs text-[#8390a3]">{micCopy.detail}</span>
              </span>
            </button>
            <div className="flex items-center gap-2 text-xs text-[#7b8da4]">
              <ShieldCheck className="h-4 w-4 text-[#18b669]" />
              资料和频道码只保存在你的电脑里
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#243247]">选一个朋友认得出的你</div>
              <div className="mt-1 text-xs text-[#8a97a9]">轻轻选好，之后也能在设置里改。</div>
            </div>
            <Button variant="ghost" onClick={() => navigate("settings")}>
              <Settings2 className="h-4 w-4" />
              设置
            </Button>
          </div>

          <div className="mt-5">
            <AvatarPicker value={avatarId} onChange={setAvatarId} />
          </div>

          <div className="mt-6 grid gap-4">
            <label className="space-y-2">
              <span className="text-xs font-semibold text-[#52657d]">昵称</span>
              <div className="flex gap-2">
                <Input value={nickname} maxLength={24} placeholder="朋友怎么叫你" onChange={(event) => setNickname(event.target.value)} />
                <Button variant="secondary" className="shrink-0" onClick={() => setNickname(randomNickname())}>
                  <Dices className="h-4 w-4" />
                  随机
                </Button>
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold text-[#52657d]">频道码</span>
              <Input
                value={channelCode}
                type="password"
                placeholder="问下朋友，再填到这里"
                onChange={(event) => setChannelCode(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-auto pt-7">
            <Button
              isFullWidth
              className="h-[52px] rounded-[18px] text-[15px]"
              disabled={roomAction === "joining"}
              onClick={() => void enterChannel()}
            >
              {roomAction === "joining" ? "正在回来…" : "进入频道"}
              <ArrowRight className="h-4 w-4" />
            </Button>
            {sessionNote ? (
              <div className="mt-4 rounded-[18px] border border-white/90 bg-white/62 px-4 py-3 text-center text-xs text-[#74869c]">
                今天的小纸条 · 今晚 {sessionNote.people} 人在线 · 聊了 {sessionNote.minutes} 分钟
              </div>
            ) : null}
          </div>
        </section>
      </motion.div>
    </div>
  );
};
