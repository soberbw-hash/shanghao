import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { safeStorage } from "electron";

export interface PersistedAccountSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  /** Identifies the auth provider so a migration never restores a stale token. */
  provider?: "cloudbase" | "supabase";
}

const isPersistedSession = (value: unknown): value is PersistedAccountSession => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedAccountSession>;
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    candidate.accessToken.length <= 8_192 &&
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.length > 0 &&
    candidate.refreshToken.length <= 4_096 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    typeof candidate.tokenType === "string" &&
    candidate.tokenType.length <= 32
  );
};

/** Keeps account credentials outside settings.json and encrypts them with the OS key store. */
export class AccountSessionStore {
  private readonly filePath: string;

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "account-session.bin");
  }

  async read(): Promise<PersistedAccountSession | undefined> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch {
      return undefined;
    }

    try {
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const parsed = JSON.parse(decrypted.result) as unknown;
      if (!isPersistedSession(parsed)) throw new Error("invalid_account_session_shape");
      if (decrypted.shouldReEncrypt) await this.write(parsed);
      return parsed;
    } catch {
      await this.clear();
      return undefined;
    }
  }

  async write(session: PersistedAccountSession): Promise<void> {
    if (!isPersistedSession(session)) throw new Error("invalid_account_session_shape");
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error("account_secure_storage_unavailable");
    }
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(session));
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, encrypted, { flag: "wx" });
    await rename(temporaryPath, this.filePath);
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
