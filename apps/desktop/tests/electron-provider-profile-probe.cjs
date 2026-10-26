/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, console, process, setTimeout, clearTimeout, AbortSignal */
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
if (!process.argv.includes("--probe-provider-profiles")) process.exit(2);
const actual = app.getPath("appData");
const root = require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "provider-profile-probe",
);
const files = [];
for (const profile of ["shanghao", "shanghao-desktop"]) {
  const source = path.join(actual, profile),
    target = path.join(root, profile);
  fs.mkdirSync(path.join(target, "ai"), { recursive: true });
  const local = JSON.parse(fs.readFileSync(path.join(source, "Local State"), "utf8"));
  fs.writeFileSync(path.join(target, "Local State"), JSON.stringify({ os_crypt: local.os_crypt }), {
    mode: 0o600,
  });
  for (const name of ["custom-provider.enc", "transcription-provider.enc"]) {
    const from = path.join(source, "ai", name);
    if (!fs.existsSync(from)) continue;
    const bytes = fs.readFileSync(from);
    fs.writeFileSync(path.join(target, "ai", name), bytes, { mode: 0o600 });
    files.push({
      profile,
      name,
      from,
      target,
      hash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
app.setPath("appData", root);
const timer = setTimeout(() => app.exit(1), 60000);
app
  .whenReady()
  .then(async () => {
    require("tsx/cjs");
    const { CustomAiProviderStore } = require("../src/main/custom-ai-provider-store.ts");
    const {
      AiTranscriptionProviderStore,
    } = require("../src/main/ai-transcription-provider-store.ts");
    const { recoverProviderPlaintext } = require("../src/main/provider-encryption-recovery.ts");
    for (const entry of files) {
      const file = path.join(entry.target, "ai", entry.name);
      const encrypted = fs.readFileSync(file);
      const report = {
        profile: entry.profile,
        file: entry.name,
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
      };
      try {
        report.rawDecrypt = Boolean(JSON.parse(safeStorage.decryptString(encrypted)));
      } catch (error) {
        report.rawError = error.code ?? error.message;
      }
      report.fallbackRecoverable = Boolean(await recoverProviderPlaintext(encrypted, root));
      try {
        const store =
          entry.name === "custom-provider.enc"
            ? new CustomAiProviderStore(undefined, entry.target)
            : new AiTranscriptionProviderStore(entry.target);
        const state = await store.status();
        report.statusReadable = true;
        report.configured = state.configured ?? state.cloudConfigured;
      } catch (error) {
        report.statusError = error.message;
        report.cause = error.cause?.message;
      }
      report.sourceUnchanged =
        createHash("sha256").update(fs.readFileSync(entry.from)).digest("hex") === entry.hash;
      console.log(JSON.stringify(report));
    }
    if (process.argv.includes("--probe-synthetic-services")) {
      const fixture = path.resolve("artifacts/provider-synthetic.wav");
      const profile = path.join(root, "shanghao-desktop");
      const transcription = new AiTranscriptionProviderStore(profile);
      const result = await transcription.transcribe(
        fixture,
        10_000,
        "cloud",
        AbortSignal.timeout(40_000),
      );
      console.log(
        JSON.stringify({
          stage: "synthetic-cloud-asr",
          nonemptyText: Boolean(result.text.trim()),
          model: result.modelName,
        }),
      );
      if (!result.text.trim()) throw Error("probe_synthetic_asr_empty");
      const text = new CustomAiProviderStore(undefined, profile);
      const reply = await text.generateJson({
        prompt: '只返回 JSON 对象 {"ok":true}。',
        maxNewTokens: 32,
        timeoutMs: 20_000,
      });
      console.log(JSON.stringify({ stage: "synthetic-text-api", validJson: reply.ok === true }));
      if (reply.ok !== true) throw Error("probe_synthetic_text_invalid");
    }
    clearTimeout(timer);
    app.quit();
  })
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    app.exit(1);
  });
