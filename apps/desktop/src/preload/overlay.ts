import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type OverlayState,
  type OverlayQuickMusicMuteRequest,
} from "@private-voice/shared";

let latestState: OverlayState | undefined;
const stateListeners = new Set<(state: OverlayState) => void>();
ipcRenderer.on(IPC_CHANNELS.overlay.state, (_event, state: OverlayState) => {
  latestState = state;
  for (const listener of stateListeners) listener(state);
});
const overlayBridge = {
  overlay: {
    setInteractive: (interactive: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.overlay.setInteractive, interactive),
    moveTo: (screenY: number) => ipcRenderer.invoke(IPC_CHANNELS.overlay.moveTo, screenY),
    resetPosition: () => ipcRenderer.invoke(IPC_CHANNELS.overlay.resetPosition),
    requestMuteQuickMessage: (request: OverlayQuickMusicMuteRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.overlay.requestMuteQuickMessage, request),
    onState: (listener: (state: OverlayState) => void) => {
      stateListeners.add(listener);
      if (latestState) listener(latestState);
      return () => {
        stateListeners.delete(listener);
      };
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
contextBridge.exposeInMainWorld("shanghaoRenderer", "overlay");
