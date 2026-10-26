/* eslint-disable no-console -- Explicit opt-in; prints only success flags and model names. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { CloudAsrHttpController } from "../../../packages/signaling/src/cloud-asr-http-controller";
import { CloudAsrService } from "../../../packages/signaling/src/cloud-asr-service";
import { CloudAiService } from "../../../packages/signaling/src/cloud-ai-service";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import { BuiltInAiClient } from "../src/main/built-in-ai-client";

if (process.env.SHANGHAO_LIVE_BUILT_IN_AI !== "1") throw Error("explicit_live_ai_probe_required");
const keyFile = process.env.SHANGHAO_AI_CREDENTIALS_FILE;
const audioFile = process.env.SHANGHAO_SYNTHETIC_AUDIO_FILE;
if (!keyFile || !audioFile) throw Error("live_probe_input_required");
const source = await readFile(keyFile, "utf8");
const glm = [...new Set(source.match(/\b[a-fA-F0-9]{16,64}\.[A-Za-z0-9_-]{8,128}\b/g) ?? [])][0];
const asr = [...new Set(source.match(/\bsk-[A-Za-z0-9_-]{20,200}\b/g) ?? [])];
if (!glm || asr.length !== 1) throw Error("live_probe_credentials_ambiguous");
const accounts = {
  configured: true,
  verifyAccessToken: async () => ({ userId: "isolated-probe-account" }),
} as unknown as AccountBackend;
const controller = new CloudAsrHttpController(
  accounts,
  () => true,
  new CloudAsrService(asr[0]),
  new CloudAiService({
    apiKey: glm,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash-250414",
  }),
);
const server = createServer((request, response) => {
  void controller.handle(request, response);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new BuiltInAiClient(
    () => `ws://127.0.0.1:${address.port}`,
    async () => "isolated-probe-token",
  );
  const status = await client.status();
  assert.equal(status.transcriptionConfigured, true);
  assert.equal(status.textConfigured, true);
  const result = await client.transcribe(audioFile, 6000, new AbortController().signal);
  assert.ok(result.text.trim());
  const content = await client.organize(
    '仅返回JSON对象：{"ok":true}。这是上号的合成测试，不包含真实聊天。',
  );
  assert.ok(content.trim());
  console.log(
    JSON.stringify({
      proxyRoundTrip: true,
      isolatedAuthenticationStub: true,
      transcriptionModel: result.modelName,
      transcriptionNonempty: true,
      textModel: "glm-4-flash-250414",
      textNonempty: true,
      syntheticAudio: true,
      vendorCredentialsInClient: false,
      productionServerChanged: false,
    }),
  );
} catch {
  console.log(JSON.stringify({ proxyRoundTrip: false, detailsSuppressed: true }));
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
