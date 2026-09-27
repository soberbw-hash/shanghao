import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

interface RegistryState {
  schemaVersion: 1;
  completed: Record<string, string>;
}

/** Marks a migration only after its task succeeds. Interrupted tasks run again next launch. */
export class BootstrapMigrationRegistry {
  private state?: RegistryState;

  constructor(private readonly filePath: string) {}

  async runOnce(key: string, task: () => Promise<void>): Promise<boolean> {
    if (!/^[a-z0-9_]+$/.test(key)) throw new Error("invalid_bootstrap_migration_key");
    const state = await this.load();
    if (state.completed[key]) return false;
    await task();
    const next: RegistryState = {
      schemaVersion: 1,
      completed: { ...state.completed, [key]: new Date().toISOString() },
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
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
    if (parsed.schemaVersion !== 1 || !parsed.completed || typeof parsed.completed !== "object") {
      throw new Error("invalid_bootstrap_migration_registry");
    }
    this.state = parsed;
    return parsed;
  }
}
