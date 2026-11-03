import { ipcRenderer } from "electron";
import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";
export const recordingRecycleApi: NonNullable<DesktopApi["recordingRecycle"]> = {
  list: () => ipcRenderer.invoke(IPC_CHANNELS.recordingRecycle.list),
  restore: (id) => ipcRenderer.invoke(IPC_CHANNELS.recordingRecycle.restore, id),
};
