import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";

const desktopApi: DesktopApi = {
  app: {
    getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.app.getRuntimeInfo),
    writeLog: (payload) => ipcRenderer.invoke(IPC_CHANNELS.app.writeLog, payload),
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize),
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.window.hide),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settings.get),
    save: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.settings.reset),
  },
  diagnostics: {
    snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.snapshot),
    exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.diagnostics.exportLogs),
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
  host: {
    start: (roomName, nickname) =>
      ipcRenderer.invoke(IPC_CHANNELS.host.start, roomName, nickname),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.host.stop),
  },
  recording: {
    export: (payload) => ipcRenderer.invoke(IPC_CHANNELS.recording.export, payload),
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
