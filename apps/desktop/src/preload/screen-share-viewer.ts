import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type ScreenShareViewerApi,
  type ScreenShareViewerSignal,
} from "@private-voice/shared";

const screenShareViewerApi: ScreenShareViewerApi = {
  sendSignal: (signal) => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.sendSignal, signal),
  close: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.close),
  onSignal: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, signal: ScreenShareViewerSignal) =>
      listener(signal);
    ipcRenderer.on(IPC_CHANNELS.screenShareViewer.signal, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.screenShareViewer.signal, wrapped);
  },
};

contextBridge.exposeInMainWorld("screenShareViewerApi", screenShareViewerApi);
