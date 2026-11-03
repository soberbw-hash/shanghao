import path from "node:path";

import { app, BrowserWindow, desktopCapturer, session } from "electron";
import { ScreenCaptureService } from "../src/main/screen-capture-service";

require(path.resolve("tests/electron-isolated-profile.cjs")).configureIsolatedProfile(
  app,
  "screen-service",
);

const directory = path.resolve("tests");
const timeout = setTimeout(() => {
  console.error(JSON.stringify({ ok: false, error: "screen_capture_smoke_timeout" }));
  app.exit(1);
}, 30_000);

app.whenReady().then(async () => {
  const enumerationStartedAt = Date.now();
  const pickerSources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  const selectedSource = pickerSources.find((source) => source.id.startsWith("screen:"));
  console.log(
    JSON.stringify({
      pickerSourceCount: pickerSources.length,
      pickerEnumerationMs: Date.now() - enumerationStartedAt,
      pickerPreviewCount: pickerSources.filter((source) => !source.thumbnail.isEmpty()).length,
    }),
  );
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media" || permission === "display-capture");
  });
  const service = new ScreenCaptureService();
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const source = selectedSource
      ? await service.resolveRequestedSource(selectedSource.id)
      : undefined;
    callback(source ? { video: source } : {});
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
            { quality: "1440p", width: 2560, height: 1440, frameRate: 30 },
          ];
          // A live track alone does not prove the capture is producing frames.
          // Inspect dimensions only; never persist or log screen pixels.
          const readFrame = async (track) => {
            if (!globalThis.MediaStreamTrackProcessor) throw new Error("capture_frame_verification_unavailable");
            const clone = track.clone();
            const reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 }).readable.getReader();
            let timer;
            try {
              const result = await Promise.race([
                reader.read(),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("capture_frame_timeout")), 4000); }),
              ]);
              if (result.done || !result.value) throw new Error("capture_frame_missing");
              const frame = result.value;
              const dimensions = { width: frame.displayWidth, height: frame.displayHeight };
              frame.close();
              return { supported: true, ...dimensions };
            } finally {
              clearTimeout(timer);
              clone.stop();
              await reader.cancel().catch(() => {});
            }
          };
          const captures = [];
          for (const profile of profiles) {
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            });
            const displayTrack = stream.getVideoTracks()[0];
            const startedLive = displayTrack?.readyState === "live";
            await displayTrack?.applyConstraints?.({
              width: { ideal: profile.width, max: profile.width },
              height: { ideal: profile.height, max: profile.height },
              frameRate: { ideal: profile.frameRate, max: profile.frameRate },
            });
            const actual = displayTrack?.getSettings?.() ?? {};
            const frame = await readFrame(displayTrack);
            stream.getTracks().forEach((item) => item.stop());
            captures.push({
              requested: profile,
              actual,
              frame,
              startedLive,
              stopped: displayTrack?.readyState === "ended" &&
                stream.getTracks().every((item) => item.readyState === "ended"),
            });
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
          const fallbackStartedLive = fallbackTrack?.readyState === "live";
          const fallbackFrame = await readFrame(fallbackTrack);
          fallbackStream.getTracks().forEach((item) => item.stop());
          return {
            ok: captures.every((capture) => capture.startedLive && capture.stopped &&
              capture.frame.width > 0 && capture.frame.height > 0) &&
              fallbackStartedLive && fallbackTrack?.readyState === "ended" &&
              fallbackFrame.width > 0 && fallbackFrame.height > 0,
            captures,
            fallbackSettings,
            fallbackFrame,
            fallbackStopped: fallbackTrack?.readyState === "ended",
          };
        } catch (error) {
          return { ok: false, name: error.name, error: error.message };
        }
      })();
    `);
    console.log(
      JSON.stringify({ ...result, sourceResolution: "production-service-fresh-enumeration" }),
    );
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
