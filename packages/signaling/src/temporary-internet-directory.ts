import { stat } from "node:fs/promises";
import { VersionedJsonStore } from "./versioned-json-store";
import {
  verifyInternetRegistration,
  normalizeInternetRegistration,
  verifyInternetHandoffChain,
  type SignedInternetRegistration,
  type TemporaryInternetHandoff,
} from "./temporary-internet-protocol";
export interface InternetDirectoryRecord {
  authority: SignedInternetRegistration;
  terminal: boolean;
  retainedUntil: number;
}
interface Data {
  version: 1;
  entries: InternetDirectoryRecord[];
}
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** Public lookup metadata and epoch high-water marks only. No tickets, private checkpoint, transcript or media. */
export class TemporaryInternetDirectory {
  private store?: VersionedJsonStore<Data>;
  readonly ready: Promise<void>;
  constructor(
    file: string | undefined,
    private readonly collision: (code: string) => boolean,
    private readonly now = Date.now,
  ) {
    this.ready = this.open(file);
  }
  private async open(file?: string) {
    if (file)
      try {
        if ((await stat(file)).size > 16 * 1024 * 1024)
          throw Error("temporary_bridge_directory_invalid");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    this.store = await VersionedJsonStore.open<Data>(file, { version: 1, entries: [] }, (value) => {
      const d = value as Data;
      if (!d || d.version !== 1 || !Array.isArray(d.entries) || d.entries.length > 4096)
        throw Error("temporary_bridge_directory_invalid");
      const sessions = new Set<string>(),
        codes = new Set<string>();
      for (const e of d.entries) {
        if (
          !e ||
          typeof e.terminal !== "boolean" ||
          !Number.isSafeInteger(e.retainedUntil) ||
          e.retainedUntil < 0 ||
          !verifyInternetRegistration(e.authority, e.authority?.payload?.issuedAt) ||
          sessions.has(e.authority.payload.sessionId) ||
          (!e.terminal && codes.has(e.authority.payload.code))
        )
          throw Error("temporary_bridge_directory_invalid");
        sessions.add(e.authority.payload.sessionId);
        if (!e.terminal) codes.add(e.authority.payload.code);
      }
      return { version: 1, entries: structuredClone(d.entries) };
    });
  }
  records(): InternetDirectoryRecord[] {
    return this.store?.snapshot().entries ?? [];
  }
  hasCode(code: string): boolean {
    return (
      !this.store ||
      this.records().some(
        (e) => !e.terminal && e.retainedUntil > this.now() && e.authority.payload.code === code,
      )
    );
  }
  async register(
    signed: SignedInternetRegistration,
    handoff?: TemporaryInternetHandoff,
  ): Promise<InternetDirectoryRecord> {
    await this.ready;
    if (!verifyInternetRegistration(signed, this.now()))
      throw Error("temporary_bridge_registration_invalid");
    signed = normalizeInternetRegistration(signed, this.now())!;
    const previous = this.store!.snapshot().entries.find(
      (e) => e.authority.payload.sessionId === signed.payload.sessionId,
    );
    const stable = (a: SignedInternetRegistration, b: SignedInternetRegistration) =>
      JSON.stringify([
        a.payload.sessionId,
        a.payload.authorityId,
        a.payload.publicKey,
        a.payload.epoch,
        a.payload.revision,
        a.payload.code,
        a.payload.certificateSha256,
        a.payload.members,
      ]) ===
      JSON.stringify([
        b.payload.sessionId,
        b.payload.authorityId,
        b.payload.publicKey,
        b.payload.epoch,
        b.payload.revision,
        b.payload.code,
        b.payload.certificateSha256,
        b.payload.members,
      ]);
    // TTL refreshes do not rewrite the public high-water file every five seconds.
    if (
      previous &&
      !previous.terminal &&
      stable(previous.authority, signed) &&
      previous.retainedUntil > this.now() + 23 * 60 * 60 * 1000
    )
      return { ...previous, authority: structuredClone(signed) };
    return this.store!.transact((data) => {
      const p = signed.payload,
        now = this.now();
      data.entries = data.entries.filter((e) => e.retainedUntil > now);
      const e = data.entries.find((e) => e.authority.payload.sessionId === p.sessionId);
      if (e?.terminal) throw Error("temporary_bridge_session_closed");
      if (!e) {
        if (
          p.epoch !== 1 ||
          data.entries.length >= 4096 ||
          data.entries.filter(
            (e) => !e.terminal && e.authority.payload.authorityId === p.authorityId,
          ).length >= 16
        )
          throw Error("temporary_bridge_registration_invalid");
      } else {
        const old = e.authority.payload;
        if (
          p.epoch === old.epoch
            ? p.authorityId !== old.authorityId ||
              p.publicKey !== old.publicKey ||
              p.revision < old.revision ||
              (p.revision === old.revision && !stable(e.authority, signed))
            : !handoff || !verifyInternetHandoffChain(old, p, handoff, now)
        )
          throw Error("temporary_bridge_authority_invalid");
      }
      if (
        data.entries.some(
          (e) =>
            !e.terminal &&
            e.authority.payload.code === p.code &&
            e.authority.payload.sessionId !== p.sessionId,
        ) ||
        this.collision(p.code)
      )
        throw Error("temporary_bridge_code_conflict");
      const next = {
        authority: structuredClone(signed),
        terminal: false,
        retainedUntil: now + RETENTION_MS,
      };
      const index = data.entries.findIndex((e) => e.authority.payload.sessionId === p.sessionId);
      if (index < 0) data.entries.push(next);
      else data.entries[index] = next;
      return next;
    });
  }
  async closeSession(sessionId: string, authorityId: string): Promise<InternetDirectoryRecord> {
    await this.ready;
    return this.store!.transact((data) => {
      const e = data.entries.find((e) => e.authority.payload.sessionId === sessionId);
      if (!e || e.authority.payload.authorityId !== authorityId)
        throw Error("temporary_bridge_authority_invalid");
      e.terminal = true;
      e.retainedUntil = this.now() + RETENTION_MS;
      return structuredClone(e);
    });
  }
  async flush(): Promise<void> {
    await this.ready;
    await this.store!.flush();
  }
}
