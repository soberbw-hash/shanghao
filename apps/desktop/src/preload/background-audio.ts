import { ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type BackgroundAudioApi,
  type BackgroundAudioState,
} from "@private-voice/shared";
export const backgroundAudioApi: BackgroundAudioApi = {
  pulse: (activity) => ipcRenderer.invoke(IPC_CHANNELS.backgroundAudio.pulse, activity),
  configure: (patch) => ipcRenderer.invoke(IPC_CHANNELS.backgroundAudio.configure, patch),
  onChanged: (listener) => {
    const receive = (_event: unknown, state: BackgroundAudioState) => listener(state);
    ipcRenderer.on(IPC_CHANNELS.backgroundAudio.changed, receive);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.backgroundAudio.changed, receive);
    };
  },
};
