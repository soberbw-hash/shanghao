import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { IPC_CHANNELS, type VoiceReplayTranscript } from "@private-voice/shared";
import { VoiceReplayStore } from "./voice-replay-store";

export function registerVoiceReplayIpc(
  window: () => BrowserWindow | null,
  transcribeLocal: (
    filePath: string,
    durationMs: number,
  ) => Promise<
    string | Omit<Extract<VoiceReplayTranscript, { version: 2 }>, "version" | "createdAt">
  >,
): void {
  const store = new VoiceReplayStore(path.join(app.getPath("userData"), "voice-replay"), (target) =>
    shell.trashItem(target),
  );
  const channels = IPC_CHANNELS.voiceReplay;
  let accelerator = "";
  let transcribing = false;
  const check = (event: IpcMainInvokeEvent) => {
    const contents = window()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      contents !== event.sender ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("voice_replay_forbidden");
  };
  const bind = (channel: string, handler: (...args: never[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      check(event);
      return handler(...(args as never[]));
    });
  };
  bind(channels.list, () => store.list());
  bind(channels.save, (title: string, bytes: Uint8Array) => store.save(title, bytes));
  bind(channels.read, (id: string) => store.read(id));
  bind(channels.readTranscript, (id: string) => store.readTranscript(id));
  bind(channels.readTranscriptDetail, (id: string) => store.readTranscriptDetail(id));
  bind(
    channels.reviseTranscriptSegment,
    (id: string, expectedCreatedAt: number, index: number, text: string) =>
      store.reviseTranscriptSegment(id, expectedCreatedAt, index, text),
  );
  bind(channels.rename, (id: string, title: string) => store.rename(id, title));
  bind(channels.trim, (id: string, from: number, to: number) => store.trim(id, from, to));
  bind(channels.transcribeLocal, async (id: string) => {
    if (transcribing) throw Error("voice_replay_transcription_busy");
    transcribing = true;
    try {
      return await store.transcribeLocal(id, transcribeLocal);
    } finally {
      transcribing = false;
    }
  });
  bind(channels.remove, (id: string) => store.remove(id));
  bind(channels.export, async (id: string) => {
    const bytes = await store.read(id);
    const parent = window();
    if (!parent || parent.isDestroyed()) return false;
    const result = await dialog.showSaveDialog(parent, {
      title: "导出语音片段",
      defaultPath: "语音片段.wav",
      filters: [{ name: "WAV 音频", extensions: ["wav"] }],
    });
    if (result.canceled || !result.filePath) return false;
    // Never overwrite library/source files or an existing file chosen accidentally.
    await fs.writeFile(result.filePath, bytes, { flag: "wx" });
    return true;
  });
  bind(channels.shortcut, (next: string) => {
    if (typeof next !== "string" || next.length > 80) return false;
    if (next === accelerator && (!next || globalShortcut.isRegistered(next))) return true;
    if (!next) {
      if (accelerator) globalShortcut.unregister(accelerator);
      accelerator = "";
      return true;
    }
    // Modifiers are required; avoid stealing unmodified game/phone keys.
    if (!/^(?:CommandOrControl|Control|Ctrl)\+(?:Shift|Alt)\+F(?:[1-9]|1[0-2])$/.test(next))
      return false;
    let registered = false;
    try {
      if (!globalShortcut.isRegistered(next))
        registered = globalShortcut.register(next, () => {
          const contents = window()?.webContents;
          if (contents && !contents.isDestroyed()) contents.send(channels.saveShortcut);
        });
    } catch {
      return false;
    }
    if (!registered) return false;
    if (accelerator) globalShortcut.unregister(accelerator);
    accelerator = next;
    return true;
  });
  app.once("will-quit", () => {
    if (accelerator) globalShortcut.unregister(accelerator);
  });
}
