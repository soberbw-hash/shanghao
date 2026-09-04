import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, Notification, Tray, dialog, net, protocol } from "electron";

import { APP_ID, IPC_CHANNELS, type DeepLinkInvite } from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { AccountDesktopService } from "./account-service";
import { AccountSessionStore } from "./account-session-store";
import { registerIpcHandlers } from "./ipc";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { createTrayController } from "./tray";
import { UpdateService } from "./updates";
import { createMainWindow } from "./window";
import { OverlayWindowController } from "./overlay-window";
import { GameDetectionController } from "./game-detection";
import { platformService } from "./platform/PlatformService";
import { AiModelManager, QWEN36_NVFP4_MODEL_REVISION } from "./ai-model-manager";
import { AiRuntimeManager } from "./ai-runtime-manager";
import { FreeTokenLocalLlmProvider } from "./freetoken-local-llm-provider";
import { FreeTokenManagedRuntime } from "./freetoken-managed-runtime";
import { AiVoiceMemoryService } from "./ai-voice-memory-service";
import { AiTextGateway } from "./ai-text-gateway";
import { CustomAiProviderStore } from "./custom-ai-provider-store";
import { HuggingFaceAccessStore } from "./hugging-face-access-store";
import { preparePersistentAiStorage } from "./ai-storage";
import { prepareBundledAiRuntime } from "./ai-runtime-package";
import { VoiceMemoryStore } from "./voice-memory-store";
import { LifecycleRecoveryService } from "./lifecycle-recovery-service";
import { ensurePre30DataSnapshot } from "./user-data-migration";
import { removeWindowsStartupTask } from "./windows-startup-task";
import { ensureWindowsFirewallRulesWithOutcome } from "./windows-integration";
import {
  findDeepLinkAuth,
  findDeepLinkInvite,
  parseDeepLinkInvite,
  SHANGHAO_PROTOCOL,
} from "./deep-link";
import { sendToWindow } from "./safe-web-contents";
import {
  createRecordingMediaResponse,
  decodeRecordingMediaUrl,
  isAllowedRecordingMediaPath,
  RECORDING_MEDIA_PROTOCOL,
} from "./recording-library";
import {
  createQuickMessageMediaResponse,
  QUICK_MESSAGE_MEDIA_PROTOCOL,
} from "./quick-message-assets";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let diagnostics: DiagnosticsService | null = null;
let settingsStore: SettingsStore | null = null;
let shortcutsController: ShortcutController | null = null;
let overlayController: OverlayWindowController | null = null;
let gameDetectionController: GameDetectionController | null = null;
let aiModelManager: AiModelManager | null = null;
let aiRuntimeManager: AiRuntimeManager | null = null;
let freeTokenLocalLlmProvider: FreeTokenLocalLlmProvider | null = null;
let lifecycleRecoveryService: LifecycleRecoveryService | null = null;
let accountService: AccountDesktopService | null = null;
let pendingDeepLink = findDeepLinkInvite(process.argv);
let pendingAuthDeepLink = findDeepLinkAuth(process.argv);

const QUIT_FOR_INSTALL_ARG = "--shanghao-quit-for-install";
const shouldQuitForInstall = process.argv.includes(QUIT_FOR_INSTALL_ARG);

if (!app.isPackaged && process.env.SHANGHAO_CAPTURE_PATH) {
  const capturePath = process.env.SHANGHAO_CAPTURE_PATH;
  const captureName = path.basename(capturePath, path.extname(capturePath));
  app.setPath("userData", path.join(path.dirname(capturePath), `.user-data-${captureName}`));
}

const showWindow = () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
};

const showNetworkPermissionNotice = (title: string, body: string): void => {
  if (!settingsStore?.getSnapshot().isSystemNotificationEnabled || !Notification.isSupported()) {
    return;
  }
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", showWindow);
  notification.show();
};

