import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  accountAvatarPresetForIdentity,
  isAccountAvatarPresetId,
  type AccountAvatarPresetId,
} from "@private-voice/shared";

interface StoredAvatars {
  version: 1;
  avatars: Record<string, AccountAvatarPresetId>;
}

const accountKey = (userId: string): string => createHash("sha256").update(userId).digest("hex");

/** One small, atomic server-side record; never indexes accounts by display name. */
export class AccountAvatarPresetStore {
  private avatars: StoredAvatars["avatars"] = {};
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath?: string,
    private readonly logger?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  static async create(
    filePath?: string,
    logger?: (message: string, context?: Record<string, unknown>) => void,
  ): Promise<AccountAvatarPresetStore> {
    const store = new AccountAvatarPresetStore(filePath?.trim() || undefined, logger);
    if (!store.filePath) return store;
    let contents: string;
    try {
      contents = await readFile(store.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return store;
      throw error;
    }
    const parsed = JSON.parse(contents) as Partial<StoredAvatars>;
    if (parsed.version !== 1 || !parsed.avatars || typeof parsed.avatars !== "object") {
      throw new Error("invalid_account_avatar_store");
    }
    store.avatars = Object.fromEntries(
      Object.entries(parsed.avatars).filter(
        ([key, value]) => /^[a-f0-9]{64}$/.test(key) && isAccountAvatarPresetId(value),
      ),
    );
    return store;
  }

  get(userId: string): AccountAvatarPresetId | undefined {
    return this.avatars[accountKey(userId)];
  }

  getOrAssign(userId: string): Promise<AccountAvatarPresetId> {
    const key = accountKey(userId);
    return this.enqueue(async () => {
      const saved = this.avatars[key];
      if (saved) return saved;
      const selected = accountAvatarPresetForIdentity(userId);
      try {
        await this.persist({ ...this.avatars, [key]: selected });
        this.avatars[key] = selected;
      } catch (error) {
        // A read-only volume must not make an established account impossible to use.
        this.logger?.("account avatar default could not be persisted", {
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
      return selected;
    });
  }

  set(userId: string, presetId: AccountAvatarPresetId): Promise<void> {
    const key = accountKey(userId);
    return this.enqueue(async () => {
      if (!this.filePath) throw new Error("account_avatar_store_not_configured");
      if (this.avatars[key] === presetId) return;
      await this.persist({ ...this.avatars, [key]: presetId });
      this.avatars[key] = presetId;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async persist(avatars: StoredAvatars["avatars"]): Promise<void> {
    if (!this.filePath) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({ version: 1, avatars }), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
