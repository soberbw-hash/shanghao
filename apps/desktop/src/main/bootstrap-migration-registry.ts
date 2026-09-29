import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface RegistryState {
  schemaVersion: 1;
  completed: Record<string, string>;
}

/** Marks a migration only after its task succeeds. Interrupted tasks run again next launch. */
export class BootstrapMigrationRegistry {
  private state?: RegistryState;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async runOnce(key: string, task: () => Promise<void>): Promise<boolean> {
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error("invalid_bootstrap_migration_key");
    const result = this.queue.then(() => this.runOnceNow(key, task));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async runOnceNow(key: string, task: () => Promise<void>): Promise<boolean> {
    const state = await this.load();
    if (state.completed[key]) return false;
    await task();
    const next: RegistryState = {
      schemaVersion: 1,
      completed: { ...state.completed, [key]: new Date().toISOString() },
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, this.filePath);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    this.state = next;
    return true;
  }

  private async load(): Promise<RegistryState> {
    if (this.state) return this.state;
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { schemaVersion: 1, completed: {} };
      return this.state;
    }
    const parsed = JSON.parse(raw) as RegistryState;
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      !parsed.completed ||
      typeof parsed.completed !== "object" ||
      Array.isArray(parsed.completed) ||
      !Object.values(parsed.completed).every((value) => typeof value === "string")
    ) {
      throw new Error("invalid_bootstrap_migration_registry");
    }
    this.state = parsed;
    return parsed;
  }
}
