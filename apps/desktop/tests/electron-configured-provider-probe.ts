/** Explicit read-only live provider probe. Never part of automated smoke or distributed builds. */
import { app, safeStorage } from "electron";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  lstatSync,
  rmSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CustomAiProviderStore } from "../src/main/custom-ai-provider-store";
import { recoverProviderPlaintext } from "../src/main/provider-encryption-recovery";
import { runLiveRecordingProbe } from "./live-recording-provider-probe";
import { AiTranscriptionProviderStore } from "../src/main/ai-transcription-provider-store";

if (!process.argv.includes("--probe-configured-provider")) process.exit(2);
const profile = process.argv.includes("--desktop-profile") ? "shanghao-desktop" : "shanghao";
const source = path.join(app.getPath("appData"), profile);
const parent = realpathSync(tmpdir());
const root =
  process.env.SHANGHAO_PROVIDER_PROBE_ROOT ??
  mkdtempSync(path.join(parent, "shanghao-provider-probe-"));
if (
  path.dirname(realpathSync(root)) !== parent ||
  !path.basename(root).startsWith("shanghao-provider-probe-") ||
  lstatSync(root).isSymbolicLink()
)
  throw Error("probe_profile_invalid");
mkdirSync(path.join(root, "session"), { recursive: true });
// safeStorage's opaque OS-wrapped encryption context is profile-specific. Copy only that
// context into an isolated test profile; never reuse/modify the live browser's profile.
const local = JSON.parse(readFileSync(path.join(source, "Local State"), "utf8"));
writeFileSync(path.join(root, "Local State"), JSON.stringify({ os_crypt: local.os_crypt }), {
  mode: 0o600,
});
writeFileSync(
  path.join(root, "session", "Local State"),
  JSON.stringify({ os_crypt: local.os_crypt }),
  { mode: 0o600 },
);
app.setPath("userData", root);
app.setPath("sessionData", path.join(root, "session"));
app.once("quit", () => {
  try {
    if (
      !lstatSync(root).isSymbolicLink() &&
      realpathSync(root) === root &&
      path.dirname(root) === parent
    )
      rmSync(root, { recursive: true, force: true });
  } catch {
    /* Retain only a locked owned test profile. */
  }
});
const deadline = setTimeout(
  () => app.exit(1),
  process.argv.includes("--probe-long-recording") ? 4 * 60 * 60_000 : 60_000,
);
void app.whenReady().then(async () => {
  try {
    if (process.argv.includes("--probe-migration-copy")) {
      const realAppData = app.getPath("appData");
      for (const name of ["shanghao", "shanghao-desktop"]) {
        const isolated = path.join(root, name);
        mkdirSync(path.join(isolated, "ai"), { recursive: true });
        const state = JSON.parse(readFileSync(path.join(realAppData, name, "Local State"), "utf8"));
        writeFileSync(
          path.join(isolated, "Local State"),
          JSON.stringify({ os_crypt: state.os_crypt }),
          { mode: 0o600 },
        );
      }
      app.setPath("appData", root);
      try {
        for (const [name, file] of [
          ["shanghao", "custom-provider.enc"],
          ["shanghao-desktop", "transcription-provider.enc"],
        ]) {
          const from = path.join(realAppData, name!, "ai", file!);
          const bytes = readFileSync(from);
          const isolated = path.join(root, name!);
          const target = path.join(isolated, "ai", file!);
          writeFileSync(target, bytes, { mode: 0o600 });
          const store =
            file === "custom-provider.enc"
              ? new CustomAiProviderStore(undefined, isolated)
              : new AiTranscriptionProviderStore(isolated);
          await store.status();
          await store.status();
          const migrated = readFileSync(target);
          JSON.parse(safeStorage.decryptString(migrated));
          if (
            bytes.equals(migrated) ||
            !readFileSync(from).equals(bytes) ||
            !readdirSync(path.dirname(target)).some(
              (item) => item.startsWith(`${file}.recovery-`) && item.endsWith(".bak"),
            )
          )
            throw Error("probe_migration_invalid");
          console.log(
            JSON.stringify({
              stage: "migration-copy",
              profile: name,
              file,
              backupPreserved: true,
              currentSafeStorageReadable: true,
              sourceProfileModified: false,
            }),
          );
        }
      } finally {
        app.setPath("appData", realAppData);
      }
    }
    let decoded: string;
    try {
      decoded = safeStorage.decryptString(
        readFileSync(path.join(source, "ai/custom-provider.enc")),
      );
    } catch {
      decoded =
        (await recoverProviderPlaintext(
          readFileSync(path.join(source, "ai/custom-provider.enc")),
          app.getPath("appData"),
        )) ?? "";
    }
    try {
      JSON.parse(decoded);
    } catch {
      console.log(JSON.stringify({ profile, stage: "parse", ok: false }));
      throw Error("custom_ai_config_unreadable");
    }
    const original = readFileSync(path.join(source, "ai/custom-provider.enc"));
    const provider = new CustomAiProviderStore(
      async (payload) => {
        if (
          [
            "Custom AI provider returned invalid JSON",
            "Custom AI provider request failed",
          ].includes(payload.message)
        )
          console.log(JSON.stringify({ stage: "provider-json-shape", ...payload.context }));
      },
      source,
      {
        isEncryptionAvailable: () => true,
        encryptString: () => {
          throw Error("probe_read_only");
        },
        decryptString: (cipher) => {
          if (!cipher.equals(original)) throw Error("probe_source_changed");
          return decoded;
        },
      },
    );
    const status = await provider.status();
    if (!status.configured) throw Error("custom_ai_not_configured");
    const reply = await provider.generateJson<{ ok: boolean }>({
      prompt: '只返回 JSON 对象 {"ok":true}，不要输出其他内容。',
      maxNewTokens: 32,
      timeoutMs: 20_000,
    });
    console.log(
      JSON.stringify({
        profile,
        configured: true,
        model: status.model,
        jsonResponseValid: reply.ok === true,
        sourceProfileModified: false,
      }),
    );
    if (reply.ok === true && process.argv.includes("--probe-long-recording"))
      await runLiveRecordingProbe(provider, source);
    clearTimeout(deadline);
    app.exit(reply.ok === true ? 0 : 1);
  } catch (error) {
    const code =
      error instanceof Error && /^(custom_ai|ai)_[a-z_0-9]+$/.test(error.message)
        ? error.message
        : "provider_probe_failed";
    console.log(JSON.stringify({ profile, ok: false, code, sourceProfileModified: false }));
    clearTimeout(deadline);
    app.exit(1);
  }
});
