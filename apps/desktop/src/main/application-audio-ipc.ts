import {
  app,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { IPC_CHANNELS } from "@private-voice/shared";
import { ApplicationAudioService } from "./application-audio-service";
import { ApplicationAudioDelivery } from "./application-audio-delivery";
import { RustCoreClient } from "./rust-core-client";
import type { SignalingClientBridge } from "./signaling-client";
import { platformService } from "./platform/PlatformService";
import { readApplicationAudioIcons } from "./application-audio-icons";

export function registerApplicationAudioIpc(
  getMainWindow: () => BrowserWindow | null | undefined,
  signaling: SignalingClientBridge,
) {
  // An isolated dev build avoids replacing the helper used by an active call.
  const devHelper = ["target-application-audio-picker", "target-application-audio"]
    .map((target) =>
      path.resolve(app.getAppPath(), `../../native/${target}/release/shanghao-core.exe`),
    )
    .find((candidate) => existsSync(candidate));
  const executablePath =
    !app.isPackaged && platformService.isWindows && devHelper
      ? devHelper
      : RustCoreClient.resolveExecutablePath();
  const service = new ApplicationAudioService({
    executablePath,
    musicOnly: true,
    loadIcons: (rows) =>
      readApplicationAudioIcons(rows, async (executable) =>
        (await app.getFileIcon(executable, { size: "normal" }))
          .resize({ width: 40, height: 40 })
          .toDataURL(),
      ),
  });
  const delivery = new ApplicationAudioDelivery();
  let roomId: string | undefined;
  let removeOwnerListeners: (() => void) | undefined;
  const owner = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    const contents = getMainWindow()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("application_audio_sender_invalid");
    return contents;
  };
  const stop = async (sessionId?: string) => {
    await service.stop(sessionId);
    delivery.clear(sessionId);
  };
  ipcMain.handle(IPC_CHANNELS.applicationAudio.listSources, (event) => {
    owner(event);
    return service.listSources();
  });
  ipcMain.handle(IPC_CHANNELS.applicationAudio.start, async (event, sourceId: unknown) => {
    const contents = owner(event);
    if (typeof sourceId !== "string" || sourceId.length > 64) throw Error("source_missing");
    roomId = signaling.getJoinedRoomId();
    if (!roomId) throw Error("room_not_connected");
    removeOwnerListeners?.();
    const onOwnerGone = () => {
      void stop();
    };
    contents.once("render-process-gone", onOwnerGone);
    contents.once("destroyed", onOwnerGone);
    removeOwnerListeners = () => {
      contents.removeListener("render-process-gone", onOwnerGone);
      contents.removeListener("destroyed", onOwnerGone);
    };
    return service.start(sourceId, {
      onPcm: (frame) => {
        if (contents.isDestroyed() || signaling.getJoinedRoomId() !== roomId) {
          void stop();
          return;
        }
        if (delivery.offer(frame.sessionId, frame.sequence))
          contents.send(IPC_CHANNELS.applicationAudio.frame, { ...frame, capturedAt: Date.now() });
      },
      onState: (state) => {
        if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.applicationAudio.state, state);
      },
    });
  });
  ipcMain.handle(IPC_CHANNELS.applicationAudio.stop, (event, sessionId?: string) => {
    owner(event);
    return stop(sessionId);
  });
  ipcMain.handle(
    IPC_CHANNELS.applicationAudio.setGain,
    (event, sessionId: string, gain: number) => {
      owner(event);
      return service.setGain(sessionId, gain);
    },
  );
  ipcMain.on(
    IPC_CHANNELS.applicationAudio.acknowledge,
    (event, sessionId: string, sequence: number) => {
      try {
        owner(event);
        delivery.acknowledge(sessionId, sequence);
      } catch {
        /* Ignore other renderer surfaces. */
      }
    },
  );
  const watchdog = setInterval(() => {
    if (
      !getMainWindow() ||
      getMainWindow()?.isDestroyed() ||
      (roomId && signaling.getJoinedRoomId() !== roomId)
    )
      void stop();
  }, 1000);
  watchdog.unref();
  app.once("before-quit", () => {
    clearInterval(watchdog);
    removeOwnerListeners?.();
    void service.close();
  });
  return service;
}
