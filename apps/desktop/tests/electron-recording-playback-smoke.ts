import { app, BrowserWindow, protocol } from "electron";

import {
  createRecordingMediaResponse,
  decodeRecordingMediaUrl,
  RECORDING_MEDIA_PROTOCOL,
  toRecordingMediaUrl,
} from "../src/main/recording-library-core";

const shortPath = process.env.SHANGHAO_RECORDING_TEST_SHORT;
const longPath = process.env.SHANGHAO_RECORDING_TEST_LONG;
if (!shortPath || !longPath) throw new Error("recording_test_paths_required");

protocol.registerSchemesAsPrivileged([
  {
    scheme: RECORDING_MEDIA_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  await app.whenReady();
  const allowedPaths = new Set([shortPath, longPath]);
  protocol.handle(RECORDING_MEDIA_PROTOCOL, async (request) => {
    const filePath = decodeRecordingMediaUrl(request.url);
    if (!filePath || !allowedPaths.has(filePath)) return new Response("Not found", { status: 404 });
    return createRecordingMediaResponse(filePath, request.headers.get("range"));
  });

  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await window.loadURL("data:text/html,<audio id='player' preload='metadata'></audio>");
  const result = await window.webContents.executeJavaScript(
    `
      (async () => {
        const audio = document.getElementById("player");
        const waitFor = (event, timeoutMs = 8000) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(event + "_timeout")), timeoutMs);
          audio.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
          audio.addEventListener("error", () => reject(new Error("media_error_" + (audio.error?.code || 0))), { once: true });
        });
        const load = async (src) => {
          audio.src = src;
          audio.load();
          await waitFor("loadedmetadata");
          return audio.duration;
        };
        const waitUntil = async (predicate, timeoutMs) => {
          const deadline = performance.now() + timeoutMs;
          while (!predicate()) {
            if (performance.now() >= deadline) throw new Error("condition_timeout");
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };

        const shortDuration = await load(${JSON.stringify(toRecordingMediaUrl(shortPath))});
        await audio.play();
        await waitUntil(() => audio.currentTime > 1, 4000);
        audio.pause();
        const pausedAt = audio.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (Math.abs(audio.currentTime - pausedAt) > 0.15) throw new Error("pause_failed");
        audio.currentTime = Math.min(shortDuration - 0.5, 2.5);
        await waitFor("seeked");
        const markerTarget = Math.min(shortDuration - 0.25, 3.25);
        audio.currentTime = markerTarget;
        await waitFor("seeked");
        for (const rate of [0.75, 1, 1.25, 1.5, 2]) {
          audio.playbackRate = rate;
          if (audio.playbackRate !== rate) throw new Error("rate_failed_" + rate);
        }
        audio.playbackRate = 1;
        audio.currentTime = 0;
        const shortEnded = waitFor("ended", 15000);
        await audio.play();
        await shortEnded;

        const longDuration = await load(${JSON.stringify(toRecordingMediaUrl(longPath))});
        audio.currentTime = Math.min(30, longDuration / 2);
        await waitFor("seeked");
        audio.currentTime = 0;
        await waitFor("seeked");
        audio.playbackRate = 2;
        const longEnded = waitFor("ended", 45000);
        await audio.play();
        await longEnded;

        return { shortDuration, longDuration, pausedAt, markerTarget, rates: [0.75, 1, 1.25, 1.5, 2], nextLoaded: true };
      })()
    `,
    true,
  );
  await wait(50);
  console.log(JSON.stringify({ ok: true, ...result }));
  window.destroy();
  app.quit();
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  app.exit(1);
});
