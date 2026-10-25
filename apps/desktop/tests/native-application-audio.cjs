/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const helper = path.resolve(
  __dirname,
  "../../../native/target-application-audio/release/shanghao-core.exe",
);
async function main() {
  if (process.platform !== "win32") throw Error("Windows probe only");
  // A silent, disposable process belongs only to this probe. No microphone,
  // user application, speaker playback or desktop interaction is involved.
  const target = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  let capture;
  try {
    const creation = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${target.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`,
      ],
      { windowsHide: true, encoding: "utf8" },
    ).trim();
    assert.match(creation, /^\d+$/);
    capture = spawn(helper, ["--application-audio-capture", String(target.pid), creation], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let errors = "",
      ready = false,
      packets = 0;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(Error("native_start_timeout")), 7000);
      capture.stdout.on("data", (data) => {
        packets += data.length;
      });
      capture.stderr.on("data", (data) => {
        errors += data.toString();
        for (;;) {
          const end = errors.indexOf("\n");
          if (end < 0) break;
          const line = errors.slice(0, end);
          errors = errors.slice(end + 1);
          const value = JSON.parse(line);
          if (value.type === "diagnostic") console.log(JSON.stringify(value));
          if (value.type === "error") {
            clearTimeout(deadline);
            reject(Error(value.code));
          }
          if (value.type === "ready") {
            ready = true;
            capture.stdin.write("run\n");
            setTimeout(() => capture.stdin.end("stop\n"), 200);
          }
        }
      });
      capture.once("error", reject);
      capture.once("exit", (code) => {
        clearTimeout(deadline);
        if (code === 0 && ready) resolve();
        else reject(Error(`native_probe_exit_${code}`));
      });
    });
    console.log(
      JSON.stringify({
        actualNativeActivation: ready,
        source: "isolated silent test process",
        bytes: packets,
        stopped: true,
      }),
    );
  } finally {
    capture?.kill();
    target.kill();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
