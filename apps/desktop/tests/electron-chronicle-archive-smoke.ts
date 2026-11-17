import { app, ipcMain, dialog } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IPC_CHANNELS } from "@private-voice/shared";
import { registerChronicleArchiveIpc } from "../src/main/chronicle-archive-ipc";

const root = mkdtempSync(path.join(os.tmpdir(), "shanghao-chronicle-ipc-"));
mkdirSync(path.join(root, "session"));
app.setPath("userData", root);
app.setPath("sessionData", path.join(root, "session"));
const timer = setTimeout(() => app.exit(1), 15000);
void app.whenReady().then(async () => {
  let exitCode = 0;
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const originalHandle = ipcMain.handle;
  const originalDialog = dialog.showSaveDialog;
  let userId = "synthetic-a";
  try {
    ipcMain.handle = ((channel: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler)) as typeof ipcMain.handle;
    registerChronicleArchiveIpc(
      { getSnapshot: () => ({ status: "signed_in", profile: { userId } }) } as never,
      { getSnapshot: () => ({ relayServerUrl: "wss://synthetic.invalid" }) } as never,
    );
    const call = (channel: string, ...args: unknown[]) =>
      handlers.get(channel)!(undefined, ...args);
    const item = { id: "synthetic", at: 1, text: "合成纪事，只有隔离测试数据。" };
    await call(IPC_CHANNELS.chronicleArchive.append, "main", [item]);
    const filePath = path.join(root, "export.json");
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath,
    })) as typeof dialog.showSaveDialog;
    assert.deepEqual(await call(IPC_CHANNELS.chronicleArchive.export, "main"), { saved: true });
    const bytes = await readFile(filePath);
    assert.equal(JSON.parse(bytes.toString()).entries[0].text, item.text);
    await assert.rejects(call(IPC_CHANNELS.chronicleArchive.export, "main"), /EEXIST/);
    assert.deepEqual(await readFile(filePath), bytes);
    dialog.showSaveDialog = (async () => {
      userId = "synthetic-b";
      return { canceled: false, filePath: path.join(root, "different.json") };
    }) as typeof dialog.showSaveDialog;
    await assert.rejects(call(IPC_CHANNELS.chronicleArchive.export, "main"), /scope_changed/);
    assert.deepEqual(await call(IPC_CHANNELS.chronicleArchive.read, "main"), []);
    console.log(
      JSON.stringify({
        passed: true,
        syntheticOnly: true,
        exported: true,
        overwriteRefused: true,
        accountIsolation: true,
        dialogStub: true,
      }),
    );
  } catch (error) {
    console.error(String(error));
    exitCode = 1;
  } finally {
    ipcMain.handle = originalHandle;
    dialog.showSaveDialog = originalDialog;
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
  clearTimeout(timer);
  app.exit(exitCode);
});
