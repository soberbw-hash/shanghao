import {
  app,
  ipcMain,
  powerMonitor,
  screen,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  IPC_CHANNELS,
  type RemoteControlDuration,
  type RemoteControlInputEvent,
  type RemoteControlLane,
  type RemoteControlMemberIdentity,
} from "@private-voice/shared";
import { validRemoteControlMessage } from "../../../../packages/webrtc/src/remoteControlProtocol";
import { RemoteControlService } from "./remote-control-service";
import { RemoteControlNativeInput } from "./remote-control-native";
import { RustCoreClient } from "./rust-core-client";
import { getScreenShareViewerWindow } from "./window";
import {
  registerRemoteControlViewerIpc,
  publishRemoteControlViewerState,
} from "./remote-control-viewer-ipc";
import { platformService } from "./platform/PlatformService";
import { screenCaptureService } from "./screen-capture-service";
import type { SignalingClientBridge } from "./signaling-client";

const id = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,160}$/.test(value);
const bounded = (value: unknown) => {
  try {
    return Buffer.byteLength(JSON.stringify(value)) <= 4096;
  } catch {
    return false;
  }
};
const absent: RemoteControlMemberIdentity = {
  peerId: "",
  deviceId: "",
  memberSessionId: "",
  memberGeneration: 0,
};

