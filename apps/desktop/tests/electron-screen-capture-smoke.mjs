import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, desktopCapturer, session } from "electron";

const directory = path.dirname(fileURLToPath(import.meta.url));
const timeout = setTimeout(() => {
  console.error(JSON.stringify({ ok: false, error: "screen_capture_smoke_timeout" }));
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
  const enumerationStartedAt = Date.now();
  const pickerSources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const selectedSource = pickerSources.find((source) => source.id.startsWith("screen:"));
  console.log(
    JSON.stringify({
      pickerSourceCount: pickerSources.length,
      pickerEnumerationMs: Date.now() - enumerationStartedAt,
    }),
  );
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
          const profiles = [
            { quality: "720p", width: 1280, height: 720, frameRate: 30 },
            { quality: "1080p", width: 1920, height: 1080, frameRate: 30 },
          ];
          const captures = [];
          for (const profile of profiles) {
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            });
            const displayTrack = stream.getVideoTracks()[0];
            await displayTrack?.applyConstraints?.({
              width: { ideal: profile.width, max: profile.width },
              height: { ideal: profile.height, max: profile.height },
              frameRate: { ideal: profile.frameRate, max: profile.frameRate },
            });
            captures.push({
              requested: profile,
              actual: displayTrack?.getSettings?.() ?? {},
              hasTrack: Boolean(displayTrack),
            });
            stream.getTracks().forEach((item) => item.stop());
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: ${JSON.stringify(selectedSource?.id ?? "")},
              },
            },
            audio: false,
          });
          const fallbackTrack = fallbackStream.getVideoTracks()[0];
          await fallbackTrack?.applyConstraints?.({
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          });
          const fallbackSettings = fallbackTrack?.getSettings?.() ?? {};
          fallbackStream.getTracks().forEach((item) => item.stop());
          return {
            ok: captures.every((capture) => capture.hasTrack) && Boolean(fallbackTrack),
            captures,
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
