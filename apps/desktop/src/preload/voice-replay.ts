import { ipcRenderer } from "electron";
import { IPC_CHANNELS, type VoiceReplayApi } from "@private-voice/shared";
const channels = IPC_CHANNELS.voiceReplay;
export const voiceReplayApi: VoiceReplayApi = {
  list: () => ipcRenderer.invoke(channels.list),
  save: (title, bytes) => ipcRenderer.invoke(channels.save, title, bytes),
  read: (id) => ipcRenderer.invoke(channels.read, id),
  rename: (id, title) => ipcRenderer.invoke(channels.rename, id, title),
  trim: (id, from, to) => ipcRenderer.invoke(channels.trim, id, from, to),
  transcribeLocal: (id) => ipcRenderer.invoke(channels.transcribeLocal, id),
  readTranscript: (id) => ipcRenderer.invoke(channels.readTranscript, id),
  readTranscriptDetail: (id) => ipcRenderer.invoke(channels.readTranscriptDetail, id),
  reviseTranscriptSegment: (id, expectedCreatedAt, index, text) =>
    ipcRenderer.invoke(channels.reviseTranscriptSegment, id, expectedCreatedAt, index, text),
  remove: (id) => ipcRenderer.invoke(channels.remove, id),
  export: (id) => ipcRenderer.invoke(channels.export, id),
  shortcut: (accelerator) => ipcRenderer.invoke(channels.shortcut, accelerator),
  onSaveShortcut: (listener) => {
    const callback = () => listener();
    ipcRenderer.on(channels.saveShortcut, callback);
    return () => ipcRenderer.removeListener(channels.saveShortcut, callback);
  },
};
