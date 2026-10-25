/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { promisify } = require("node:util"),
  { execFile } = require("node:child_process");
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "participant-recording");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "shanghao-participant-audio-test-"));
  try {
    const file = path.join(__dirname, "fixtures/participant-recording.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      "(async()=>{for(let i=0;i<100&&!window.runParticipantRecordingProbe;i++)await new Promise(r=>setTimeout(r,20));return window.runParticipantRecordingProbe()})()",
    );
    assert.deepEqual(result.failures, []);
    assert.equal(result.tracks.length, 3);
    assert.equal(result.tracks.filter((track) => track.userId === "account-b").length, 2);
    const freqs = [];
    for (const [index, track] of result.tracks.entries()) {
      const input = path.join(directory, `${index}.webm`),
        output = path.join(directory, `${index}.pcm`);
      await fs.writeFile(input, Buffer.from(track.audio));
      await promisify(execFile)(
        require("ffmpeg-static"),
        ["-nostdin", "-v", "error", "-i", input, "-ar", "16000", "-ac", "1", "-f", "s16le", output],
        { windowsHide: true, timeout: 10000 },
      );
      const audio = await fs.readFile(output);
      let crossings = 0,
        energy = 0;
      for (let offset = 2; offset < audio.length; offset += 2) {
        const sample = audio.readInt16LE(offset);
        energy += sample * sample;
        if (audio.readInt16LE(offset - 2) <= 0 && sample > 0) crossings++;
      }
      const frequency = (crossings * 16000) / (audio.length / 2);
      const expected = track.userId === "account-a" ? 440 : 880;
      assert.ok(
        Math.abs(frequency - expected) < 35,
        "independent track contains another source or wrong audio",
      );
      assert.ok(energy > 0);
      freqs.push({ member: track.userId, frequency: Math.round(frequency) });
    }
    console.log(
      JSON.stringify({
        independentTracks: 3,
        reconnectKeepsMember: true,
        frequencyChecks: freqs,
        scope: "synthetic Electron capture, not real multi-device networking",
      }),
    );
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
