import { randomUUID } from "node:crypto";

export interface ChronicleEntry {
  id: string;
  at: number;
  text: string;
}
export interface ChronicleSnapshot {
  notice?: "retrying" | "unavailable";
  sessionId: string;
  participants: string[];
  entries: ChronicleEntry[];
}

interface Session {
  notice?: ChronicleSnapshot["notice"];
  id: string;
  members: Set<string>;
  participants: Set<string>;
  entries: ChronicleEntry[];
  consentRevision: number;
}

/** Ephemeral state only. The transport must authenticate room membership before calling. */
export class RoomChronicleSessions {
  private readonly rooms = new Map<string, Session>();

  snapshot(roomId: string, memberId: string): ChronicleSnapshot | undefined {
    const session = this.rooms.get(roomId);
    if (!session) return undefined;
    this.require(roomId, session.id, memberId);
    return {
      sessionId: session.id,
      participants: [...session.participants],
      entries: this.read(roomId, session.id, memberId),
      notice: session.notice,
    };
  }

  notice(roomId: string, sessionId: string, value: ChronicleSnapshot["notice"]): void {
    const session = this.rooms.get(roomId);
    if (session?.id === sessionId) session.notice = value;
  }

  start(roomId: string, memberId: string, members: readonly string[]): string {
    if (!roomId || !memberId || !members.includes(memberId)) throw new Error("chronicle_forbidden");
    const existing = this.rooms.get(roomId);
    if (existing) {
      if (!existing.members.has(memberId)) throw new Error("chronicle_forbidden");
      return existing.id;
    }
    const session: Session = {
      id: randomUUID(),
      members: new Set(members),
      participants: new Set(),
      entries: [],
      consentRevision: 0,
    };
    this.rooms.set(roomId, session);
    return session.id;
  }

  updateMembers(roomId: string, members: readonly string[]): boolean {
    const session = this.rooms.get(roomId);
    if (!session) return false;
    const next = new Set(members);
    if (next.size === session.members.size && [...next].every((id) => session.members.has(id)))
      return false;
    session.consentRevision++;
    session.members = next;
    for (const id of session.participants)
      if (!session.members.has(id)) session.participants.delete(id);
    if (!session.members.size) this.rooms.delete(roomId);
    return true;
  }

  participate(roomId: string, sessionId: string, memberId: string, enabled: boolean): void {
    const session = this.require(roomId, sessionId, memberId);
    if (enabled) session.participants.add(memberId);
    else if (session.participants.delete(memberId)) session.consentRevision++;
  }

  canSubmit(roomId: string, sessionId: string, memberId: string): boolean {
    try {
      return this.require(roomId, sessionId, memberId).participants.has(memberId);
    } catch {
      return false;
    }
  }

  /** Capture before async recognition; discard results after a withdrawal or membership change. */
  submissionRevision(roomId: string, sessionId: string, memberId: string): number {
    const session = this.require(roomId, sessionId, memberId);
    if (!session.participants.has(memberId)) throw new Error("chronicle_not_participating");
    return session.consentRevision;
  }

  appendSubmission(
    roomId: string,
    sessionId: string,
    memberId: string,
    revision: number,
    entry: ChronicleEntry,
  ): void {
    const session = this.require(roomId, sessionId, memberId);
    if (!session.participants.has(memberId) || session.consentRevision !== revision)
      throw new Error("chronicle_stale_submission");
    this.append(roomId, sessionId, entry);
  }

  private append(roomId: string, sessionId: string, entry: ChronicleEntry): void {
    const session = this.rooms.get(roomId);
    if (!session || session.id !== sessionId) throw new Error("chronicle_stale_session");
    if (!entry.id || !Number.isFinite(entry.at) || !entry.text.trim() || entry.text.length > 800)
      throw new Error("chronicle_invalid_entry");
    if (session.entries.some((item) => item.id === entry.id)) return;
    session.entries.push({ ...entry });
    if (session.entries.length > 60) session.entries.shift();
  }

  read(roomId: string, sessionId: string, memberId: string): ChronicleEntry[] {
    return this.require(roomId, sessionId, memberId).entries.map((entry) => ({ ...entry }));
  }

  stop(roomId: string, sessionId: string, memberId: string): void {
    this.require(roomId, sessionId, memberId);
    this.rooms.delete(roomId);
  }

  private require(roomId: string, sessionId: string, memberId: string): Session {
    const session = this.rooms.get(roomId);
    if (!session || session.id !== sessionId || !session.members.has(memberId))
      throw new Error("chronicle_forbidden");
    return session;
  }
}