const autoRepairWindowsNetworkPermissions = async (): Promise<void> => {
  if (!app.isPackaged || !platformService.isWindows || !diagnostics) return;
  try {
    const outcome = await ensureWindowsFirewallRulesWithOutcome();
    await diagnostics.writeLog({
      category: "app",
      level: outcome.status.healthy ? "info" : "warn",
      message: outcome.repairAttempted
        ? "Windows network permissions automatically repaired"
        : "Windows network permissions already healthy",
      context: {
        ...outcome.status,
        repairAttempted: outcome.repairAttempted,
        repaired: outcome.repaired,
        inspectionFailed: outcome.inspectionFailed,
      },
    });
    if (!outcome.repairAttempted) return;
    showNetworkPermissionNotice(
      outcome.repaired ? "网络权限已自动修复" : "网络权限自动修复未完成",
      outcome.repaired
        ? "上号已恢复 TCP/UDP 语音连接权限，无需手动操作。"
        : "上号未能完成网络权限修复，请在设置的诊断页面查看原因。",
    );
  } catch (error) {
    await diagnostics.writeLog({
      category: "app",
      level: "warn",
      message: "Windows network permission automatic repair failed",
      context: { error: error instanceof Error ? error.message : String(error) },
    });
    showNetworkPermissionNotice(
      "网络权限自动修复未完成",
      "上号未能完成网络权限修复，请在设置的诊断页面查看原因。",
    );
  }
};

const consumePendingDeepLink = (): DeepLinkInvite | undefined => {
  const invite = pendingDeepLink;
  pendingDeepLink = undefined;
  return invite;
};

const dispatchDeepLink = (invite: DeepLinkInvite): void => {
  pendingDeepLink = invite;
  showWindow();
  if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) return;
  sendToWindow(mainWindow, IPC_CHANNELS.app.deepLink, invite);
};

const dispatchAuthDeepLink = (rawUrl: string): void => {
  pendingAuthDeepLink = undefined;
  showWindow();
  if (!accountService) {
    pendingAuthDeepLink = rawUrl;
    return;
  }
  void accountService.handleAuthDeepLink(rawUrl).catch((error) =>
    diagnostics?.writeLog({
      category: "app",
      level: "warn",
      message: "Auth callback could not be handled",
      context: { error: error instanceof Error ? error.message : String(error) },
    }),
  );
};

const consumePendingAuthDeepLink = (): string | undefined => {
  const rawUrl = pendingAuthDeepLink;
  pendingAuthDeepLink = undefined;
  return rawUrl;
};

const prepareForQuit = (reason: string) => {
  isQuitting = true;
  void diagnostics?.writeLog({
    category: "app",
    level: "info",
    message: "Preparing to quit",
    context: { reason },
  });

  overlayController?.close();
  gameDetectionController?.stop();
  lifecycleRecoveryService?.stop();
  accountService?.dispose();
  aiRuntimeManager?.stop();
  freeTokenLocalLlmProvider?.stop();
  shortcutsController?.dispose();

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
};

const quitForInstall = (reason: string) => {
  prepareForQuit(reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners("close");
    mainWindow.close();
  }
  app.quit();
  // Keep the timer referenced so a native hook or hidden surface cannot stall an update forever.
  setTimeout(() => app.exit(0), 1_500);
};

const showBootstrapError = async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const logsDirectory = diagnostics?.getSnapshot().logsDirectory ?? app.getPath("userData");

  await diagnostics?.writeLog({
    category: "app",
    level: "error",
    message: "Software bootstrap failed",
    context: { error: message, logsDirectory },
  });

  dialog.showErrorBox(
    "\u8F6F\u4EF6\u542F\u52A8\u5931\u8D25",
    `${"\u4E0A\u53F7\u6CA1\u6709\u6B63\u5E38\u542F\u52A8\u3002"}\n\n${"\u65E5\u5FD7\u76EE\u5F55\uFF1A"}${logsDirectory}\n\n${"\u9519\u8BEF\uFF1A"}${message}\n\n${"\u4F60\u53EF\u4EE5\u91CD\u8BD5\uFF0C\u6216\u8005\u5220\u9664 settings.json \u540E\u518D\u542F\u52A8\u3002"}`,
  );

  if (!mainWindow) {
    mainWindow = createMainWindow({
      log: (level, entry, context) => {
        void diagnostics?.writeLog({
          category: "app",
          level,
          message: entry,
          context,
        });
      },
      logsDirectory,
    });
  }

  showWindow();
};

