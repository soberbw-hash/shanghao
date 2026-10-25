import type { RemoteControlMemberIdentity } from "@private-voice/shared";

export interface AuthenticatedMembership {
  roomId: string;
  host: RemoteControlMemberIdentity;
  members: RemoteControlMemberIdentity[];
  names: Record<string, string>;
}
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[\w:.-]{1,160}$/.test(value);
/** Only server-originated envelopes enter here; renderer presence is never an authority. */
export class SignalingMembership {
  private local?: { roomId: string; peerId: string };
  private snapshot?: AuthenticatedMembership;
  private revision = -1;
  clear(): void {
    this.local = undefined;
    this.snapshot = undefined;
    this.revision = -1;
  }
  get(): AuthenticatedMembership | undefined {
    return this.snapshot ? structuredClone(this.snapshot) : undefined;
  }
  observe(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "join_ack" && id(message.roomId) && id(message.peerId)) {
      this.clear();
      this.local = { roomId: message.roomId, peerId: message.peerId };
      return;
    }
    if (
      !["room_snapshot", "channel_snapshot"].includes(String(message.type)) ||
      !this.local ||
      message.roomId !== this.local.roomId
    )
      return;
    if (!Number.isSafeInteger(message.revision) || Number(message.revision) <= this.revision)
      return;
    if (!Array.isArray(message.members) || message.members.length > 5) {
      this.snapshot = undefined;
      return;
    }
    const members: RemoteControlMemberIdentity[] = [],
      names: Record<string, string> = {};
    for (const row of message.members) {
      if (
        !row ||
        !id(row.id) ||
        !id(row.memberSessionId) ||
        !Number.isSafeInteger(row.memberGeneration) ||
        row.memberGeneration < 1
      ) {
        this.snapshot = undefined;
        return;
      }
      const deviceId = row.userId ?? row.profileId ?? row.id;
      if (!id(deviceId) || members.some((member) => member.peerId === row.id)) {
        this.snapshot = undefined;
        return;
      }
      members.push({
        peerId: row.id,
        memberSessionId: row.memberSessionId,
        memberGeneration: row.memberGeneration,
        deviceId,
      });
      names[row.id] = typeof row.nickname === "string" ? row.nickname.slice(0, 32) : "朋友";
    }
    const host = members.find((member) => member.peerId === this.local!.peerId);
    if (!host) {
      this.snapshot = undefined;
      return;
    }
    this.revision = Number(message.revision);
    this.snapshot = { roomId: this.local.roomId, host, members, names };
  }
}
