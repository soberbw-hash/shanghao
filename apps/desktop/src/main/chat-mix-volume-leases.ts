export interface ChatMixSessionId {
  deviceId: string;
  instanceId: string;
  processId: number;
}
export interface ChatMixSession extends ChatMixSessionId {
  volume: number;
  muted: boolean;
}
export interface ChatMixLease extends ChatMixSessionId {
  original: number;
  previous: number;
  intended: number;
}
export interface ChatMixLeaseJournal {
  read(): Promise<ChatMixLease[]>;
  write(leases: readonly ChatMixLease[]): Promise<void>;
}
export interface ChatMixVolumeBackend {
  list(): Promise<ChatMixSession[]>;
  change(
    session: ChatMixSessionId,
    expected: number,
    value: number,
    original?: number,
  ): Promise<{ ok: boolean; conflict?: boolean }>;
  isProcessAlive(pid: number): boolean;
}
const key = (session: ChatMixSessionId) =>
  JSON.stringify([session.deviceId, session.instanceId, session.processId]);
const near = (a: number, b: number) => Math.abs(a - b) <= 0.0001;
const scalar = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/** Original volume is durable before mutation; all writes target one exact session instance. */
export class ChatMixVolumeLeases {
  private leases = new Map<string, ChatMixLease>();
  private readonly confirmed = new Set<string>();
  private readonly relinquished = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly backend: ChatMixVolumeBackend,
    private readonly journal: ChatMixLeaseJournal,
  ) {}

  static async open(
    backend: ChatMixVolumeBackend,
    journal: ChatMixLeaseJournal,
  ): Promise<ChatMixVolumeLeases> {
    const owner = new ChatMixVolumeLeases(backend, journal);
    const entries = await journal.read();
    if (!Array.isArray(entries) || entries.length > 512) throw Error("chat_mix_journal_invalid");
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.deviceId !== "string" ||
        !entry.deviceId ||
        entry.deviceId.length > 1024 ||
        typeof entry.instanceId !== "string" ||
        !entry.instanceId ||
        entry.instanceId.length > 4096 ||
        !Number.isSafeInteger(entry.processId) ||
        entry.processId <= 0 ||
        !scalar(entry.original) ||
        !scalar(entry.previous) ||
        !scalar(entry.intended) ||
        owner.leases.has(key(entry))
      )
        throw Error("chat_mix_journal_invalid");
      owner.leases.set(key(entry), { ...entry });
    }
    return owner;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async commit(next: Map<string, ChatMixLease>): Promise<void> {
    await this.journal.write([...next.values()].map((entry) => ({ ...entry })));
    this.leases = next;
  }
  private async forget(id: string): Promise<void> {
    const next = new Map(this.leases);
    next.delete(id);
    await this.commit(next);
    this.confirmed.delete(id);
  }

  attenuate(
    target: ChatMixSessionId,
    factor: number,
    excludedPids: ReadonlySet<number>,
  ): Promise<boolean> {
    return this.serial(async () => {
      if (!scalar(factor)) throw Error("chat_mix_invalid_factor");
      const id = key(target);
      if (excludedPids.has(target.processId) || this.relinquished.has(id)) return false;
      const current = (await this.backend.list()).find((session) => key(session) === id);
      if (!current || current.muted || !scalar(current.volume)) return false;
      const existing = this.leases.get(id);
      if (
        existing &&
        !near(current.volume, existing.intended) &&
        (this.confirmed.has(id) || !near(current.volume, existing.previous))
      ) {
        await this.forget(id);
        this.relinquished.add(id);
        return false;
      }
      if (!existing && this.leases.size >= 512) throw Error("chat_mix_lease_limit");
      const original = existing?.original ?? current.volume;
      const intended = original * factor;
      if (near(current.volume, intended)) return true;
      const lease = { ...target, original, previous: current.volume, intended };
      const next = new Map(this.leases);
      next.set(id, lease);
      await this.commit(next);
      const result = await this.backend.change(target, current.volume, intended, original);
      if (result.ok) {
        this.confirmed.add(id);
        return true;
      }
      if (result.conflict) {
        await this.forget(id);
        this.relinquished.add(id);
      }
      return false;
    });
  }

  /** Also used at startup. Keep unresolved unplugged-device entries for a later retry. */
  restore(): Promise<{ pending: number }> {
    return this.serial(async () => {
      if (!this.leases.size) {
        this.relinquished.clear();
        return { pending: 0 };
      }
      const sessions = new Map(
        (await this.backend.list()).map((session) => [key(session), session]),
      );
      for (const [id, lease] of [...this.leases]) {
        const current = sessions.get(id);
        if (!current) {
          if (!this.backend.isProcessAlive(lease.processId)) await this.forget(id);
          continue;
        }
        if (!scalar(current.volume)) continue;
        const ours =
          near(current.volume, lease.intended) ||
          (!this.confirmed.has(id) && near(current.volume, lease.previous));
        if (!ours) {
          await this.forget(id);
          this.relinquished.add(id);
          continue;
        }
        if (near(current.volume, lease.original)) {
          await this.forget(id);
          continue;
        }
        const result = await this.backend.change(
          lease,
          current.volume,
          lease.original,
          lease.original,
        );
        if (result.ok || result.conflict) {
          await this.forget(id);
          if (result.conflict) this.relinquished.add(id);
        }
      }
      if (!this.leases.size) this.relinquished.clear();
      return { pending: this.leases.size };
    });
  }
}