const maybeRunVisualCapture = async (window: BrowserWindow | null): Promise<void> => {
  const outputPath = process.env.SHANGHAO_CAPTURE_PATH;
  if (app.isPackaged || !window || !outputPath) {
    return;
  }

  const visualCapture = (await import(
    pathToFileURL(path.join(__dirname, "../tests/visual/capture-ui.cjs")).href
  )) as typeof import("../../tests/visual/capture-ui");
  await visualCapture.captureUi(window, {
    mode: (process.env.SHANGHAO_CAPTURE_MODE ?? "home") as
      | "home"
      | "home-mic"
      | "room"
      | "room-mic"
      | "room-ai"
      | "member-volume"
      | "recording-stop"
      | "room-seat"
      | "room-away"
      | "screen-share"
      | "screen-share-expanded"
      | "settings"
      | "settings-recording"
      | "settings-ai"
      | "settings-detail"
      | "profile-settings",
    outputPath,
    exitAfterCapture: process.env.SHANGHAO_CAPTURE_EXIT !== "0",
    onExit: () => {
      isQuitting = true;
      app.quit();
    },
  });
};

const bootstrap = async (): Promise<void> => {
  diagnostics = new DiagnosticsService();
  await diagnostics.init();
  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main process bootstrap started",
  });

  settingsStore = new SettingsStore(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  const settings = await settingsStore.load();
  await ensurePre30DataSnapshot({
    userDataDirectory: app.getPath("userData"),
    recordingDirectory:
      settings.recordingSaveDirectory?.trim() || path.join(app.getPath("documents"), "上号录音"),
    log: (message, context) =>
      void diagnostics?.writeLog({ category: "app", level: "info", message, context }),
  }).catch(() => undefined);
  protocol.handle(RECORDING_MEDIA_PROTOCOL, async (request) => {
    const filePath = decodeRecordingMediaUrl(request.url);
    if (
      !filePath ||
      !isAllowedRecordingMediaPath(settingsStore?.getSnapshot().recordingSaveDirectory, filePath)
    ) {
      return new Response("Not found", { status: 404 });
    }
    try {
      return await createRecordingMediaResponse(filePath, request.headers.get("range"));
    } catch (error) {
      void diagnostics?.writeLog({
        category: "app",
        level: "warn",
        message: "Recording media request failed",
        context: {
          fileName: path.basename(filePath),
          range: request.headers.get("range") ?? undefined,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return new Response("Not found", { status: 404 });
    }
  });
  protocol.handle(QUICK_MESSAGE_MEDIA_PROTOCOL, (request) =>
    createQuickMessageMediaResponse(request.url, request.headers.get("range")),
  );
  try {
    await removeWindowsStartupTask();
  } catch (error) {
    await diagnostics.writeLog({
      category: "app",
      level: "warn",
      message: "legacy startup task cleanup failed",
      context: { error: error instanceof Error ? error.message : String(error) },
    });
  }

  const accounts = new AccountDesktopService(
    new AccountSessionStore(app.getPath("userData")),
    () => settingsStore?.getSnapshot().relayServerUrl,
    (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    !app.isPackaged,
  );
  accountService = accounts;
  await accounts.initialize();
  const signalingClient = new SignalingClientBridge(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    () => accounts.getFreshAccessToken(),
  );
  const customAiProvider = new CustomAiProviderStore(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  const huggingFaceAccess = new HuggingFaceAccessStore(
    app.getPath("userData"),
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  const updates = new UpdateService(
    app.getVersion(),
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    async () => {
      const acknowledged = await signalingClient.prepareForUpdate();
      await diagnostics?.writeLog({
        category: "signaling",
        level: acknowledged ? "info" : "warn",
        message: acknowledged
          ? "Update presence acknowledged before installer handoff"
          : "No active room acknowledged update presence before installer handoff",
      });
      prepareForQuit("auto-update");
    },
  );
  const shortcuts = new ShortcutController(
    () => mainWindow,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  await shortcuts.configureGlobalMute(settings.globalMuteShortcut);
  await shortcuts.configurePushToTalk(settings.pushToTalkShortcut, settings.isPushToTalkEnabled);
  const overlay = new OverlayWindowController();
  const gameDetection = new GameDetectionController(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  gameDetection.onDetected((snapshot) => {
    shortcuts.setMouseHookSuppressed(Boolean(snapshot.gameName));
  });
  const usesInjectedCapturePresence =
    !app.isPackaged &&
    Boolean(process.env.SHANGHAO_CAPTURE_PATH) &&
    Boolean(process.env.SHANGHAO_CAPTURE_GAME_NAME || process.env.SHANGHAO_CAPTURE_WORK_NAME);
  await gameDetection.setEnabled(
    usesInjectedCapturePresence ? false : settings.isGameDetectionEnabled,
  );
  const lifecycleRecovery = new LifecycleRecoveryService(
    async (reason) => {
      overlay.reconcileDisplayBounds();
      await gameDetection.reconcile(reason);
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendToWindow(mainWindow, IPC_CHANNELS.app.lifecycleRecovery, {
          reason,
          at: new Date().toISOString(),
        });
      }
    },
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  lifecycleRecovery.start();
  lifecycleRecoveryService = lifecycleRecovery;
  const aiStorage = await preparePersistentAiStorage({
    userDataDirectory: app.getPath("userData"),
    appDataDirectory: app.getPath("appData"),
    localAppDataDirectory: process.env.LOCALAPPDATA,
    isolateDirectory:
      !app.isPackaged && process.env.SHANGHAO_CAPTURE_PATH
        ? path.dirname(process.env.SHANGHAO_CAPTURE_PATH)
        : undefined,
    writeLog: (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  });
  const aiModels = new AiModelManager(
    aiStorage.models,
    gameDetection,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    (input, init) => net.fetch(input, init),
    () => huggingFaceAccess.accessToken(),
    [
      path.join(app.getPath("userData"), "ai-models"),
      path.join(app.getPath("appData"), "shanghao-desktop", "ai-models"),
      path.join(app.getPath("appData"), "ShangHao", "ai-models"),
      path.join(app.getPath("appData"), "上号", "ai-models"),
    ],
  );
  await aiModels.initialize(settings.aiProcessingMode, settings.aiAsrModel);
  updates.setBackgroundDownloadGuard(() => aiModels.shouldDeferBackgroundDownload());
  const aiRuntimeDirectory = aiStorage.runtimes;
  const bundledAiRuntimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "ai")
    : path.join(app.getAppPath(), "resources", "ai");
  try {
    await prepareBundledAiRuntime({
      runtimeRoot: aiRuntimeDirectory,
      bundledRoot: bundledAiRuntimeRoot,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await diagnostics.writeLog({
      category: "app",
      level: "error",
      message: "Bundled AI runtime could not be prepared; continuing without replacing it",
      context: { reason, bundledAiRuntimeRoot, aiRuntimeDirectory },
    });
  }
  const bundledRunner = app.isPackaged
    ? path.join(process.resourcesPath, "ai", "qwen-runner.py")
    : path.join(app.getAppPath(), "scripts", "qwen-runner.py");
  const runtimeRunner = path.join(aiRuntimeDirectory, "qwen-runner.py");
  // Packaged Qwen runners are copied only by prepareBundledAiRuntime after hash verification.
  // Development uses the live script because resources/ai intentionally contains only the manifest.
  if (!app.isPackaged && existsSync(bundledRunner) && readFileSync(bundledRunner).length > 0) {
    const { mkdir, copyFile } = await import("node:fs/promises");
    await mkdir(aiRuntimeDirectory, { recursive: true });
    await copyFile(bundledRunner, runtimeRunner);
  }
  const bundledAsrRunner = app.isPackaged
    ? path.join(process.resourcesPath, "ai", "asr-runner.py")
    : path.join(app.getAppPath(), "scripts", "asr-runner.py");
  const runtimeAsrRunner = path.join(aiRuntimeDirectory, "asr-runner.py");
  if (existsSync(bundledAsrRunner) && readFileSync(bundledAsrRunner).length > 0) {
    const { mkdir, copyFile } = await import("node:fs/promises");
    await mkdir(aiRuntimeDirectory, { recursive: true });
    await copyFile(bundledAsrRunner, runtimeAsrRunner);
  }
  const aiRuntime = new AiRuntimeManager(
    aiRuntimeDirectory,
    {
      model: (id) => aiModels.getActiveModelDirectory(id),
      qwen: () => aiModels.getActiveModelDirectory("qwen35-4b"),
      activeAsr: () => aiModels.getActiveAsrModel(),
    },
    {
      writeLog: (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
      runtimeFetch: (input, init) =>
        net.fetch(input instanceof URL ? input.toString() : input, init),
    },
  );
  const freeTokenRuntime = new FreeTokenManagedRuntime(aiRuntimeDirectory, {
    fetcher: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    writeLog: (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  });
  const freeTokenProvider = new FreeTokenLocalLlmProvider(
    () => aiModels.getActiveModelDirectory("qwen36-35b-a3b-nvfp4"),
    QWEN36_NVFP4_MODEL_REVISION,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    undefined,
    () => freeTokenRuntime.executablePath(),
    async () => {
      const status = await freeTokenRuntime.prepare();
      if (!status.ready || !status.executable) {
        throw new Error(status.message ?? "local_organizer_runtime_unavailable");
      }
      return status.executable;
    },
  );
  aiModels.setRuntimePreparer(async (id, signal) => {
    if (id === "qwen36-35b-a3b-nvfp4") {
      const runtime = await freeTokenRuntime.prepare(signal);
      if (!runtime.ready) {
        return { ready: false, message: runtime.message };
      }
      const status = await freeTokenProvider.prepare();
      aiModels.setLocalLlmRuntimeStatus(id, status);
      return status;
    }
    const prepared = await aiRuntime.prepareModelRuntime(id);
    const statuses = await aiRuntime.modelRuntimeStatuses();
    aiModels.setRuntimeStatuses(statuses);
    return statuses[id] ?? prepared;
  });
  aiRuntime.onQwenState((health) => {
    aiModels.setQwenRuntimeState(health.loaded, health.queuedJobs);
  });
  freeTokenProvider.onStatus((status) => {
    aiModels.setLocalLlmRuntimeStatus("qwen36-35b-a3b-nvfp4", status);
  });
  aiModels.onQwenReleaseRequested((reason) => {
    aiRuntime.releaseQwen(reason);
    freeTokenProvider.release(reason);
  });
  const aiTextGateway = new AiTextGateway(
    settingsStore,
    aiModels,
    aiRuntime,
    signalingClient,
    customAiProvider,
    freeTokenProvider,
  );
  const voiceMemory = new AiVoiceMemoryService(
    aiModels,
    aiRuntime,
    aiTextGateway,
    new VoiceMemoryStore(path.join(app.getPath("userData"), "voice-memory")),
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    () => settingsStore?.getSnapshot().isAiAutoTranscribeEnabled ?? false,
  );
  await voiceMemory.initialize();
  shortcutsController = shortcuts;
  overlayController = overlay;
  gameDetectionController = gameDetection;
  aiModelManager = aiModels;
  aiRuntimeManager = aiRuntime;
  freeTokenLocalLlmProvider = freeTokenProvider;

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsStore,
    diagnostics,
    shortcuts,
    signalingClient,
    accounts,
    updates,
    overlay,
    gameDetection,
    aiModels,
    voiceMemory,
    customAiProvider,
    huggingFaceAccess,
    consumePendingDeepLink,
  });

  mainWindow = createMainWindow({
    log: (level, message, context) => {
      void diagnostics?.writeLog({
        category: "app",
        level,
        message,
        context,
      });
    },
    logsDirectory: diagnostics.getSnapshot().logsDirectory,
  });

  const initialAuthDeepLink = consumePendingAuthDeepLink();
  if (initialAuthDeepLink) dispatchAuthDeepLink(initialAuthDeepLink);

  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main window created",
  });
  // The check may invoke PowerShell and elevation-sensitive firewall APIs, so
  // keep it off the startup critical path. It runs once per launch and the
  // firewall layer serializes any manual repair that happens at the same time.
  void autoRepairWindowsNetworkPermissions();
  void maybeRunVisualCapture(mainWindow).catch(async (error) => {
    await diagnostics?.writeLog({
      category: "app",
      level: "error",
      message: "Visual capture failed",
      context: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    isQuitting = true;
    app.quit();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && settingsStore?.getSnapshot().minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  tray = createTrayController(
    () => mainWindow,
    async () => {
      if (voiceMemory.hasActiveTask()) {
        showWindow();
        const options = {
          type: "warning" as const,
          title: "转录仍在进行",
          message: "当前转录或整理还没有完成。",
          detail: "继续留在上号会保持任务运行；退出会暂停，下次可以接着处理。",
          buttons: ["继续处理", "退出并暂停"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const result = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
        if (result.response !== 1) return false;
        voiceMemory.pauseAll();
      }
      prepareForQuit("tray");
      return true;
    },
  );

  app.on("before-quit", () => {
    voiceMemory.pauseAll();
    aiModelManager?.stop();
    prepareForQuit("before-quit");
  });

  app.on("activate", () => {
    if (!mainWindow) {
      mainWindow = createMainWindow({
        log: (level, message, context) => {
          void diagnostics?.writeLog({
            category: "app",
            level,
            message,
            context,
          });
        },
        logsDirectory: diagnostics?.getSnapshot().logsDirectory,
      });
      return;
    }

    showWindow();
  });
};

if (platformService.isWindows) app.setAppUserModelId(APP_ID);
protocol.registerSchemesAsPrivileged([
  {
    scheme: RECORDING_MEDIA_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: QUICK_MESSAGE_MEDIA_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
if (process.defaultApp) {
  app.removeAsDefaultProtocolClient(SHANGHAO_PROTOCOL);
  app.setAsDefaultProtocolClient(SHANGHAO_PROTOCOL, process.execPath, [app.getAppPath()]);
} else {
  app.setAsDefaultProtocolClient(SHANGHAO_PROTOCOL);
}
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch(
  "proxy-bypass-list",
  ".ts.net;100.64.0.0/10;<local>;localhost;127.0.0.1;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*",
);

app.on("second-instance", (_event, commandLine) => {
  if (commandLine.includes(QUIT_FOR_INSTALL_ARG)) {
    quitForInstall("installer-second-instance");
    return;
  }

  const invite = findDeepLinkInvite(commandLine);
  if (invite) {
    dispatchDeepLink(invite);
    return;
  }

  const authDeepLink = findDeepLinkAuth(commandLine);
  if (authDeepLink) {
    dispatchAuthDeepLink(authDeepLink);
    return;
  }

  showWindow();
});

app.on("open-url", (event, rawUrl) => {
  event.preventDefault();
  const invite = parseDeepLinkInvite(rawUrl);
  if (invite) dispatchDeepLink(invite);
  else if (findDeepLinkAuth([rawUrl])) dispatchAuthDeepLink(rawUrl);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  if (shouldQuitForInstall) {
    setTimeout(() => app.exit(0), 500).unref();
  }
  app.quit();
} else if (shouldQuitForInstall) {
  app.exit(0);
} else {
  void app
    .whenReady()
    .then(bootstrap)
    .catch(async (error) => {
      await showBootstrapError(error);
    });
}

app.on("window-all-closed", () => {
  app.quit();
});
