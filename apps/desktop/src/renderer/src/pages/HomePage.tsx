import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Mic,
  MicOff,
} from "lucide-react";
import { motion } from "framer-motion";
import { gsap } from "gsap";

import {
  MicPermissionState,
  normalizeRelayServerUrl,
  type BuiltInAvatarId,
  type RelayStatusSnapshot,
} from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { Switch } from "../components/base/Switch";
import { BrandMark } from "../components/brand/BrandMark";
import { CharacterPicker } from "../components/profile/AvatarPicker";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { motionCurve, motionDuration, motionEase } from "../features/motion/motionSystem";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { requestMicrophoneStream } from "@private-voice/webrtc";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { getNicknameValidationError } from "../utils/nickname";

const SERVER_CHECK_HEALTHY_INTERVAL_MS = 45_000;
const SERVER_CHECK_RETRY_INTERVALS_MS = [5_000, 15_000, 30_000, 60_000] as const;
const getServerCheckRetryInterval = (retryIndex: number): number =>
  SERVER_CHECK_RETRY_INTERVALS_MS[
    Math.min(retryIndex, SERVER_CHECK_RETRY_INTERVALS_MS.length - 1)
  ] ?? 60_000;
let hasPlayedHomeEntrance = false;

export const HomePage = () => {
  const { joinChannel } = useRoomState();
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const roomAction = useAppStore((state) => state.roomAction);
  const pushToast = useAppStore((state) => state.pushToast);
  const permissionState = useAudioStore((state) => state.permissionState);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const setMuted = useAudioStore((state) => state.setMuted);
  const pageRef = useRef<HTMLDivElement>(null);
  const hasAttemptedStartupJoinRef = useRef(false);
  const microphoneSelectRef = useRef<HTMLSelectElement>(null);
  const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState<BuiltInAvatarId>("fox");
  const [serverAddress, setServerAddress] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<RelayStatusSnapshot>();
  const [isCheckingAudio, setIsCheckingAudio] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  const isSettingsReady = Boolean(settings);
  const savedNickname = settings?.nickname;
  const savedAvatarId = settings?.avatarId;
  const savedServerAddress = settings?.relayServerUrl;

  useEffect(() => {
    if (!isSettingsReady) return;
    setNickname(savedNickname ?? "");
    setAvatarId(savedAvatarId || "fox");
    setServerAddress(savedServerAddress || "");
  }, [isSettingsReady, savedAvatarId, savedNickname, savedServerAddress]);

  useEffect(() => {
    if (hasAttemptedStartupJoinRef.current || !settings || !runtimeInfo?.isStartupLaunch) return;
    hasAttemptedStartupJoinRef.current = true;

    const normalizedAddress = normalizeRelayServerUrl(settings.relayServerUrl);
    if (
      !settings.launchOnStartup ||
      !settings.hasCompletedProfileSetup ||
      !normalizedAddress ||
      getNicknameValidationError(settings.nickname)
    ) {
      return;
    }

    // Startup joins are intentionally muted so Windows login never opens the microphone.
    setMuted(true);
    void window.desktopApi.app.writeLog({
      category: "app",
      level: "info",
      message: "startup_auto_join_requested",
      context: { roomId: "main", muted: true },
    });
    void joinChannel(normalizedAddress, "main");
  }, [joinChannel, runtimeInfo?.isStartupLaunch, setMuted, settings]);

  useEffect(() => {
    const normalizedAddress = normalizeRelayServerUrl(serverAddress);
    if (!normalizedAddress) {
      setServerTestResult(undefined);
      return;
    }

    let isCancelled = false;
    let isRefreshing = false;
    let retryIndex = 0;
    let refreshTimer: number | undefined;

    const scheduleRefresh = (delayMs: number) => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshAvailability(), delayMs);
    };

    const refreshAvailability = async () => {
      if (isCancelled || isRefreshing) return;
      if (document.visibilityState === "hidden") {
        scheduleRefresh(SERVER_CHECK_RETRY_INTERVALS_MS[0]);
        return;
      }

      isRefreshing = true;
      let nextDelayMs: number = SERVER_CHECK_HEALTHY_INTERVAL_MS;
      try {
        const result = await window.desktopApi.diagnostics.testServer(normalizedAddress);
        if (!isCancelled) {
          setServerTestResult(result);
          if (result.isReachable) {
            retryIndex = 0;
          } else {
            nextDelayMs = getServerCheckRetryInterval(retryIndex);
            retryIndex += 1;
          }
        }
      } catch {
        // The explicit test button remains responsible for surfacing network errors.
        nextDelayMs = getServerCheckRetryInterval(retryIndex);
        retryIndex += 1;
      } finally {
        isRefreshing = false;
        if (!isCancelled) scheduleRefresh(nextDelayMs);
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh(0);
    };
    const refreshWhenFocused = () => scheduleRefresh(0);

    scheduleRefresh(350);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenFocused);
    return () => {
      isCancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenFocused);
    };
  }, [serverAddress]);

  useLayoutEffect(() => {
    if (!isSettingsReady || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion || hasPlayedHomeEntrance) {
        gsap.set("[data-gsap-entry]", { clearProps: "all" });
        return;
      }
      hasPlayedHomeEntrance = true;

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

      timeline
        .fromTo(
          "[data-gsap-entry='ready-avatar'], [data-gsap-entry='role-picker']",
          { autoAlpha: 0, x: -16, scale: 0.96 },
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
          "[data-gsap-entry='ready-copy'] > *, [data-gsap-entry='form'] > *",
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
    }, pageRef);

    return () => context.revert();
  }, [isSettingsReady, reduceMotion]);

  if (!settings) {
    return <StartupSplashPage message="正在准备开黑频道..." />;
  }

  const micCopy =
    permissionState === MicPermissionState.Denied
      ? { title: "没有权限", tone: "bad" }
      : inputDevices.length === 0
        ? { title: "听不到你", tone: "warn" }
        : { title: "麦克风正常", tone: "good" };

  const hasSelectedInput = settings.preferredInputDeviceId
    ? inputDevices.some((device) => device.id === settings.preferredInputDeviceId)
    : inputDevices.length > 0;
  const hasAudioOutput = outputDevices.length > 0;

  const verifyAudioDevices = async (): Promise<boolean> => {
    setIsCheckingAudio(true);
    try {
      await refreshDevices();
      const audioState = useAudioStore.getState();
      const inputDeviceId = settings.preferredInputDeviceId;
      const outputDeviceId = audioState.outputDevices.some(
        (device) => device.id === settings.preferredOutputDeviceId,
      )
        ? settings.preferredOutputDeviceId
        : undefined;
      const inputExists = inputDeviceId
        ? audioState.inputDevices.some((device) => device.id === inputDeviceId)
        : audioState.inputDevices.length > 0;
      const outputExists = audioState.outputDevices.length > 0;

      if (!inputExists || !outputExists) {
        pushToast({
          tone: "warning",
          title: "先选好声音设备",
          description: !inputExists ? "没有找到所选麦克风。" : "没有找到所选扬声器。",
        });
        return false;
      }

      const { stream } = await requestMicrophoneStream({
        deviceId: inputDeviceId,
        echoCancellation: settings.isEchoCancellationEnabled,
        noiseSuppression: settings.isNoiseSuppressionEnabled,
        autoGainControl: settings.isAutoGainControlEnabled,
      });
      stream.getTracks().forEach((track) => track.stop());

      const outputContext = new AudioContext({ latencyHint: "interactive" }) as AudioContext & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      try {
        await outputContext.setSinkId?.(outputDeviceId || "default");
      } finally {
        await outputContext.close();
      }
      getRemoteAudioMixer().setOutputDevice(outputDeviceId);
      return true;
    } catch (error) {
      pushToast({
        tone: "warning",
        title: "声音设备还没准备好",
        description:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "请允许上号使用麦克风后再进入。"
            : "无法打开所选麦克风或扬声器，请换一个设备重试。",
      });
      return false;
    } finally {
      setIsCheckingAudio(false);
    }
  };

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

    // Keep this call inside the click event so Chromium grants remote audio playback
    // before settings/network awaits consume the user activation.
    void getRemoteAudioMixer().unlock("enter-channel");
    setIsSubmitting(true);
    try {
      if (!(await verifyAudioDevices())) return;
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
  const occupiedAvatarIds = serverTestResult?.occupiedAvatarIds ?? [];
  const isSelectedAvatarOccupied = occupiedAvatarIds.includes(avatarId);
  const serverTestStatus = (
    <div className="entry-server-status-slot" aria-live="polite">
      {isTestingServer ? (
        <div className="entry-server-test-result checking" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <span>正在复查服务器...</span>
        </div>
      ) : isSelectedAvatarOccupied ? (
        <div className="entry-server-test-result danger" role="status">
          <CircleAlert className="h-4 w-4" />
          <span>服务器正常，但这个角色已被朋友选择。</span>
        </div>
      ) : serverTestResult ? (
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
      ) : (
        <span className="entry-server-status-placeholder" aria-hidden="true">
          正在等待服务器状态
        </span>
      )}
    </div>
  );
  const microphoneDeviceControl = (
    <div
      className="entry-audio-devices entry-audio-devices-single grid gap-2"
      aria-label="进入频道麦克风"
    >
      <label>
        <Mic className="h-4 w-4" />
        <span>麦克风</span>
        <select
          ref={microphoneSelectRef}
          value={settings.preferredInputDeviceId || ""}
          onChange={(event) =>
            void saveSettings({ preferredInputDeviceId: event.target.value || undefined })
          }
        >
          <option value="">系统默认</option>
          {inputDevices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label || "未命名麦克风"}
            </option>
          ))}
        </select>
        <i className={hasSelectedInput ? "is-ready" : "is-missing"} aria-hidden="true" />
      </label>
      <div className="flex items-center justify-between gap-4 rounded-[12px] border border-[#e4ebf4] bg-white/70 px-3 py-2">
        <span>
          <span className="block text-xs font-semibold text-[#52657d]">自动增益</span>
          <span className="mt-0.5 block text-[11px] text-[#8a9ab0]">自动平衡说话音量</span>
        </span>
        <Switch
          isChecked={settings.isAutoGainControlEnabled}
          onChange={(isAutoGainControlEnabled) => void saveSettings({ isAutoGainControlEnabled })}
        />
      </div>
    </div>
  );

  return (
    <div
      ref={pageRef}
      className="entry-page relative flex h-full items-center justify-center overflow-hidden px-6 py-7"
    >
      <main
        data-gsap-entry="card"
        className="entry-card relative z-10 flex w-full max-w-[900px] flex-col px-9 py-8"
      >
        <header
          data-gsap-entry="brand"
          className="flex items-center gap-3.5 border-b border-[rgba(214,225,239,.68)] pb-5"
        >
          <BrandMark size="lg" />
          <div>
            <h1 className="text-[22px] font-[680] leading-[30px] tracking-[-0.02em] text-[#172033]">
              上号
            </h1>
            <div className="text-[12px] font-medium leading-4 text-[#718198]">固定好友语音</div>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshDevices();
              window.setTimeout(() => microphoneSelectRef.current?.focus(), 0);
            }}
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

        <motion.section
          key="entry"
          className="mt-6 grid min-h-0 flex-1 gap-7 md:grid-cols-[1.05fr_.95fr]"
          initial={reduceMotion ? false : { opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
          transition={{
            duration: reduceMotion ? 0 : motionDuration.panel,
            ease: motionCurve.enter,
          }}
        >
          <div data-gsap-entry="role-picker" className="p-2">
            <div className="mb-4 text-sm font-semibold text-[#314158]">选择角色</div>
            <CharacterPicker
              value={avatarId}
              occupiedAvatarIds={occupiedAvatarIds}
              onChange={setAvatarId}
            />
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
            {microphoneDeviceControl}
            {serverTestStatus}
            <div className="mt-auto" data-gsap-entry="cta">
              <div className="flex flex-wrap gap-2.5">
                <Button
                  className="h-[52px] min-w-[188px] rounded-[16px] text-[15px]"
                  disabled={
                    isJoining ||
                    isCheckingAudio ||
                    !serverAddress.trim() ||
                    isSelectedAvatarOccupied ||
                    !hasSelectedInput ||
                    !hasAudioOutput
                  }
                  onClick={() => void enterChannel()}
                >
                  {isCheckingAudio ? "正在检查设备..." : isJoining ? "正在进入..." : "进入频道"}
                  {isJoining ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="secondary"
                  className="h-[52px] min-w-[132px] rounded-[16px] px-4"
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
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
};
