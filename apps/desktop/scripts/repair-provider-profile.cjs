// Explicit local maintenance only; never bundled, scheduled or run by smoke tests.
const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
if (!process.argv.includes("--repair-provider-profile")) process.exit(2);
const profile = process.argv.find((arg) => arg.startsWith("--profile="))?.slice(10);
if (!["shanghao", "shanghao-desktop"].includes(profile)) process.exit(2);
const appData = app.getPath("appData");
const target = path.join(appData, profile);
const root = require("../tests/electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "provider-repair",
);
function assertRegular(file) {
  if (fs.lstatSync(file).isSymbolicLink() || fs.lstatSync(path.dirname(file)).isSymbolicLink())
    throw Error("provider_repair_linked_path");
}
assertRegular(target);
const context = path.join(target, "Local State");
assertRegular(context);
const localBytes = fs.readFileSync(context);
const local = JSON.parse(localBytes);
const wrappedContext = JSON.stringify({ os_crypt: local.os_crypt });
for (const directory of [root, path.join(root, "session"), path.join(root, "context", profile)]) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "Local State"), wrappedContext, { mode: 0o600 });
}
const deadline = setTimeout(() => app.exit(1), 60_000);
app
  .whenReady()
  .then(async () => {
    require("tsx/cjs");
    const {
      recoverProviderPlaintext,
      readBoundedProviderFile,
      migrateRecoveredProvider,
    } = require("../src/main/provider-encryption-recovery.ts");
    // Refuse writes unless this isolated Electron actually uses the target's encryption key.
    const challenge = "shanghao-provider-maintenance-context";
    const ciphertext = safeStorage.encryptString(challenge);
    if ((await recoverProviderPlaintext(ciphertext, path.join(root, "context"))) !== challenge)
      throw Error("provider_repair_context_mismatch");
    const assertContext = () => {
      assertRegular(context);
      if (
        JSON.parse(fs.readFileSync(context, "utf8")).os_crypt?.encrypted_key !==
        local.os_crypt?.encrypted_key
      )
        throw Error("provider_repair_context_changed");
    };
    for (const name of ["custom-provider.enc", "transcription-provider.enc"]) {
      const file = path.join(target, "ai", name);
      let original;
      try {
        original = await readBoundedProviderFile(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (
          name !== "transcription-provider.enc" ||
          !process.argv.includes("--restore-missing-cloud-key")
        )
          continue;
        const other = path.join(appData, profile === "shanghao" ? "shanghao-desktop" : "shanghao");
        assertRegular(other);
        const source = path.join(other, "ai", name);
        assertRegular(source);
        const decoded = await recoverProviderPlaintext(
          await readBoundedProviderFile(source),
          appData,
        );
        const key = JSON.parse(decoded ?? "{}").cloudApiKey;
        if (typeof key !== "string" || !key.trim() || key.length > 512)
          throw Error("provider_repair_no_cloud_key", { cause: error });
        const encrypted = safeStorage.encryptString(JSON.stringify({ cloudApiKey: key }));
        assertContext();
        assertRegular(path.dirname(file));
        // Exclusive creation never replaces a key saved concurrently by the app.
        const temporary = `${file}.${require("node:crypto").randomUUID()}.tmp`;
        try {
          fs.writeFileSync(temporary, encrypted, { flag: "wx", mode: 0o600 });
          fs.linkSync(temporary, file);
        } finally {
          if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        console.log(JSON.stringify({ profile, file: name, restoredMissingCloudKey: true }));
        continue;
      }
      assertRegular(file);
      try {
        JSON.parse(safeStorage.decryptString(original));
        continue;
      } catch {
        /* Recover original context. */
      }
      const decoded = await recoverProviderPlaintext(original, appData);
      if (!decoded) throw Error("provider_repair_unrecoverable");
      const validate = (config) => {
        const valid =
          name === "custom-provider.enc"
            ? typeof config?.apiKey === "string" &&
              typeof config?.baseUrl === "string" &&
              typeof config?.model === "string"
            : typeof config?.cloudApiKey === "string" || typeof config?.custom?.apiKey === "string";
        if (!valid) throw Error("provider_repair_invalid_config");
      };
      assertContext();
      migrateRecoveredProvider(file, original, decoded, validate, (value) =>
        safeStorage.encryptString(value),
      );
      if (safeStorage.decryptString(fs.readFileSync(file)) !== decoded)
        throw Error("provider_repair_verification_failed");
      console.log(
        JSON.stringify({ profile, file: name, restored: true, encryptedBackupPreserved: true }),
      );
    }
    console.log(JSON.stringify({ profile, complete: true, settingsChanged: false }));
    clearTimeout(deadline);
    app.quit();
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        profile,
        complete: false,
        code: /^provider_repair_[a-z_]+$/.test(error.message)
          ? error.message
          : "provider_repair_failed",
      }),
    );
    clearTimeout(deadline);
    app.exit(1);
  });
