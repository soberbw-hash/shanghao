import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeStorage } from "electron";

import type { AiHuggingFaceAccessStatus, RendererLogPayload } from "@private-voice/shared";

const TOKEN_PATTERN = /^hf_[A-Za-z0-9]{20,256}$/;

/** Keeps a Hugging Face read token encrypted by Windows and outside settings.json. */
export class HuggingFaceAccessStore {
  private readonly filePath: string;

  constructor(
    userDataDirectory: string,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {
    this.filePath = path.join(userDataDirectory, "ai", "hugging-face-access.bin");
  }

  async status(): Promise<AiHuggingFaceAccessStatus> {
    return { configured: Boolean(await this.accessToken()) };
  }

  async save(tokenInput: string): Promise<AiHuggingFaceAccessStatus> {
    const token = tokenInput.trim();
    if (!TOKEN_PATTERN.test(token)) throw new Error("hugging_face_token_invalid");
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("hugging_face_secure_storage_unavailable");
    }
    const encrypted = await safeStorage.encryptStringAsync(token);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, encrypted, { flag: "wx" });
    await rename(temporary, this.filePath);
    await this.log("info", "Hugging Face access saved");
    return { configured: true };
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
    await this.log("info", "Hugging Face access cleared");
  }

  async accessToken(): Promise<string | undefined> {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return undefined;
      const encrypted = await readFile(this.filePath);
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const token = decrypted.result.trim();
      if (!TOKEN_PATTERN.test(token)) throw new Error("hugging_face_token_invalid");
      if (decrypted.shouldReEncrypt) await this.save(token);
      return token;
    } catch {
      return undefined;
    }
  }

  private async log(level: RendererLogPayload["level"], message: string): Promise<void> {
    await this.writeLog?.({ category: "app", level, message });
  }
}
