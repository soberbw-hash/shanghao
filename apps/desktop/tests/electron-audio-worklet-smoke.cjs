/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, console, require */

const { app, BrowserWindow } = require("electron");
const { readFileSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:;";

let server;

const microphoneProcessorSource = readFileSync(
  path.join(__dirname, "../src/renderer/src/features/audio/microphoneProcessor.ts"),
  "utf8",
);
const voiceShaperMatch = microphoneProcessorSource.match(
  /const VOICE_SHAPER_WORKLET_SOURCE = `([\s\S]*?)`;/,
);
if (!voiceShaperMatch?.[1]) {
  throw new Error("Unable to read the communication voice shaper worklet source.");
}
const voiceShaperSource = voiceShaperMatch[1]
  .replaceAll("${VOICE_SHAPER_DIAGNOSTICS_INTERVAL_FRAMES}", "24000")
  .replaceAll("${VOICE_SHAPER_WORKLET_NAME}", "shanghao-communication-voice-shaper");

const closeServer = () =>
  new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

const fail = async (error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  await closeServer();
  app.exit(1);
};

app
  .whenReady()
  .then(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, {
        "Content-Security-Policy": CSP,
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(
        "<!doctype html><html><head><title>audio-worklet-smoke</title></head><body></body></html>",
      );
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to start the local AudioWorklet test server.");
    }

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
      },
    });

    try {
      await window.loadURL(`http://127.0.0.1:${address.port}/`);

      const result = await window.webContents.executeJavaScript(`
      (async () => {
        const context = new AudioContext({ sampleRate: 48000 });
        if (!context.audioWorklet) {
          await context.close();
          return { ok: false, error: "audio_worklet_unavailable" };
        }
        const source = ${JSON.stringify(voiceShaperSource)};
        const moduleUrl = URL.createObjectURL(
          new Blob([source], { type: "application/javascript" }),
        );
        try {
          await context.audioWorklet.addModule(moduleUrl);
          const node = new AudioWorkletNode(
            context,
            "shanghao-communication-voice-shaper",
            { outputChannelCount: [1] },
          );
          const oscillator = context.createOscillator();
          const sourceGain = context.createGain();
          const analyser = context.createAnalyser();
          const monitorSilence = context.createGain();
          sourceGain.gain.value = 0.12;
          oscillator.frequency.value = 440;
          analyser.fftSize = 1024;
          monitorSilence.gain.value = 0;
          oscillator.connect(sourceGain);
          sourceGain.connect(node);
          node.connect(analyser);
          analyser.connect(monitorSilence);
          monitorSilence.connect(context.destination);
          const diagnosticsPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("voice_shaper_diagnostics_timeout")),
              2000,
            );
            node.port.onmessage = (event) => {
              if (event.data?.type !== "diagnostics") return;
              clearTimeout(timeout);
              resolve(event.data);
            };
          });
          oscillator.start();
          const diagnostics = await diagnosticsPromise;
          const samples = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(samples);
          let squareTotal = 0;
          for (const sample of samples) squareTotal += sample * sample;
          const rms = Math.sqrt(squareTotal / samples.length);
          oscillator.stop();
          oscillator.disconnect();
          node.disconnect();
          return {
            ok:
              rms > 0.01 &&
              Number.isFinite(diagnostics.averageProcessingMs) &&
              diagnostics.overruns === 0,
            sampleRate: context.sampleRate,
            renderQuantumMs: 128000 / context.sampleRate,
            rms,
            averageProcessingMs: diagnostics.averageProcessingMs,
            maxProcessingMs: diagnostics.maxProcessingMs,
            overruns: diagnostics.overruns,
          };
        } finally {
          URL.revokeObjectURL(moduleUrl);
          await context.close();
        }
      })()
    `);

      console.log(JSON.stringify(result));
      window.destroy();
      await closeServer();
      app.exit(result?.ok === true && result?.sampleRate === 48000 ? 0 : 1);
    } catch (error) {
      window.destroy();
      await fail(error);
    }
  })
  .catch(fail);
