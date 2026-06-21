import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Dices, Mic, MicOff } from "lucide-react";
import { gsap } from "gsap";

import { MicPermissionState, type BuiltInAvatarId } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { BrandMark } from "../components/brand/BrandMark";
import { CharacterPicker } from "../components/profile/AvatarPicker";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { randomAvatarId, randomNickname } from "../utils/profile";

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
  const pageRef = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [serverAddress, setServerAddress] = useState("");
  const reduceMotion = usePrefersReducedMotion(settings?.reduceMotion ?? false);

  useEffect(() => {
    if (!settings) return;
    setNickname(settings.nickname || randomNickname());
    setAvatarId(settings.avatarId || randomAvatarId());
    setServerAddress(settings.relayServerUrl || "");
  }, [settings]);

  useLayoutEffect(() => {
    if (!settings || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-gsap-entry]", { clearProps: "all" });
        return;
      }

      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .fromTo(
          "[data-gsap-entry='card']",
          { autoAlpha: 0, y: 22, scale: 0.965, filter: "blur(8px)" },
          { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.58 },
        )
        .fromTo(
          "[data-gsap-entry='brand']",
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.28 },
          "-=0.34",
        )
        .fromTo(
          "[data-gsap-entry='role-picker']",
          { autoAlpha: 0, x: -18 },
          { autoAlpha: 1, x: 0, duration: 0.42 },
          "-=0.18",
        )
        .fromTo(
          "[data-gsap-entry='form'] > *",
          { autoAlpha: 0, x: 18 },
          { autoAlpha: 1, x: 0, duration: 0.34, stagger: 0.055 },
          "-=0.34",
        )
        .fromTo(
          "[data-gsap-entry='cta']",
          { scale: 0.96 },
          { scale: 1, duration: 0.32, ease: "back.out(1.7)" },
          "-=0.12",
        );
    }, pageRef);

    return () => context.revert();
  }, [reduceMotion, settings]);

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
    <div ref={pageRef} className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-7">
      <main
        data-gsap-entry="card"
        className="entry-card relative z-10 flex w-full max-w-[900px] flex-col px-9 py-8"
      >
        <header
          data-gsap-entry="brand"
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
        </header>

        <section
          className="mt-6 grid min-h-0 flex-1 gap-7 md:grid-cols-[1.05fr_.95fr]"
        >
          <div data-gsap-entry="role-picker" className="p-2">
            <div className="mb-4 text-sm font-semibold text-[#314158]">选择角色</div>
            <CharacterPicker value={avatarId} onChange={setAvatarId} />
          </div>

          <div data-gsap-entry="form" className="flex min-w-0 flex-col gap-5">
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
                placeholder="ws://你的服务器地址:端口"
                onChange={(event) => setServerAddress(event.target.value)}
              />
            </label>
            <div className="mt-auto" data-gsap-entry="cta">
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
        </section>
      </main>
    </div>
  );
};
