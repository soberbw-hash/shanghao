import { useEffect } from "react";

import { useAudioStore } from "../store/audioStore";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

const BOOTSTRAP_TIMEOUT_MS = 8_000;

const withTimeout = async <T>(
  task: Promise<T>,
  timeoutMessage: string,
  timeoutMs: number,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    task
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });

export const useAppBootstrap = (): void => {
  const hydrate = useSettingsStore((state) => state.hydrate);
  const settings = useSettingsStore((state) => state.settings);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const setNoiseSuppressionEnabled = useAudioStore((state) => state.setNoiseSuppressionEnabled);
  const setPushToTalkEnabled = useAudioStore((state) => state.setPushToTalkEnabled);
  const beginBootstrap = useAppStore((state) => state.beginBootstrap);
  const completeBootstrap = useAppStore((state) => state.completeBootstrap);
  const enterSafeMode = useAppStore((state) => state.enterSafeMode);
  const showStartupRecovery = useAppStore((state) => state.showStartupRecovery);
  const bootstrapAttempt = useAppStore((state) => state.bootstrapAttempt);

  useEffect(() => {
    let isDisposed = false;
    let hasReportedAudioOverload = false;

    beginBootstrap("正在准备上号…");

    const bootstrap = async () => {
      await writeRendererLog("app", "info", "Renderer bootstrap started", {
        bootstrapAttempt,
      });

      const hydrationTask = withTimeout(hydrate(), "hydrate_timeout", BOOTSTRAP_TIMEOUT_MS);
      void refreshDevices().catch(async (error) => {
        await writeRendererLog("devices", "warn", "Device refresh degraded", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      try {
        const hydration = await hydrationTask;

        if (isDisposed) {
          return;
        }

        if (hydration.mode === "safe_mode" && hydration.issue) {
          enterSafeMode(hydration.issue);
          await writeRendererLog("app", "warn", "Renderer entered safe mode", hydration.issue);
          return;
        }

        // Device enumeration and update checks continue in the background.
        completeBootstrap();
        await writeRendererLog("app", "info", "Renderer bootstrap completed");
      } catch (error) {
        if (isDisposed) {
          return;
        }

        const issue = {
          title: "启动没有完成",
          description: "上号没有顺利读完启动数据。你可以重试，或者先用安全模式进入。",
          details: [error instanceof Error ? error.message : String(error)],
        };

        showStartupRecovery(issue);
        await writeRendererLog("app", "error", "Renderer bootstrap failed", {
          error: error instanceof Error ? error.message : String(error),
          bootstrapAttempt,
        });
      }
    };

    void bootstrap();

    const handleDeviceChange = () => {
      void (async () => {
        const previousSettings = useSettingsStore.getState().settings;
        await refreshDevices();
        if (!previousSettings) return;

        const { inputDevices, outputDevices } = useAudioStore.getState();
        const patch: {
          preferredInputDeviceId?: undefined;
          preferredOutputDeviceId?: undefined;
        } = {};
        const missingInput =
          Boolean(previousSettings.preferredInputDeviceId) &&
          !inputDevices.some((device) => device.id === previousSettings.preferredInputDeviceId);
        const missingOutput =
          Boolean(previousSettings.preferredOutputDeviceId) &&
          !outputDevices.some((device) => device.id === previousSettings.preferredOutputDeviceId);

        if (missingInput) patch.preferredInputDeviceId = undefined;
        if (missingOutput) patch.preferredOutputDeviceId = undefined;
        if (!missingInput && !missingOutput) return;

        await useSettingsStore.getState().saveSettings(patch);
        useAppStore.getState().pushToast({
          tone: "warning",
          title: "音频设备已断开",
          description:
            missingInput && missingOutput
              ? "输入和输出设备已切回系统默认。"
              : missingInput
                ? "麦克风已切回系统默认。"
                : "扬声器已切回系统默认。",
        });
        await writeRendererLog("devices", "warn", "Preferred audio device disappeared", {
          missingInput,
          missingOutput,
        });
      })();
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    const handleAudioProcessorFallback = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? "unknown";
      void writeRendererLog("audio", "warn", "Microphone processor switched to browser fallback", {
        reason,
      });

      // Missing/unsupported RNNoise is a compatibility fallback, not evidence that
      // the user's machine is overloaded. Only surface a proven sustained overload.
      if (reason !== "processor_overloaded" || hasReportedAudioOverload) return;
      hasReportedAudioOverload = true;
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "高级降噪已自动减负",
        description: "检测到持续音频压力，已平稳切换为系统降噪，语音不会中断。",
      });
    };
    window.addEventListener("shanghao:audio-processor-fallback", handleAudioProcessorFallback);

    return () => {
      isDisposed = true;
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
      window.removeEventListener("shanghao:audio-processor-fallback", handleAudioProcessorFallback);
    };
  }, [
    beginBootstrap,
    bootstrapAttempt,
    completeBootstrap,
    enterSafeMode,
    hydrate,
    refreshDevices,
    showStartupRecovery,
  ]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setNoiseSuppressionEnabled(settings.isNoiseSuppressionEnabled);
    setPushToTalkEnabled(settings.isPushToTalkEnabled);
  }, [setNoiseSuppressionEnabled, setPushToTalkEnabled, settings]);
};
