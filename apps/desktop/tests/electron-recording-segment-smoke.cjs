/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, require */

const { app, BrowserWindow } = require("electron");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    await window.loadURL("data:text/html,<title>recording-segment-smoke</title>");
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const context = new AudioContext({ sampleRate: 48000 });
        await context.resume();
        const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
          .find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mimeType) throw new Error("segment_mime_unavailable");
        const mixBus = context.createGain();
        mixBus.channelCount = 1;
        mixBus.channelCountMode = "explicit";
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.ratio.value = 1.8;
        const peakGuard = context.createDynamicsCompressor();
        peakGuard.threshold.value = -1.5;
        peakGuard.ratio.value = 20;
        const mixedDestination = context.createMediaStreamDestination();
        mixedDestination.channelCount = 1;
        mixedDestination.channelCountMode = "explicit";
        mixBus.connect(compressor).connect(peakGuard).connect(mixedDestination);

        const oscillators = [];
        const segmentDestinations = [];
        for (let index = 0; index < 5; index += 1) {
          const oscillator = context.createOscillator();
          const sourceGain = context.createGain();
          sourceGain.gain.value = [0.02, 0.05, 0.12, 0.3, 0.8][index];
          const segmentDestination = context.createMediaStreamDestination();
          segmentDestination.channelCount = 1;
          segmentDestination.channelCountMode = "explicit";
          oscillator.frequency.value = 180 + index * 45;
          oscillator.connect(sourceGain);
          sourceGain.connect(mixBus);
          sourceGain.connect(segmentDestination);
          oscillator.start();
          oscillators.push(oscillator);
          segmentDestinations.push(segmentDestination);
        }

        const streams = [mixedDestination, ...segmentDestinations].map(
          (destination) => destination.stream,
        );
        const recordings = await Promise.all(streams.map((stream) => new Promise((resolve, reject) => {
          const chunks = [];
          const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 });
          recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
          recorder.onerror = () => reject(new Error("media_recorder_error"));
          recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }).size);
          recorder.start(100);
          setTimeout(() => { recorder.requestData(); recorder.stop(); }, 800);
        })));
        oscillators.forEach((oscillator) => oscillator.stop());
        streams.flatMap((stream) => stream.getTracks()).forEach((track) => track.stop());
        await context.close();
        return {
          ok: recordings.length === 6 && recordings.every((size) => size > 0),
          sampleRate: 48000,
          channels: 1,
          recordingSizes: recordings,
        };
      })()
    `);
    console.log(JSON.stringify(result));
    window.destroy();
    app.exit(result.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    app.exit(1);
  });
