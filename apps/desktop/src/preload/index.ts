import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";

const desktopApi: DesktopApi = {
  app: {
    getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.app.getRuntimeInfo),
    writeLog: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, payload),
    openPath: (targetPath) => ipcRenderer.invoke(IPC_CHANNELS.app.openPath, targetPath),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.window.hide),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.window.show),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.settings.reset),
  },
  profile: {
    pickAvatar: () => ipcRenderer.invoke(IPC_CHANNELS.profile.pickAvatar),
    readAvatar: (avatarPath) => ipcRenderer.invoke(IPC_CHANNELS.profile.readAvatar, avatarPath),
    clearAvatar: (avatarPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.profile.clearAvatar, avatarPath),
  },
  diagnostics: {
    snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.snapshot),
    exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.exportLogs),
    exportBundle: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.exportBundle),
    openLogsDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.openLogsDirectory),
  },
  shortcuts: {
    configureMute: (accelerator) =>
      ipcRenderer.invoke(IPC_CHANNELS.shortcuts.configureMute, accelerator),
    onMuteTriggered: (listener) => {
      const wrapped = () => listener();
      ipcRenderer.on(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.shortcuts.muteTriggered, wrapped);
    },
  },
  tailscale: {
    checkStatus: () => ipcRenderer.invoke(IPC_CHANNELS.tailscale.checkStatus),
    openInstallGuide: () =>
      ipcRenderer.invoke(IPC_CHANNELS.tailscale.openInstallGuide),
  },
  network: {
    getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.network.getSnapshot),
    getProxyDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.network.getProxyDiagnostics),
    exportSummary: () => ipcRenderer.invoke(IPC_CHANNELS.network.exportSummary),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.updates.check),
    openReleases: () => ipcRenderer.invoke(IPC_CHANNELS.updates.openReleases),
  },
  host: {
    start: (roomName, nickname, connectionMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.host.start, roomName, nickname, connectionMode),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.host.stop),
    diagnoseJoin: (signalingUrl, connectionMode) =>
      ipcRenderer.invoke(IPC_CHANNELS.host.diagnoseJoin, signalingUrl, connectionMode),
  },
  signaling: {
    connect: (signalingUrl) => ipcRenderer.invoke(IPC_CHANNELS.signaling.connect, signalingUrl),
    send: (payload) => ipcRenderer.invoke(IPC_CHANNELS.signaling.send, payload),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.signaling.close),
    onEvent: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        listener(payload as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IPC_CHANNELS.signaling.event, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.signaling.event, wrapped);
    },
  },
  recording: {
    export: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recording.export, payload),
  },
};

void ipcRenderer
  .invoke(IPC_CHANNELS.app.writeLog, {
    category: "app",
    level: "info",
    message: "Preload bridge initialized",
  })
  .catch(() => undefined);

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
