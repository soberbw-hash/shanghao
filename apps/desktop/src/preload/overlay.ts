import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

const overlayBridge = {
  overlay: {
    onState: (listener: (state: OverlayState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.overlay.state, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.state, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld("desktopApi", overlayBridge);
