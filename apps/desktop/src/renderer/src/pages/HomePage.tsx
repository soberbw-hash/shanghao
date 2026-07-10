import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Dices,
  Mic,
  MicOff,
  Server,
  Sparkles,
} from "lucide-react";
import { gsap } from "gsap";

import { MicPermissionState, type BuiltInAvatarId } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { BrandMark } from "../components/brand/BrandMark";
import { CharacterPicker } from "../components/profile/AvatarPicker";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { getAvatarSrc, randomNickname } from "../utils/profile";

const isValidServerAddress = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
};

const formatServerLabel = (value: string): string => {
  try {
    const url = new URL(value);
    return url.host || value;
  } catch {
    return value;
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingSetup, setIsEditingSetup] = useState(false);
  const reduceMotion = usePrefersReducedMotion(settings?.reduceMotion ?? false);
  const isSettingsReady = Boolean(settings);
  const hasSavedEntry = Boolean(
    settings?.hasCompletedProfileSetup &&
      nickname.trim() &&
      isValidServerAddress(serverAddress.trim()),
  );
  const isQuickEntry = hasSavedEntry && !isEditingSetup;

  useEffect(() => {
    if (!settings) return;
    setNickname(settings.nickname);
    setAvatarId(settings.avatarId || "fox");
    setServerAddress(settings.relayServerUrl || "");
  }, [settings?.avatarId, settings?.nickname, settings?.relayServerUrl]);

  useLayoutEffect(() => {
    if (!isSettingsReady || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-gsap-entry]", { clearProps: "all" });
        return;
      }

      const targets = "[data-gsap-entry]";
      const timeline = gsap.timeline({
        defaults: { ease: motionEase.spatial, force3D: true },
        onComplete: () => gsap.set(targets, { clearProps: "willChange" }),
      });
      timeline
        .set(targets, { willChange: "transform,opacity" })
        .fromTo(
          "[data-gsap-entry='card']",
          { autoAlpha: 0, y: 16, scale: 0.978 },
          { autoAlpha: 1, y: 0, scale: 1, duration: motionDuration.page },
        )
        .fromTo(
          "[data-gsap-entry='brand']",
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.28, ease: motionEase.standard },
          "-=0.34",
        );

      if (isQuickEntry) {
        timeline
          .fromTo(
            "[data-gsap-entry='ready-avatar']",
            { autoAlpha: 0, x: -16, scale: 0.94 },
            {
              autoAlpha: 1,
              x: 0,
              scale: 1,
              duration: motionDuration.panel,
              ease: motionEase.spatial,
            },
            "-=0.18",
          )
          .fromTo(
            "[data-gsap-entry='ready-copy'] > *",
            { autoAlpha: 0, x: 14 },
            {
              autoAlpha: 1,
              x: 0,
              duration: motionDuration.panel,
              stagger: 0.035,
              ease: motionEase.spatial,
            },
            "-=0.2",
          );
      } else {
        timeline
          .fromTo(
            "[data-gsap-entry='role-picker']",
            { autoAlpha: 0, x: -18 },
            { autoAlpha: 1, x: 0, duration: motionDuration.panel, ease: motionEase.spatial },
            "-=0.18",
          )
          .fromTo(
            "[data-gsap-entry='form'] > *",
            { autoAlpha: 0, x: 18 },
            {
              autoAlpha: 1,
              x: 0,
              duration: motionDuration.panel,
              stagger: 0.04,
              ease: motionEase.spatial,
            },
            "-=0.24",
          );
      }
    }, pageRef);

    return () => context.revert();
  }, [isQuickEntry, isSettingsReady, reduceMotion]);

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
    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      pushToast({
        tone: "warning",
        title: "先填一个昵称",
        description: "朋友需要靠昵称认出你。",
      });
      return;
    }

    if (!isValidServerAddress(trimmedAddress)) {
      pushToast({
        tone: "warning",
        title: "服务器地址不对",
        description: "请检查后再试，地址应以 ws:// 或 wss:// 开头。",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await saveSettings({
        nickname: trimmedNickname.slice(0, 24),
        avatarId,
        avatarPath: undefined,
        relayServerUrl: trimmedAddress,
        hasCompletedProfileSetup: true,
      });
      await joinChannel(trimmedAddress);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isJoining = isSubmitting || roomAction === "joining";
  const avatarSrc = getAvatarSrc(avatarId);

  return (
    <div ref={pageRef} className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-7">
      <main
        data-gsap-entry="card"
        className={`entry-card relative z-10 flex w-full flex-col px-9 py-8 ${
          isQuickEntry ? "entry-card-ready max-w-[760px]" : "max-w-[900px]"
        }`}
      >
        <header
          data-gsap-entry="brand"
          className="flex items-center gap-3.5 border-b border-[rgba(214,225,239,.68)] pb-5"
        >
          <BrandMark size={isQuickEntry ? "md" : "lg"} />
          <div>
            {isQuickEntry ? (
              <>
                <div className="entry-eyebrow">固定频道已准备好</div>
                <h1 className="mt-0.5 text-[26px] font-[720] tracking-[-0.035em] text-[#172033]">
                  今晚也一起？
                </h1>
              </>
            ) : (
              <>
                <h1 className="text-[30px] font-[720] tracking-[-0.035em] text-[#172033]">进入开黑频道</h1>
                <div className="mt-1 text-xs font-semibold tracking-[0.24em] text-[#9aa7b8]">SHANGHAO</div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => void refreshDevices()}
            className="entry-mic-status interactive-surface ml-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold text-[#60738b]"
          >
            <span className={micCopy.tone === "good" ? "text-[#18b669]" : "text-[#d18b19]"}>
              {micCopy.tone === "good" ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </span>
            {micCopy.title}
          </button>
        </header>

        {isQuickEntry ? (
          <section className="entry-ready-layout min-h-0 flex-1">
            <div data-gsap-entry="ready-avatar" className="entry-ready-avatar-stage" aria-hidden="true">
              <span className="entry-ready-orbit entry-ready-orbit-one" />
              <span className="entry-ready-orbit entry-ready-orbit-two" />
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="entry-ready-avatar" draggable={false} />
              ) : null}
            </div>

            <div data-gsap-entry="ready-copy" className="flex min-w-0 flex-col justify-center">
              <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[rgba(77,163,255,.1)] px-2.5 py-1 text-[11px] font-semibold text-[#2f6fcc]">
                <Sparkles className="h-3 w-3" />
                欢迎回来
              </div>
              <h2 className="mt-3 truncate text-[34px] font-[740] tracking-[-0.045em] text-[#162033]">
                {nickname}
              </h2>
              <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[#718198]">
                身份和固定频道都记住了。点一下就能回到朋友身边。
              </p>
              <div className="entry-ready-server mt-5">
                <span className="entry-ready-server-icon"><Server className="h-4 w-4" /></span>
                <span className="min-w-0">
                  <small>固定服务器</small>
                  <strong>{formatServerLabel(serverAddress)}</strong>
                </span>
              </div>
              <Button
                isFullWidth
                className="mt-6 h-[54px] rounded-[18px] text-[15px]"
                disabled={isJoining || !serverAddress.trim()}
                onClick={() => void enterChannel()}
              >
                {isJoining ? "正在回到频道..." : "上号"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <button
                type="button"
                className="entry-edit-button mx-auto mt-3"
                onClick={() => setIsEditingSetup(true)}
              >
                更换身份或服务器
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>
        ) : (
          <section className="mt-6 grid min-h-0 flex-1 gap-7 md:grid-cols-[1.05fr_.95fr]">
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
                  disabled={isJoining || !serverAddress.trim()}
                  onClick={() => void enterChannel()}
                >
                  {isJoining ? "正在进入..." : "进入频道"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                {hasSavedEntry ? (
                  <button
                    type="button"
                    className="entry-edit-button mx-auto mt-3"
                    onClick={() => setIsEditingSetup(false)}
                  >
                    返回快捷入口
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
