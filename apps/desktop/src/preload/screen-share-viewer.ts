import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type ScreenShareViewerApi,
  type ScreenShareViewerSignal,
} from "@private-voice/shared";

const screenShareViewerApi: ScreenShareViewerApi = {
  control: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.controlGet),
    request: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.controlRequest),
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.controlCancel),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.screenShareViewer.controlStop),
    frame: () => ipcRenderer.send(IPC_CHANNELS.screenShareViewer.controlFrame),
    input: (event, lane) =>
      ipcRenderer.send(IPC_CHANNELS.screenShareViewer.controlInput, event, lane),
    onState: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
        listener(state);
      ipcRenderer.on(IPC_CHANNELS.screenShareViewer.controlState, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.screenShareViewer.controlState, wrapped);
    },
  },
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
