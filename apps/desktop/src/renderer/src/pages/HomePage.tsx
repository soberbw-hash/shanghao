import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Mic,
  MicOff,
  Server,
} from "lucide-react";
import { gsap } from "gsap";

import {
  MicPermissionState,
  normalizeRelayServerUrl,
  type BuiltInAvatarId,
  type RelayStatusSnapshot,
} from "@private-voice/shared";

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
import { getAvatarSrc } from "../utils/profile";
import { getNicknameValidationError } from "../utils/nickname";

const isValidServerAddress = (value: string) => Boolean(normalizeRelayServerUrl(value));

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
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<RelayStatusSnapshot>();
  const reduceMotion = usePrefersReducedMotion();
  const isSettingsReady = Boolean(settings);
  const savedNickname = settings?.nickname;
  const savedAvatarId = settings?.avatarId;
  const savedServerAddress = settings?.relayServerUrl;
  const hasSavedEntry = Boolean(
    settings?.hasCompletedProfileSetup &&
    nickname.trim() &&
    isValidServerAddress(serverAddress.trim()),
  );
  const isQuickEntry = hasSavedEntry && !isEditingSetup;

  useEffect(() => {
    if (!isSettingsReady) return;
    setNickname(savedNickname ?? "");
    setAvatarId(savedAvatarId || "fox");
    setServerAddress(savedServerAddress || "");
  }, [isSettingsReady, savedAvatarId, savedNickname, savedServerAddress]);

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
          {
            autoAlpha: 1,
            y: 0,
            duration: motionDuration.message,
            ease: motionEase.standard,
          },
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
    const normalizedAddress = normalizeRelayServerUrl(serverAddress);
    const trimmedNickname = nickname.trim();
    const nicknameError = getNicknameValidationError(trimmedNickname);
    if (nicknameError) {
      pushToast({
        tone: "warning",
        title: "昵称不能这样用",
        description: nicknameError,
      });
      return;
    }

    if (!normalizedAddress) {
      pushToast({
        tone: "warning",
        title: "服务器地址不对",
        description: "可填写 IP:端口、ws:// 地址或 wss:// 域名。",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await saveSettings({
        nickname: trimmedNickname.slice(0, 16),
        avatarId,
        avatarPath: undefined,
        relayServerUrl: normalizedAddress,
        hasCompletedProfileSetup: true,
      });
      await joinChannel(normalizedAddress);
    } finally {
      setIsSubmitting(false);
    }
  };

  const testServer = async () => {
    const normalizedAddress = normalizeRelayServerUrl(serverAddress);
    if (!normalizedAddress) {
      setServerTestResult(undefined);
      pushToast({
        tone: "warning",
        title: "服务器地址不对",
        description: "可填写 IP:端口、ws:// 地址或 wss:// 域名。",
      });
      return;
    }

    setIsTestingServer(true);
    setServerTestResult(undefined);
    try {
      const result = await window.desktopApi.diagnostics.testServer(normalizedAddress);
      setServerTestResult(result);
      pushToast({
        tone: result.isReachable ? "success" : "warning",
        title: result.isReachable
          ? `服务器正常${typeof result.latencyMs === "number" ? ` · ${result.latencyMs} ms` : ""}`
          : "服务器暂时不可用",
        description: result.message,
      });
    } catch {
      setServerTestResult({
        serverUrl: normalizedAddress,
        isConfigured: true,
        isReachable: false,
        message: "测试请求失败，请稍后重试。",
      });
    } finally {
      setIsTestingServer(false);
    }
  };

  const isJoining = isSubmitting || roomAction === "joining";
  const avatarSrc = getAvatarSrc(avatarId);
  const serverTestStatus = serverTestResult ? (
    <div
      className={`entry-server-test-result ${serverTestResult.isReachable ? "success" : "danger"}`}
      role="status"
    >
      {serverTestResult.isReachable ? (
        <CircleCheck className="h-4 w-4" />
      ) : (
        <CircleAlert className="h-4 w-4" />
      )}
      <span>
        {serverTestResult.isReachable
          ? `服务器正常${typeof serverTestResult.latencyMs === "number" ? ` · ${serverTestResult.latencyMs} ms` : ""}`
          : serverTestResult.message}
      </span>
    </div>
  ) : null;

  return (
    <div
      ref={pageRef}
      className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-7"
    >
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
            <h1 className="text-[22px] font-[680] leading-[30px] tracking-[-0.02em] text-[#172033]">
              上号
            </h1>
            <div className="text-[12px] font-medium leading-4 text-[#718198]">固定好友语音</div>
          </div>
          <button
            type="button"
            onClick={() => void refreshDevices()}
            className="entry-mic-status interactive-surface ml-auto flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold text-[#60738b]"
          >
            <span className={micCopy.tone === "good" ? "text-[#18b669]" : "text-[#d18b19]"}>
              {micCopy.tone === "good" ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )}
            </span>
            {micCopy.title}
          </button>
        </header>

        {isQuickEntry ? (
          <section className="entry-ready-layout min-h-0 flex-1">
            <div
              data-gsap-entry="ready-avatar"
              className="entry-ready-avatar-stage"
              aria-hidden="true"
            >
              <span className="entry-ready-orbit entry-ready-orbit-one" />
              <span className="entry-ready-orbit entry-ready-orbit-two" />
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="entry-ready-avatar" draggable={false} />
              ) : null}
            </div>

            <div data-gsap-entry="ready-copy" className="flex min-w-0 flex-col justify-center">
              <div className="text-[13px] font-medium leading-[18px] text-[#718198]">昵称</div>
              <h2 className="mt-1 truncate text-[34px] font-[740] leading-[42px] tracking-[-0.035em] text-[#162033]">
                {nickname}
              </h2>
              <div className="entry-ready-server mt-4" title={serverAddress}>
                <span className="entry-ready-server-icon">
                  <Server className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <small>固定服务器</small>
                  <strong>{formatServerLabel(serverAddress)}</strong>
                </span>
              </div>
              {serverTestStatus}
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <Button
                  className="h-[50px] min-w-[188px] rounded-[16px] text-[15px]"
                  disabled={isJoining || !serverAddress.trim()}
                  onClick={() => void enterChannel()}
                >
                  {isJoining ? "正在进入..." : "上号"}
                  {isJoining ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="secondary"
                  className="h-[50px] rounded-[16px] px-4"
                  disabled={isTestingServer || isJoining}
                  onClick={() => void testServer()}
                >
                  {isTestingServer ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )}
                  {isTestingServer ? "测试中" : "测试服务器"}
                </Button>
              </div>
              <button
                type="button"
                className="entry-edit-button mx-auto mt-3"
                onClick={() => setIsEditingSetup(true)}
              >
                更换昵称或服务器
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
                <div className="flex">
                  <Input
                    value={nickname}
                    maxLength={16}
                    placeholder="朋友怎么叫你"
                    onChange={(event) => setNickname(event.target.value)}
                  />
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-semibold text-[#52657d]">服务器地址</span>
                <Input
                  value={serverAddress}
                  placeholder="118.25.103.107:43821"
                  onChange={(event) => {
                    setServerAddress(event.target.value);
                    setServerTestResult(undefined);
                  }}
                />
              </label>
              {serverTestStatus}
              <div className="mt-auto" data-gsap-entry="cta">
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    className="h-[52px] min-w-[188px] rounded-[16px] text-[15px]"
                    disabled={isJoining || !serverAddress.trim()}
                    onClick={() => void enterChannel()}
                  >
                    {isJoining ? "正在进入..." : "进入频道"}
                    {isJoining ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-[52px] rounded-[16px] px-4"
                    disabled={isTestingServer || isJoining || !serverAddress.trim()}
                    onClick={() => void testServer()}
                  >
                    {isTestingServer ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Activity className="h-4 w-4" />
                    )}
                    {isTestingServer ? "测试中" : "测试服务器"}
                  </Button>
                </div>
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
