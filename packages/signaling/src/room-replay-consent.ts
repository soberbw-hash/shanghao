import { randomUUID } from "node:crypto";

export interface ReplaySnapshot {
  sessionId: string;
  epoch: number;
  members: string[];
  approved: string[];
  enabled: boolean;
}

/** Consent is ephemeral, room-scoped, and invalidated by every membership change. */
export class RoomReplayConsent {
  private readonly rooms = new Map<string, ReplaySnapshot>();

  sync(roomId: string, members: readonly string[]): void {
    const state = this.rooms.get(roomId);
    if (!state) return;
    if (!members.length) {
      this.rooms.delete(roomId);
      return;
    }
    const next = [...new Set(members)].sort();
    if (next.length === state.members.length && next.every((id, i) => id === state.members[i]))
      return;
    state.members = next;
    state.approved = [];
    state.enabled = false;
    state.epoch++;
  }

  start(roomId: string, peerId: string, members: readonly string[]): void {
    if (!members.includes(peerId)) throw Error("replay_forbidden");
    this.sync(roomId, members);
    if (this.rooms.has(roomId)) return;
    this.rooms.set(roomId, {
      sessionId: randomUUID(),
      epoch: 1,
      members: [...new Set(members)].sort(),
      approved: [peerId],
      enabled: members.length === 1,
    });
  }

  vote(roomId: string, peerId: string, sessionId: string, epoch: number, approved: boolean): void {
    const state = this.rooms.get(roomId);
    if (
      !state ||
      state.sessionId !== sessionId ||
      state.epoch !== epoch ||
      !state.members.includes(peerId)
    )
      throw Error("replay_forbidden");
    state.approved = state.approved.filter((id) => id !== peerId);
    if (approved) state.approved.push(peerId);
    state.approved.sort();
    state.enabled = state.members.length > 0 && state.approved.length === state.members.length;
  }

  stop(roomId: string, peerId: string, sessionId: string): void {
    const state = this.rooms.get(roomId);
    if (!state || state.sessionId !== sessionId || !state.members.includes(peerId))
      throw Error("replay_forbidden");
    this.rooms.delete(roomId);
  }

  snapshot(roomId: string): ReplaySnapshot | undefined {
    const state = this.rooms.get(roomId);
    return state && { ...state, members: [...state.members], approved: [...state.approved] };
  }

  clear(): void {
    this.rooms.clear();
  }
}
