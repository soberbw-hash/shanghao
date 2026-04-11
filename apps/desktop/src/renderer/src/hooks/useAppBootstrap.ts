import { useEffect } from "react";

import { useAudioStore } from "../store/audioStore";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

const FONT_TIMEOUT_MS = 3_000;
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

const loadHarmonyFont = async (): Promise<void> => {
  if (!("fonts" in document)) {
    return;
  }

  const fontSet = document.fonts;
  await withTimeout(
    Promise.all([
      fontSet.load('400 14px "HarmonyOS Sans"'),
      fontSet.load('500 14px "HarmonyOS Sans"'),
    ]).then(() => undefined),
    "font_load_timeout",
    FONT_TIMEOUT_MS,
  );
};

export const useAppBootstrap = (): void => {
  const hydrate = useSettingsStore((state) => state.hydrate);
  const settings = useSettingsStore((state) => state.settings);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const setNoiseSuppressionEnabled = useAudioStore(
    (state) => state.setNoiseSuppressionEnabled,
  );
  const setPushToTalkEnabled = useAudioStore((state) => state.setPushToTalkEnabled);
  const beginBootstrap = useAppStore((state) => state.beginBootstrap);
  const completeBootstrap = useAppStore((state) => state.completeBootstrap);
  const enterSafeMode = useAppStore((state) => state.enterSafeMode);
  const showStartupRecovery = useAppStore((state) => state.showStartupRecovery);
  const bootstrapAttempt = useAppStore((state) => state.bootstrapAttempt);

  useEffect(() => {
    let isDisposed = false;

    beginBootstrap("正在准备上号…");

    const bootstrap = async () => {
      await writeRendererLog("app", "info", "Renderer bootstrap started", {
        bootstrapAttempt,
      });

      const hydrationTask = withTimeout(
        hydrate(),
        "hydrate_timeout",
        BOOTSTRAP_TIMEOUT_MS,
      );

      try {
        const [hydration] = await Promise.all([
          hydrationTask,
          refreshDevices().catch(async (error) => {
            await writeRendererLog("devices", "warn", "Device refresh degraded", {
              error: error instanceof Error ? error.message : String(error),
            });
          }),
          loadHarmonyFont().catch(async (error) => {
            await writeRendererLog("app", "warn", "HarmonyOS Sans failed to load", {
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        ]);

        if (isDisposed) {
          return;
        }

        if (hydration.mode === "safe_mode" && hydration.issue) {
          enterSafeMode(hydration.issue);
          await writeRendererLog("app", "warn", "Renderer entered safe mode", hydration.issue);
          return;
        }

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
      void refreshDevices();
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);

    return () => {
      isDisposed = true;
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
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
