import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { unwrapWindowsKey } from "./platform/WindowsProviderEncryption";
import { open } from "node:fs/promises";
import { readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from "node:fs";
import path from "node:path";

/** Only these historical app profiles are credential migration sources. */
export async function readBoundedProviderFile(file: string, limit = 64 * 1024): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    if ((await handle.stat()).size > limit) throw Error("provider_config_too_large");
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, null);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    if (offset > limit) throw Error("provider_config_too_large");
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

export async function recoverProviderPlaintext(
  encrypted: Buffer,
  appData: string,
  unwrap: (wrapped: Buffer) => Buffer | Promise<Buffer> = unwrapWindowsKey,
): Promise<string | undefined> {
  if (encrypted.length < 31 || encrypted.subarray(0, 3).toString() !== "v10") return;
  for (const profile of ["shanghao", "shanghao-desktop"]) {
    let key: Buffer | undefined;
    let clear: Buffer | undefined;
    try {
      const file = path.join(appData, profile, "Local State");
      if (lstatSync(path.dirname(file)).isSymbolicLink() || lstatSync(file).isSymbolicLink())
        continue;
      const state = JSON.parse((await readBoundedProviderFile(file, 1024 * 1024)).toString("utf8"));
      const wrapped = Buffer.from(state.os_crypt?.encrypted_key ?? "", "base64");
      if (wrapped.subarray(0, 5).toString() !== "DPAPI") continue;
      key = await unwrap(wrapped.subarray(5));
      if (key.length !== 32) continue;
      const cipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(3, 15));
      cipher.setAuthTag(encrypted.subarray(-16));
      clear = Buffer.concat([cipher.update(encrypted.subarray(15, -16)), cipher.final()]);
      return clear.toString("utf8");
    } catch {
      /* A missing or unrelated historical context never grants recovery. */
    } finally {
      key?.fill(0);
      clear?.fill(0);
    }
  }
}

/** Validation and current-context encryption must finish before the original is touched. */
export function migrateRecoveredProvider(
  file: string,
  original: Buffer,
  plaintext: string,
  validate: (value: unknown) => void,
  encrypt: (value: string) => Buffer,
): void {
  validate(JSON.parse(plaintext));
  const replacement = encrypt(plaintext);
  if (lstatSync(file).isSymbolicLink() || lstatSync(path.dirname(file)).isSymbolicLink())
    throw Error("provider_recovery_path_changed");
  const digest = createHash("sha256").update(original).digest("hex");
  const backup = `${file}.recovery-${digest}.bak`;
  try {
    writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "EEXIST" ||
      lstatSync(backup).isSymbolicLink() ||
      lstatSync(backup).size !== original.length ||
      !readFileSync(backup).equals(original)
    )
      throw Error("provider_recovery_backup_failed", { cause: error });
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, replacement, { flag: "wx", mode: 0o600 });
    // Synchronous final check+commit cannot interleave another JS settings writer.
    if (
      lstatSync(file).isSymbolicLink() ||
      lstatSync(file).size !== original.length ||
      lstatSync(path.dirname(file)).isSymbolicLink() ||
      lstatSync(path.dirname(path.dirname(file))).isSymbolicLink() ||
      !readFileSync(file).equals(original)
    )
      throw Error("provider_recovery_owner_changed");
    renameSync(temporary, file);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* No temporary file remains after commit. */
    }
  }
}

const recoveries = new Map<string, Promise<string>>();
export function recoverAndMigrateProvider(
  file: string,
  original: Buffer,
  appData: string,
  validate: (value: unknown) => void,
  encrypt: (value: string) => Buffer,
  unwrap?: (wrapped: Buffer) => Buffer | Promise<Buffer>,
): Promise<string> {
  const pending = recoveries.get(file);
  if (pending) return pending;
  const recovery = (async () => {
    const plaintext = await recoverProviderPlaintext(original, appData, unwrap);
    if (!plaintext) throw Error("provider_recovery_unavailable");
    migrateRecoveredProvider(file, original, plaintext, validate, encrypt);
    return plaintext;
  })();
  recoveries.set(file, recovery);
  void recovery
    .finally(() => {
      if (recoveries.get(file) === recovery) recoveries.delete(file);
    })
    .catch(() => {});
  return recovery;
}
