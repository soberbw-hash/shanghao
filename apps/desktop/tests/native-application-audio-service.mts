import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { ApplicationAudioService } from "../src/main/application-audio-service";

// Hardware probe is intentionally outside *.test.ts: only an owned silent process is captured.
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  windowsHide: true,
  stdio: "ignore",
});
try {
  assert.ok(child.pid);
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${child.pid}).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`,
    ],
    { windowsHide: true },
  );
  const creationTime = stdout.trim();
  assert.match(creationTime, /^\d+$/);
  for (const target of ["target-application-audio-picker", "target-application-audio"]) {
    const executablePath = path.resolve(
      import.meta.dirname,
      "../../../native",
      target,
      "release/shanghao-core.exe",
    );
    if (!existsSync(executablePath)) continue;
    let packets = 0;
    let frames = 0;
    let closed = false;
    const service = new ApplicationAudioService({
      executablePath,
      isWindows: true,
      windowsBuild: 30000,
      listNativeSources: async () => [
        { pid: child.pid!, creationTime, processName: "node.exe", name: "isolated silent fixture" },
      ],
    });
    try {
      const sources = await service.listSources();
      assert.equal(sources.sources.length, 1);
      const result = await service.start(sources.sources[0]!.id, {
        onPcm: (packet) => {
          assert.equal(packet.sampleRate, 48000);
          assert.ok(packet.channels === 1 || packet.channels === 2);
          assert.ok(packet.frames > 0 && packet.frames <= 960);
          packets++;
          frames += packet.frames;
        },
        onState: (state) => {
          if (state.phase === "stopped") closed = true;
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(packets > 0 && frames > 0, "native packets did not pass production framing/parser");
      await service.stop(result.sessionId);
      assert.ok(closed);
      process.stdout.write(
        JSON.stringify({
          helper: target,
          productionService: true,
          packets,
          frames,
          stopped: closed,
          source: "owned silent fixture",
        }) + "\n",
      );
    } finally {
      await service.close();
    }
  }
} finally {
  child.kill();
}
