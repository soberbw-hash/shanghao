import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { createMainWindow, listScreenCaptureSources, selectScreenCaptureSource } from "./window";
import { readWindowsElevationStatus } from "./windows-elevation";

// Isolate the packaged renderer from the user's account, room and Electron session.
const directory = process.env.SHANGHAO_SCREEN_CAPTURE_PROBE_DIR;
if (!directory) throw new Error("Missing packaged capture probe directory");
const profile = path.join(directory, "profile");
mkdirSync(profile);
app.setPath("userData", profile);
app.setPath("sessionData", profile);

const finish = (ok: boolean, details: object) => {
  clearTimeout(timeout);
  writeFileSync(path.join(directory, "result.json"), JSON.stringify({ ok, ...details }));
  app.exit(ok ? 0 : 1);
};
const timeout = setTimeout(() => finish(false, { error: "packaged_capture_timeout" }), 25_000);

void app
  .whenReady()
  .then(async () => {
    const elevation = await readWindowsElevationStatus();
    if (elevation.method !== "windows-token" || elevation.isElevated) {
      throw new Error("Expected the packaged app to run with a standard Windows token");
    }
    const window = createMainWindow({ reveal: false });
    await new Promise<void>((resolve, reject) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.once("did-fail-load", (_event, _code, reason) =>
        reject(new Error(reason)),
      );
    });

    const screen = (await listScreenCaptureSources(false)).find(({ id }) =>
      id.startsWith("screen:"),
    );
    if (!screen) throw new Error("No display found by the packaged screen picker");
    selectScreenCaptureSource(screen.id);
    // Check frame dimensions only. Pixels are never saved, printed or sent.
    const frame = (await window.webContents.executeJavaScript(
      `(async () => {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        let reader;
        try {
          const [track] = stream.getVideoTracks();
          reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
          const { value } = await reader.read();
          if (!value) throw new Error("No frame from the selected display");
          const dimensions = [value.displayWidth, value.displayHeight];
          value.close();
          return dimensions;
        } finally {
          stream.getTracks().forEach((track) => track.stop());
          await reader?.cancel();
        }
      })()`,
      true,
    )) as [number, number];
    if (frame.some((dimension) => dimension <= 0)) throw new Error("Invalid display frame");
    finish(true, { version: app.getVersion(), elevated: false, frame });
  })
  .catch((error: unknown) =>
    finish(false, { error: error instanceof Error ? error.message : String(error) }),
  );
