import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

const overlayBridge = {
  overlay: {
    setInteractive: (interactive: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.overlay.setInteractive, interactive),
    moveTo: (screenY: number) => ipcRenderer.invoke(IPC_CHANNELS.overlay.moveTo, screenY),
    resetPosition: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.resetPosition),
    onState: (listener: (state: OverlayState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
      ipcRenderer.on(IPC_CHANNELS.overlay.state, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.state, wrapped);
    },
    onHoverState: (listener: (inside: boolean) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, inside: unknown) => {
        listener(inside === true);
      };
      ipcRenderer.on(IPC_CHANNELS.overlay.hoverState, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.overlay.hoverState, wrapped);
    },
  },
};

contextBridge.exposeInMainWorld("desktopApi", overlayBridge);
