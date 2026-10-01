import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** One owner, serialized transactions, no mutation visible before an atomic commit. */
export class VersionedJsonStore<T> {
  private queue: Promise<void> = Promise.resolve();
  private revision = 0;
  private constructor(
    private value: T,
    private readonly filePath?: string,
  ) {}

  static async open<T>(filePath: string | undefined, empty: T, validate: (value: unknown) => T) {
    let value = empty;
    if (filePath) {
      try {
        value = validate(JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, "")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return new VersionedJsonStore(value, filePath);
  }

  snapshot(): T {
    return structuredClone(this.value);
  }

  getRevision(): number {
    return this.revision;
  }

  transact<R>(operation: (draft: T) => R): Promise<R> {
    const transaction = this.queue.then(async () => {
      const draft = this.snapshot();
      const result = operation(draft);
      if (this.filePath) await this.commit(draft);
      this.value = draft;
      this.revision++;
      return result;
    });
    this.queue = transaction.then(
      () => undefined,
      () => undefined,
    );
    return transaction;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async commit(value: T): Promise<void> {
    const destination = this.filePath!;
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
