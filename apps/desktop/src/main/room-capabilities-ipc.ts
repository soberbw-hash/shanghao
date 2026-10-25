import type { BrowserWindow } from "electron";
import type { SignalingClientBridge } from "./signaling-client";
import { registerTemporaryRoomsIpc } from "./temporary-rooms-ipc";
import { registerApplicationAudioIpc } from "./application-audio-ipc";
import { registerRemoteControlIpc } from "./remote-control-ipc";

/** Room-scoped capabilities share the same Main window and authenticated signaling owner. */
export function registerRoomCapabilitiesIpc(
  getMainWindow: () => BrowserWindow | null | undefined,
  signaling: SignalingClientBridge,
  endpoint: () => string,
): void {
  registerTemporaryRoomsIpc({ getMainWindow, signaling, endpoint });
  registerApplicationAudioIpc(getMainWindow, signaling);
  registerRemoteControlIpc(getMainWindow, signaling);
}
