import { ipcRenderer } from "electron";
import { IPC_CHANNELS, type RemoteControlApi } from "@private-voice/shared";
const channels = IPC_CHANNELS.remoteControl;
export const remoteControlApi: RemoteControlApi = {
  get: () => ipcRenderer.invoke(channels.get),
  getCapture: () => ipcRenderer.invoke(channels.getCapture),
  captureFrame: (handle, version) => ipcRenderer.send(channels.captureFrame, handle, version),
  endCapture: (handle) => ipcRenderer.invoke(channels.endCapture, handle),
  peerCapability: (peer, available) => ipcRenderer.send(channels.peerCapability, peer, available),
  receive: (peer, message, lane) => ipcRenderer.send(channels.receive, peer, message, lane),
  approve: (id, duration) => ipcRenderer.invoke(channels.approve, id, duration),
  deny: (id) => ipcRenderer.invoke(channels.deny, id),
  pause: () => ipcRenderer.invoke(channels.pause),
  resume: () => ipcRenderer.invoke(channels.resume),
  revoke: () => ipcRenderer.invoke(channels.revoke),
  request: (peer) => ipcRenderer.invoke(channels.request, peer),
  cancel: (peer) => ipcRenderer.invoke(channels.cancel, peer),
  stopControlling: (peer) => ipcRenderer.invoke(channels.stopControlling, peer),
  remoteFrame: (peer, share) => ipcRenderer.send(channels.remoteFrame, peer, share),
  input: (peer, event, lane) => ipcRenderer.send(channels.input, peer, event, lane),
  onState(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) =>
      listener(state);
    ipcRenderer.on(channels.state, receive);
    return () => ipcRenderer.removeListener(channels.state, receive);
  },
  onOutgoing(listener) {
    const receive = (_event: Electron.IpcRendererEvent, message: Parameters<typeof listener>[0]) =>
      listener(message);
    ipcRenderer.on(channels.outgoing, receive);
    return () => ipcRenderer.removeListener(channels.outgoing, receive);
  },
};
