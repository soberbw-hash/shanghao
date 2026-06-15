import { useEffect, useState } from "react";
import { ArrowRight, Dices, Mic, MicOff } from "lucide-react";
import { motion } from "framer-motion";

import { MicPermissionState, type BuiltInAvatarId } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { BrandMark } from "../components/brand/BrandMark";
import { CharacterPicker } from "../components/profile/AvatarPicker";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { randomAvatarId, randomNickname } from "../utils/profile";

const DEFAULT_SERVER_ADDRESS = "ws://118.25.103.107:43821";

const isValidServerAddress = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
};

export const HomePage = () => {
  const { joinChannel } = useRoomState();
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const roomAction = useAppStore((state) => state.roomAction);
  const pushToast = useAppStore((state) => state.pushToast);
  const permissionState = useAudioStore((state) => state.permissionState);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [serverAddress, setServerAddress] = useState(DEFAULT_SERVER_ADDRESS);

  useEffect(() => {
    if (!settings) return;
    setNickname(settings.nickname || randomNickname());
    setAvatarId(settings.avatarId || randomAvatarId());
    setServerAddress(settings.relayServerUrl || DEFAULT_SERVER_ADDRESS);
  }, [settings]);

  if (!settings) {
    return <StartupSplashPage message="正在准备开黑频道..." />;
  }

  const micCopy =
    permissionState === MicPermissionState.Denied
      ? { title: "没有权限", tone: "bad" }
      : inputDevices.length === 0
        ? { title: "听不到你", tone: "warn" }
        : { title: "麦克风正常", tone: "good" };

  const enterChannel = async () => {
    const trimmedAddress = serverAddress.trim();
    if (!isValidServerAddress(trimmedAddress)) {
      pushToast({
        tone: "warning",
        title: "服务器地址不对",
        description: "请检查后再试，地址应以 ws:// 或 wss:// 开头。",
      });
      return;
    }

    await saveSettings({
      nickname: (nickname.trim() || randomNickname()).slice(0, 24),
      avatarId,
      avatarPath: undefined,
      relayServerUrl: trimmedAddress,
      hasCompletedProfileSetup: true,
    });
    await joinChannel(trimmedAddress);
  };

  return (
    <div className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-7">
      <motion.main
        initial={{ opacity: 0, scale: 0.97, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="entry-card relative z-10 flex w-full max-w-[900px] flex-col px-9 py-8"
      >
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-4 border-b border-[#e9eef5] pb-5"
        >
          <BrandMark size="lg" />
          <div>
            <h1 className="text-[32px] font-[720] tracking-[0.035em] text-[#172033]">进入开黑频道</h1>
            <div className="mt-1 text-xs font-semibold tracking-[0.24em] text-[#9aa7b8]">SHANGHAO</div>
          </div>
          <button
            type="button"
            onClick={() => void refreshDevices()}
            className="interactive-surface ml-auto flex items-center gap-2 rounded-full border border-[#e4eaf2] bg-white px-3.5 py-2 text-xs font-semibold text-[#60738b]"
          >
            <span className={micCopy.tone === "good" ? "text-[#18b669]" : "text-[#d18b19]"}>
              {micCopy.tone === "good" ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </span>
            {micCopy.title}
          </button>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 grid min-h-0 flex-1 gap-7 md:grid-cols-[1.05fr_.95fr]"
        >
          <div className="p-2">
            <div className="mb-4 text-sm font-semibold text-[#314158]">选择角色</div>
            <CharacterPicker value={avatarId} onChange={setAvatarId} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <label className="space-y-2">
              <span className="text-xs font-semibold text-[#52657d]">昵称</span>
              <div className="flex gap-2">
                <Input
                  value={nickname}
                  maxLength={24}
                  placeholder="朋友怎么叫你"
                  onChange={(event) => setNickname(event.target.value)}
                />
                <Button variant="secondary" className="shrink-0" onClick={() => setNickname(randomNickname())}>
                  <Dices className="h-4 w-4" />
                  随机
                </Button>
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold text-[#52657d]">服务器地址</span>
              <Input
                value={serverAddress}
                placeholder="ws://118.25.103.107:43821"
                onChange={(event) => setServerAddress(event.target.value)}
              />
            </label>
            <div className="mt-auto">
              <Button
                isFullWidth
                className="h-[52px] rounded-[18px] text-[15px]"
                disabled={roomAction === "joining" || !serverAddress.trim()}
                onClick={() => void enterChannel()}
              >
                {roomAction === "joining" ? "正在进入..." : "进入频道"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.section>
      </motion.main>
    </div>
  );
};