export function registerRemoteControlIpc(
  getMainWindow: () => BrowserWindow | null | undefined,
  signaling: SignalingClientBridge,
): RemoteControlService {
  const channels = IPC_CHANNELS.remoteControl;
  let locked = powerMonitor.getSystemIdleState(1) === "locked";
  const owner = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const contents = getMainWindow()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("remote_control_sender_invalid");
    return contents;
  };
  const devHelper = path.resolve(
    app.getAppPath(),
    "../../native/target-remote-input/release/shanghao-core.exe",
  );
  const service = new RemoteControlService({
    readMembership: () => signaling.controlMembership.get(),
    readHostState: () => {
      const membership = signaling.controlMembership.get();
      return {
        roomId: membership?.roomId ?? "",
        host: membership?.host ?? absent,
        members: membership?.members ?? [],
        roomActive: Boolean(membership),
        connected: Boolean(membership && signaling.getJoinedRoomId() === membership.roomId),
        locked,
        permissionGranted: platformService.isWindows,
        inputSupported: platformService.isWindows,
        emergencyStopReady: false,
        share: screenCaptureService.remoteControl.read(),
        lastVideoFrameAtMs: screenCaptureService.remoteControl.lastVideoFrameAtMs,
      };
    },
    createNative: (onSafetyStop) =>
      new RemoteControlNativeInput({
        executablePath:
          !app.isPackaged && platformService.isWindows && existsSync(devHelper)
            ? devHelper
            : RustCoreClient.resolveExecutablePath(),
        mode: "live",
        onSafetyStop,
      }),
    send: (peerId, message, lane) => {
      const contents = getMainWindow()?.webContents;
      if (!contents || contents.isDestroyed() || !bounded(message)) return false;
      contents.send(channels.outgoing, { peerId, message, lane });
      return true;
    },
    onState: (state) => {
      publishRemoteControlViewerState();
      const contents = getMainWindow()?.webContents;
      if (contents && !contents.isDestroyed()) contents.send(channels.state, state);
    },
  });
  registerRemoteControlViewerIpc(service, getScreenShareViewerWindow);
  const listen = (channel: string, callback: (...args: never[]) => unknown) =>
    ipcMain.on(channel, (event, ...args) => {
      try {
        owner(event);
        callback(...(args as never[]));
      } catch {
        /* Invalid surfaces/messages never own native input. */
      }
    });
  ipcMain.handle(channels.get, (event) => {
    owner(event);
    service.refresh();
    return service.snapshot();
  });
  ipcMain.handle(channels.getCapture, (event) => {
    owner(event);
    return screenCaptureService.remoteControl.read();
  });
  listen(channels.captureFrame, (handle: string, version: number) => {
    if (id(handle) && Number.isSafeInteger(version))
      screenCaptureService.remoteControl.markFrame(handle, version);
  });
  ipcMain.handle(channels.endCapture, (event, handle: string) => {
    owner(event);
    if (id(handle) && screenCaptureService.remoteControl.read()?.captureHandle === handle) {
      screenCaptureService.remoteControl.clear();
      service.onLocalSafetyEvent("share-stopped");
      service.refresh();
    }
  });
  listen(channels.peerCapability, (peer: string, available: boolean) => {
    if (id(peer) && typeof available === "boolean") service.onCapability(peer, available);
  });
  listen(channels.receive, (peer: string, message: unknown, lane: RemoteControlLane) => {
    if (
      id(peer) &&
      (lane === "reliable" || lane === "pointer") &&
      bounded(message) &&
      validRemoteControlMessage(message, lane)
    )
      void service.receive(peer, message, lane).catch(() => service.onPeerDisconnected(peer));
  });
  ipcMain.handle(channels.approve, (event, request: string, duration: RemoteControlDuration) => {
    owner(event);
    if (!id(request) || !["ten-minutes", "share-lifetime"].includes(duration))
      throw Error("remote_control_request_invalid");
    return service.approveFromLocalUser(request, duration);
  });
  ipcMain.handle(channels.deny, (event, request: string) => {
    owner(event);
    if (!id(request)) throw Error("remote_control_request_invalid");
    return service.denyFromLocalUser(request);
  });
  ipcMain.handle(channels.pause, (event) => {
    owner(event);
    return service.pauseFromLocalUser();
  });
  ipcMain.handle(channels.resume, (event) => {
    owner(event);
    return service.resumeFromLocalUser();
  });
  ipcMain.handle(channels.revoke, (event) => {
    owner(event);
    service.revokeFromLocalUser();
  });
  ipcMain.handle(channels.request, (event, peer: string) => {
    owner(event);
    if (!id(peer)) throw Error("remote_control_peer_invalid");
    return service.requestControl(peer);
  });
  ipcMain.handle(channels.cancel, (event, peer: string) => {
    owner(event);
    if (id(peer)) service.cancelRequest(peer);
  });
  ipcMain.handle(channels.stopControlling, (event, peer: string) => {
    owner(event);
    if (id(peer)) service.stopControlling(peer);
  });
  listen(channels.remoteFrame, (peer: string, share: string) => {
    if (id(peer) && id(share)) service.observeRemoteFrame(peer, share);
  });
  listen(
    channels.input,
    (peer: string, event: RemoteControlInputEvent, lane: RemoteControlLane) => {
      if (id(peer) && bounded(event)) service.sendInput(peer, event, lane);
    },
  );
  const stopCapture = () => {
    screenCaptureService.remoteControl.clear();
    service.onLocalSafetyEvent("share-stopped");
    service.refresh();
  };
  const onLock = () => {
    locked = true;
    service.onLocalSafetyEvent("screen-locked");
  };
  const onUnlock = () => {
    locked = false;
  };
  const onSuspend = () => service.onLocalSafetyEvent("app-suspend");
  powerMonitor.on("lock-screen", onLock);
  powerMonitor.on("unlock-screen", onUnlock);
  powerMonitor.on("suspend", onSuspend);
  screen.on("display-metrics-changed", stopCapture);
  screen.on("display-removed", stopCapture);
  screen.on("display-added", stopCapture);
  let contentsId: number | undefined;
  let detachOwner: (() => void) | undefined;
  const watchdog = setInterval(() => {
    const contents = getMainWindow()?.webContents;
    const next = contents && !contents.isDestroyed() ? contents.id : undefined;
    if (next !== contentsId) {
      detachOwner?.();
      detachOwner = undefined;
      contentsId = next;
      stopCapture();
      if (contents && next !== undefined) {
        const ownerGone = () => {
          screenCaptureService.remoteControl.clear();
          service.onLocalSafetyEvent("owner-destroyed");
        };
        contents.on("render-process-gone", ownerGone);
        contents.on("destroyed", ownerGone);
        detachOwner = () => {
          contents.off("render-process-gone", ownerGone);
          contents.off("destroyed", ownerGone);
        };
      }
    }
  }, 250);
  watchdog.unref();
  app.once("before-quit", () => {
    clearInterval(watchdog);
    detachOwner?.();
    service.dispose();
    screenCaptureService.remoteControl.clear();
    powerMonitor.off("lock-screen", onLock);
    powerMonitor.off("unlock-screen", onUnlock);
    powerMonitor.off("suspend", onSuspend);
    screen.off("display-metrics-changed", stopCapture);
    screen.off("display-removed", stopCapture);
    screen.off("display-added", stopCapture);
  });
  return service;
}
