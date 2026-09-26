import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";

const reservePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
};

const relayPort = await reservePort();
const sidecarPort = await reservePort();
const child = spawn(
  process.execPath,
  [resolve("packages/signaling/phone-mic-sidecar-dist/phone-mic-sidecar.cjs")],
  {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(relayPort),
      PHONE_MIC_SIDECAR_PORT: String(sidecarPort),
      SHANGHAO_VERSION: "3.2.0-test",
    },
  },
);
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${String(chunk)}`.slice(-4_096);
});

try {
  let healthResponse;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (child.exitCode !== null) throw new Error(`sidecar exited: ${stderr}`);
    try {
      healthResponse = await fetch(`http://127.0.0.1:${sidecarPort}/phone-mic/health`, {
        signal: AbortSignal.timeout(500),
      });
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  assert(healthResponse, `sidecar failed to start: ${stderr}`);
  assert.equal(healthResponse.status, 503);
  const health = await healthResponse.json();
  assert.equal(health.version, "3.2.0-test");
  assert.equal(health.status, "degraded");
  assert.equal(health.relayReady, false);
  const page = await fetch(`http://127.0.0.1:${sidecarPort}/phone-mic`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /手机麦克风/);
  console.log("Standalone phone-mic sidecar startup, health and page verified");
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, "exit");
}
