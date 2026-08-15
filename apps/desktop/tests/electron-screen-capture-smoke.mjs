import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, desktopCapturer, session } from "electron";

const directory = path.dirname(fileURLToPath(import.meta.url));
const timeout = setTimeout(() => {
  console.error(JSON.stringify({ ok: false, error: "screen_capture_smoke_timeout" }));
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
  const pickerSources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  const selectedSource = pickerSources.find((source) => source.id.startsWith("screen:"));
  console.log(JSON.stringify({ pickerSourceCount: pickerSources.length }));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback(selectedSource ? { video: selectedSource } : {});
  });

  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadFile(path.join(directory, "electron-screen-capture-smoke.html"));

  try {
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        try {
          if (!navigator.mediaDevices?.getDisplayMedia) {
            return { ok: false, error: "display_media_unavailable", protocol: location.protocol };
          }
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: 2560, max: 2560 },
              height: { ideal: 1440, max: 1440 },
              frameRate: { ideal: 21, max: 24 },
            },
            audio: false,
          });
          const displayTrack = stream.getVideoTracks()[0];
          const displaySettings = displayTrack?.getSettings?.() ?? {};
          stream.getTracks().forEach((item) => item.stop());
          await new Promise((resolve) => setTimeout(resolve, 250));
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: ${JSON.stringify(selectedSource?.id ?? "")},
                maxWidth: 2560,
                maxHeight: 1440,
                maxFrameRate: 24,
              },
            },
            audio: false,
          });
          const fallbackTrack = fallbackStream.getVideoTracks()[0];
          const fallbackSettings = fallbackTrack?.getSettings?.() ?? {};
          fallbackStream.getTracks().forEach((item) => item.stop());
          return {
            ok: Boolean(displayTrack && fallbackTrack),
            displaySettings,
            fallbackSettings,
          };
        } catch (error) {
          return { ok: false, name: error.name, error: error.message };
        }
      })();
    `);
    console.log(JSON.stringify(result));
    clearTimeout(timeout);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        name: error instanceof Error ? error.name : "Error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    clearTimeout(timeout);
    app.exit(1);
  }
});
