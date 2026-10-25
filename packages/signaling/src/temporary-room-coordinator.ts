import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  TEMPORARY_AUTH_AUDIENCE,
  TEMPORARY_ROOM_CAPACITY,
  TEMPORARY_ROOM_GRACE_MS,
  type TemporaryMemberTicket,
  type TemporaryRoomAdmission,
  type TemporaryRoomMember,
  type TemporaryRoomProfile,
  type TemporaryRoomSnapshot,
  type TemporaryRoomVersion,
} from "../../shared/src/types/temporary-room.types";
import { normalizeTemporaryRoomCode } from "../../shared/src/utils/temporary-room-code";
import { isBuiltInAvatarId } from "../../shared/src/constants/profile";
import {
  assertVerifiedTemporaryPrincipal,
  type VerifiedTemporaryPrincipal,
} from "./temporary-room-auth";
import { isValidNickname } from "./protocol";
import {
  consumeTemporaryRoomImport,
  temporaryReplicaMembershipDigest,
  type TemporaryCoordinatorCheckpoint,
  type VerifiedTemporaryRoomImport,
} from "./temporary-room-replica";

interface MemberRecord {
  member: TemporaryRoomMember;
  tokenHash: Buffer;
  lastHeartbeatAt: number;
  recoveryDeadline?: number;
  needsReproof?: boolean;
}

interface RoomRecord {
  sessionId: string;
  code: string;
  authorityId: string;
  adminMemberId: string;
  epoch: number;
  revision: number;
  locked: boolean;
  createdAt: number;
  members: Map<string, MemberRecord>;
  removedDevices: Set<string>;
  fenced: boolean;
  checkpointSequence: number;
  importedAt?: number;
  authorityLeaseUntil?: number;
}

export interface TemporaryRoomCoordinatorOptions {
  now?: () => number;
  authorityId?: string;
  authAudience?: string;
  graceMs?: number;
  heartbeatTimeoutMs?: number;
  maxRooms?: number;
  maxRemovedDevices?: number;
  maxCodeAttempts?: number;
  /** A cryptographically secure bounded integer source; defaults to node:crypto randomInt. */
  randomCode?: () => number;
  codeIsAvailable?: (code: string) => boolean;
}

const tokenHash = (token: string): Buffer => createHash("sha256").update(token).digest();
const cloneMember = (member: TemporaryRoomMember): TemporaryRoomMember => ({
  ...member,
  profile: { ...member.profile },
});
const boundedOption = (value: number | undefined, fallback: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("temporary_room_configuration_invalid");
  return value;
};

/**
 * Synchronous in-memory authority shared by a server or a local LAN host.
 * Callers own transport authentication, rate limits and periodically calling sweep().
 * Snapshots are trusted-service APIs, never an unauthenticated room-directory endpoint.
 */
export class TemporaryRoomCoordinator {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly codes = new Map<string, string>();
  private readonly closedRooms = new Map<string, { room: RoomRecord; closedAt: number }>();
  private readonly now: () => number;
  private clockUnsafe = false;
  private readonly authorityId: string;
  private readonly audience: string;
  private readonly graceMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly maxRooms: number;
  private readonly maxRemovedDevices: number;
  private readonly maxCodeAttempts: number;
  private readonly randomCode: () => number;
  private readonly codeIsAvailable?: (code: string) => boolean;

  constructor(options: TemporaryRoomCoordinatorOptions = {}) {
    const clock = options.now ?? Date.now;
    let previousTime = 0;
    this.now = () => {
      const value = clock();
      if (!Number.isSafeInteger(value) || value + 200 < previousTime) {
        this.clockUnsafe = true;
        for (const room of this.rooms.values()) room.fenced = true;
      }
      previousTime = Math.max(previousTime, Number.isSafeInteger(value) ? value : previousTime);
      return previousTime;
    };
    this.authorityId = options.authorityId ?? randomUUID();
    this.audience = options.authAudience ?? TEMPORARY_AUTH_AUDIENCE;
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(this.authorityId) ||
      !this.audience ||
      this.audience.length > 160
    )
      throw new Error("temporary_room_configuration_invalid");
    this.graceMs = boundedOption(options.graceMs, TEMPORARY_ROOM_GRACE_MS, 120_000);
    this.heartbeatTimeoutMs = boundedOption(options.heartbeatTimeoutMs, 40_000, 120_000);
    this.maxRooms = boundedOption(options.maxRooms, 4096, 100_000);
    this.maxRemovedDevices = boundedOption(options.maxRemovedDevices, 1024, 10_000);
    this.maxCodeAttempts = boundedOption(options.maxCodeAttempts, 64, 1024);
    this.randomCode = options.randomCode ?? (() => randomInt(100_000_000));
    this.codeIsAvailable = options.codeIsAvailable;
  }

  create(
    principal: VerifiedTemporaryPrincipal,
    profile: TemporaryRoomProfile,
  ): TemporaryRoomAdmission {
    this.sweep();
    this.assertIdentity(principal);
    const safeProfile = this.validateProfile(profile);
    if (this.rooms.size + this.closedRooms.size >= this.maxRooms)
      throw new Error("temporary_room_capacity");
    const code = this.allocateCode();
    const room: RoomRecord = {
      sessionId: `temp_${randomUUID().replaceAll("-", "")}`,
      code,
      authorityId: this.authorityId,
      adminMemberId: "",
      epoch: 1,
      revision: 0,
      locked: false,
      createdAt: this.now(),
      members: new Map(),
      removedDevices: new Set(),
      fenced: false,
      checkpointSequence: 0,
    };
    const ticket = this.addMember(room, principal, safeProfile);
    room.adminMemberId = ticket.memberId;
    this.rooms.set(room.sessionId, room);
    this.codes.set(code, room.sessionId);
    return this.admission(room, ticket);
  }

  /** Code resolution exposes no member data or joining/control credentials. */
  resolveCode(value: string): { sessionId: string; authorityId: string; epoch: number } {
    this.sweep();
    const room = this.roomForCode(value);
    return { sessionId: room.sessionId, authorityId: room.authorityId, epoch: room.epoch };
  }

  join(
    code: string,
    principal: VerifiedTemporaryPrincipal,
    profile: TemporaryRoomProfile,
  ): TemporaryRoomAdmission {
    this.sweep();
    const room = this.roomForCode(code);
    this.assertIdentity(principal, room.sessionId);
    const safeProfile = this.validateProfile(profile);
    if (room.removedDevices.has(principal.deviceId)) throw new Error("temporary_member_removed");
    if (room.removedDevices.size >= this.maxRemovedDevices)
      throw new Error("temporary_admission_limit");
    if ([...room.members.values()].some(({ member }) => member.deviceId === principal.deviceId))
      throw new Error("temporary_device_already_joined");
    if (room.locked) throw new Error("temporary_room_locked");
    if (room.members.size >= TEMPORARY_ROOM_CAPACITY) throw new Error("temporary_room_full");
    const ticket = this.addMember(room, principal, safeProfile);
    this.ensureAdmin(room);
    return this.admission(room, ticket);
  }

  resume(
    ticket: TemporaryMemberTicket,
    principal: VerifiedTemporaryPrincipal,
  ): TemporaryRoomAdmission {
    this.sweep();
    const { room, record } = this.findTicket(ticket);
    this.assertIdentity(principal, room.sessionId);
    if (record.member.deviceId !== principal.deviceId)
      throw new Error("temporary_identity_mismatch");
    record.member.generation += 1;
    record.member.state = "connected";
    delete record.member.reconnectUntil;
    record.lastHeartbeatAt = this.now();
    const next = this.issueTicket(room, record);
    this.ensureAdmin(room);
    room.revision += 1;
    return this.admission(room, next);
  }

  authenticate(ticket: TemporaryMemberTicket): TemporaryRoomMember {
    this.sweep();
    const { record } = this.findTicket(ticket);
    if (record.member.state !== "connected") throw new Error("temporary_member_disconnected");
    return cloneMember(record.member);
  }

  heartbeat(ticket: TemporaryMemberTicket): void {
    this.sweep();
    const { record } = this.findTicket(ticket);
    if (record.member.state !== "connected") throw new Error("temporary_member_disconnected");
    record.lastHeartbeatAt = this.now();
  }

  disconnect(ticket: TemporaryMemberTicket): TemporaryRoomSnapshot {
    this.sweep();
    const { room, record } = this.findTicket(ticket);
    if (record.member.state === "connected") {
      record.member.state = "disconnected-grace";
      record.member.reconnectUntil = this.now() + this.graceMs;
      this.ensureAdmin(room);
      room.revision += 1;
    }
    return this.copyRoom(room);
  }

  leave(ticket: TemporaryMemberTicket): TemporaryRoomSnapshot | undefined {
    this.sweep();
    const { room, record } = this.findTicket(ticket);
    room.members.delete(record.member.memberId);
    if (!room.members.size) {
      this.destroy(room);
      return undefined;
    }
    this.ensureAdmin(room);
    room.revision += 1;
    return this.copyRoom(room);
  }

  setLocked(
    actor: TemporaryMemberTicket,
    locked: boolean,
    expected: TemporaryRoomVersion,
  ): TemporaryRoomSnapshot {
    const room = this.manage(actor, expected);
    if (typeof locked !== "boolean") throw new Error("temporary_room_request_invalid");
    room.locked = locked;
    room.revision += 1;
    return this.copyRoom(room);
  }

  rotateCode(actor: TemporaryMemberTicket, expected: TemporaryRoomVersion): TemporaryRoomSnapshot {
    const room = this.manage(actor, expected);
    const nextCode = this.allocateCode();
    this.codes.delete(room.code);
    room.code = nextCode;
    // Rotation starts a new admission boundary; deleted bearer tickets remain invalid.
    room.removedDevices.clear();
    this.codes.set(nextCode, room.sessionId);
    room.revision += 1;
    return this.copyRoom(room);
  }

  kick(
    actor: TemporaryMemberTicket,
    targetMemberId: string,
    expected: TemporaryRoomVersion,
  ): TemporaryRoomSnapshot {
    const room = this.manage(actor, expected);
    const target = room.members.get(targetMemberId);
    if (!target || targetMemberId === actor.memberId)
      throw new Error("temporary_room_request_invalid");
    room.members.delete(targetMemberId);
    room.removedDevices.add(target.member.deviceId);
    room.revision += 1;
    return this.copyRoom(room);
  }

  /** Authorizes a planned handoff only; LAN quorum/replication is a transport responsibility. */
  transferAuthority(
    actor: TemporaryMemberTicket,
    authorityId: string,
    expected: TemporaryRoomVersion,
  ): TemporaryRoomSnapshot {
    const room = this.manage(actor, expected);
    if (
      typeof authorityId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(authorityId) ||
      authorityId === room.authorityId
    )
      throw new Error("temporary_room_request_invalid");
    room.authorityId = authorityId;
    room.epoch += 1;
    room.revision += 1;
    return this.copyRoom(room);
  }

  snapshot(sessionId: string): TemporaryRoomSnapshot {
    this.sweep();
    const room = this.rooms.get(sessionId);
    if (!room) throw new Error("temporary_room_not_found");
    return this.copyRoom(room);
  }

  /** Trusted host lease gate. Expiry never mutates membership or extends recovery deadlines. */
  setAuthorityLease(sessionId: string, expiresAt: number): void {
    const room = this.rooms.get(sessionId);
    if (
      !room ||
      room.fenced ||
      room.authorityId !== this.authorityId ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < this.now() ||
      expiresAt > this.now() + 30_000
    )
      throw Error("temporary_authority_lease_invalid");
    room.authorityLeaseUntil = expiresAt;
  }

  /** Main's authenticated global-code reservation path; never a renderer/socket operation. */
  rotateReservedCode(sessionId: string, expected: TemporaryRoomVersion): TemporaryRoomSnapshot {
    const room = this.rooms.get(sessionId);
    if (!room || room.authorityId !== this.authorityId) throw Error("temporary_authority_fenced");
    this.assertAuthorityLease(room);
    if (room.epoch !== expected.epoch || room.revision !== expected.revision)
      throw Error("temporary_version_conflict");
    const code = this.allocateCode();
    this.codes.delete(room.code);
    room.code = code;
    this.codes.set(code, sessionId);
    room.revision++;
    return this.copyRoom(room);
  }

  private assertAuthorityLease(room: RoomRecord): void {
    this.now();
    if (room.fenced || this.clockUnsafe) throw Error("temporary_authority_fenced");
    if (room.authorityLeaseUntil !== undefined && this.now() >= room.authorityLeaseUntil)
      throw Error("temporary_authority_lease_expired");
  }
  fenceAuthority(sessionId: string, expectedEpoch: number): void {
    const room = this.rooms.get(sessionId);
    if (!room || room.epoch !== expectedEpoch || room.authorityId !== this.authorityId)
      throw Error("temporary_authority_fenced");
    room.fenced = true;
  }

  /** PRIVATE state for a dedicated Main-to-Main signed and encrypted replication channel. */
  exportCheckpoint(
    sessionId: string,
    options: { leaseExpiresAt: number; fence?: boolean },
  ): TemporaryCoordinatorCheckpoint {
    this.sweep();
    const active = this.rooms.get(sessionId);
    const room = active ?? this.closedRooms.get(sessionId)?.room;
    const now = this.now();
    if (this.clockUnsafe) throw Error("temporary_authority_fenced");
    if (!room) throw new Error("temporary_room_not_found");
    if (
      room.authorityId !== this.authorityId ||
      !Number.isSafeInteger(options.leaseExpiresAt) ||
      options.leaseExpiresAt < 0 ||
      options.leaseExpiresAt > now + 30_000 ||
      (active && !room.fenced && !options.fence && options.leaseExpiresAt < now)
    )
      throw new Error("temporary_checkpoint_lease_invalid");
    if (active && options.fence && !room.fenced) {
      room.fenced = true;
      room.revision += 1;
    }
    room.checkpointSequence += 1;
    const members = [...room.members.values()].map((record) => ({
      member: cloneMember(record.member),
      tokenHash: record.tokenHash.length ? record.tokenHash.toString("base64url") : null,
      lastHeartbeatAt: record.lastHeartbeatAt,
      recoveryDeadline: record.recoveryDeadline,
      needsReproof: record.needsReproof,
    }));
    return {
      version: 1,
      status: active ? "active" : "closed",
      sessionId: room.sessionId,
      authorityId: room.authorityId,
      epoch: room.epoch,
      revision: room.revision,
      sequence: room.checkpointSequence,
      membershipDigest: temporaryReplicaMembershipDigest(members.map(({ member }) => member)),
      code: room.code,
      locked: room.locked,
      adminMemberId: room.adminMemberId,
      createdAt: room.createdAt,
      exportedAt: now,
      expiresAt: now + 30_000,
      leaseExpiresAt: options.leaseExpiresAt,
      fenced: room.fenced,
      configuration: {
        authAudience: this.audience,
        graceMs: this.graceMs,
        heartbeatTimeoutMs: this.heartbeatTimeoutMs,
        maxRemovedDevices: this.maxRemovedDevices,
      },
      members,
      removedDevices: [...room.removedDevices].sort(),
    };
  }

  /** No JSON import: only the replica verifier's one-use, in-process capability is accepted. */
  importCheckpoint(proof: VerifiedTemporaryRoomImport): TemporaryRoomSnapshot {
    this.sweep();
    const now = this.now();
    if (this.clockUnsafe) throw Error("temporary_authority_fenced");
    const verified = consumeTemporaryRoomImport(proof, this.authorityId, now);
    const c = verified.checkpoint;
    if (c.status !== "active" || this.closedRooms.has(c.sessionId))
      throw new Error("temporary_checkpoint_closed");
    const existing = this.rooms.get(c.sessionId);
    const codeOwner = this.codes.get(c.code);
    if (
      (codeOwner && codeOwner !== c.sessionId) ||
      (existing &&
        (existing.epoch >= verified.epoch ||
          c.epoch < existing.epoch ||
          (!existing.fenced &&
            (existing.authorityLeaseUntil === undefined || existing.authorityLeaseUntil > now)) ||
          (existing.epoch === c.epoch && existing.revision > c.revision)))
    )
      throw new Error("temporary_checkpoint_conflict");
    if (this.rooms.size + this.closedRooms.size - (existing ? 1 : 0) >= this.maxRooms)
      throw new Error("temporary_room_capacity");
    if (
      c.configuration.authAudience !== this.audience ||
      c.configuration.graceMs !== this.graceMs ||
      c.configuration.heartbeatTimeoutMs !== this.heartbeatTimeoutMs ||
      c.configuration.maxRemovedDevices !== this.maxRemovedDevices
    )
      throw new Error("temporary_checkpoint_configuration_mismatch");
    const members = new Map<string, MemberRecord>();
    for (const record of c.members) {
      const recoveryDeadline = Math.min(
        record.recoveryDeadline ?? Number.MAX_SAFE_INTEGER,
        record.member.reconnectUntil ?? c.exportedAt + this.graceMs,
        record.lastHeartbeatAt + this.heartbeatTimeoutMs + this.graceMs,
        c.expiresAt,
      );
      if (recoveryDeadline <= now) continue;
      const member = cloneMember(record.member);
      member.generation += 1;
      member.state = "disconnected-grace";
      member.reconnectUntil = recoveryDeadline;
      members.set(member.memberId, {
        member,
        tokenHash: Buffer.alloc(0),
        lastHeartbeatAt: record.lastHeartbeatAt,
        recoveryDeadline,
        needsReproof: true,
      });
    }
    if (!members.size) throw new Error("temporary_checkpoint_expired");
    const room: RoomRecord = {
      sessionId: c.sessionId,
      code: c.code,
      authorityId: verified.authorityId,
      adminMemberId: c.adminMemberId,
      epoch: verified.epoch,
      revision: c.revision + 1,
      locked: c.locked,
      createdAt: c.createdAt,
      members,
      removedDevices: new Set(c.removedDevices),
      fenced: false,
      checkpointSequence: c.sequence,
      importedAt: now,
    };
    this.ensureAdmin(room);
    if (existing) this.codes.delete(existing.code);
    this.rooms.set(room.sessionId, room);
    this.codes.set(room.code, room.sessionId);
    return this.copyRoom(room);
  }

  recoverMember(
    sessionId: string,
    memberId: string,
    principal: VerifiedTemporaryPrincipal,
    expectedEpoch: number,
  ): TemporaryRoomAdmission {
    this.sweep();
    const now = this.now();
    const room = this.rooms.get(sessionId);
    const record = room?.members.get(memberId);
    if (!room || !record || !record.needsReproof || room.fenced)
      throw new Error("temporary_recovery_unavailable");
    this.assertAuthorityLease(room);
    if (room.epoch !== expectedEpoch) throw new Error("temporary_version_conflict");
    this.assertIdentity(principal, sessionId);
    if (
      principal.sessionId !== sessionId ||
      principal.deviceId !== record.member.deviceId ||
      principal.publicKey !== record.member.publicKey ||
      principal.issuedAt < (room.importedAt ?? now)
    )
      throw new Error("temporary_identity_mismatch");
    record.member.state = "connected";
    delete record.member.reconnectUntil;
    delete record.recoveryDeadline;
    delete record.needsReproof;
    record.lastHeartbeatAt = this.now();
    const ticket = this.issueTicket(room, record);
    this.ensureAdmin(room);
    room.revision += 1;
    return this.admission(room, ticket);
  }

  sweep(now = this.now()): string[] {
    for (const [id, closed] of this.closedRooms)
      if (now - closed.closedAt >= this.graceMs + this.heartbeatTimeoutMs)
        this.closedRooms.delete(id);
    const destroyed: string[] = [];
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const [memberId, record] of room.members) {
        if (
          record.member.state === "connected" &&
          now >= record.lastHeartbeatAt + this.heartbeatTimeoutMs
        ) {
          record.member.state = "disconnected-grace";
          record.member.reconnectUntil =
            record.lastHeartbeatAt + this.heartbeatTimeoutMs + this.graceMs;
          changed = true;
        }
        if (record.member.state === "disconnected-grace" && now >= record.member.reconnectUntil!) {
          room.members.delete(memberId);
          changed = true;
        }
      }
      if (!room.members.size) {
        this.destroy(room);
        destroyed.push(room.sessionId);
      } else if (changed) {
        this.ensureAdmin(room);
        room.revision += 1;
      }
    }
    return destroyed;
  }

  getStats(): { rooms: number; members: number; connectedMembers: number } {
    this.sweep();
    let members = 0;
    let connectedMembers = 0;
    for (const room of this.rooms.values())
      for (const { member } of room.members.values()) {
        members += 1;
        if (member.state === "connected") connectedMembers += 1;
      }
    return { rooms: this.rooms.size, members, connectedMembers };
  }

  private assertIdentity(principal: VerifiedTemporaryPrincipal, sessionId?: string): void {
    assertVerifiedTemporaryPrincipal(principal, this.audience, this.now(), sessionId);
    if (this.clockUnsafe) throw Error("temporary_authority_fenced");
  }

  private validateProfile(profile: TemporaryRoomProfile): TemporaryRoomProfile {
    if (
      !profile ||
      typeof profile !== "object" ||
      !isValidNickname(profile.nickname) ||
      (profile.avatarId !== undefined && !isBuiltInAvatarId(profile.avatarId)) ||
      (profile.avatarDataUrl !== undefined &&
        (typeof profile.avatarDataUrl !== "string" ||
          profile.avatarDataUrl.length > 32 * 1024 ||
          !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(profile.avatarDataUrl)))
    )
      throw new Error("temporary_profile_invalid");
    return {
      nickname: profile.nickname.trim(),
      avatarId: profile.avatarId,
      avatarDataUrl: profile.avatarDataUrl,
    };
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < this.maxCodeAttempts; attempt += 1) {
      const value = this.randomCode();
      if (!Number.isSafeInteger(value) || value < 0 || value >= 100_000_000)
        throw new Error("temporary_code_random_invalid");
      const code = value.toString().padStart(8, "0");
      if (!this.codes.has(code) && this.codeIsAvailable?.(code) !== false) return code;
    }
    throw new Error("temporary_code_unavailable");
  }

  private roomForCode(value: string): RoomRecord {
    const code = normalizeTemporaryRoomCode(value);
    const room = code ? this.rooms.get(this.codes.get(code) ?? "") : undefined;
    if (!room) throw new Error("temporary_room_not_found");
    this.assertAuthorityLease(room);
    return room;
  }

  private addMember(
    room: RoomRecord,
    principal: VerifiedTemporaryPrincipal,
    profile: TemporaryRoomProfile,
  ): TemporaryMemberTicket {
    const member: TemporaryRoomMember = {
      memberId: randomUUID(),
      deviceId: principal.deviceId,
      publicKey: principal.publicKey,
      profile,
      generation: 1,
      joinedAt: this.now(),
      state: "connected",
    };
    const record: MemberRecord = {
      member,
      tokenHash: Buffer.alloc(0),
      lastHeartbeatAt: this.now(),
    };
    const ticket = this.issueTicket(room, record);
    room.members.set(member.memberId, record);
    room.revision += 1;
    return ticket;
  }

  private issueTicket(room: RoomRecord, record: MemberRecord): TemporaryMemberTicket {
    const token = randomBytes(32).toString("base64url");
    record.tokenHash = tokenHash(token);
    return {
      sessionId: room.sessionId,
      memberId: record.member.memberId,
      generation: record.member.generation,
      token,
    };
  }

  private findTicket(ticket: TemporaryMemberTicket): { room: RoomRecord; record: MemberRecord } {
    if (!ticket || typeof ticket.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket.token))
      throw new Error("temporary_ticket_invalid");
    const room = this.rooms.get(ticket.sessionId);
    const record = room?.members.get(ticket.memberId);
    if (room) this.assertAuthorityLease(room);
    if (
      !room ||
      !record ||
      record.tokenHash.length !== 32 ||
      record.member.generation !== ticket.generation ||
      !timingSafeEqual(record.tokenHash, tokenHash(ticket.token))
    )
      throw new Error("temporary_ticket_invalid");
    return { room, record };
  }

  private manage(actor: TemporaryMemberTicket, expected: TemporaryRoomVersion): RoomRecord {
    this.sweep();
    const { room, record } = this.findTicket(actor);
    if (record.member.state !== "connected" || room.adminMemberId !== record.member.memberId)
      throw new Error("temporary_admin_required");
    if (!expected || expected.epoch !== room.epoch || expected.revision !== room.revision)
      throw new Error("temporary_version_conflict");
    return room;
  }

  private ensureAdmin(room: RoomRecord): void {
    const current = room.members.get(room.adminMemberId)?.member;
    if (current?.state === "connected") return;
    room.adminMemberId =
      [...room.members.values()].find(({ member }) => member.state === "connected")?.member
        .memberId ??
      room.members.keys().next().value ??
      "";
  }

  private admission(room: RoomRecord, ticket: TemporaryMemberTicket): TemporaryRoomAdmission {
    return {
      room: this.copyRoom(room),
      member: cloneMember(room.members.get(ticket.memberId)!.member),
      ticket,
    };
  }

  private copyRoom(room: RoomRecord): TemporaryRoomSnapshot {
    const members = [...room.members.values()].map(({ member }) => cloneMember(member));
    return {
      kind: "temporary",
      sessionId: room.sessionId,
      code: room.code,
      authorityId: room.authorityId,
      adminMemberId: room.adminMemberId,
      epoch: room.epoch,
      revision: room.revision,
      locked: room.locked,
      capacity: 5,
      createdAt: room.createdAt,
      state: members.some((member) => member.state === "connected") ? "active" : "reconnecting",
      members,
    };
  }

  private destroy(room: RoomRecord): void {
    room.revision += 1;
    room.fenced = true;
    this.codes.delete(room.code);
    room.members.clear();
    room.removedDevices.clear();
    this.rooms.delete(room.sessionId);
    this.closedRooms.set(room.sessionId, { room, closedAt: this.now() });
  }
}
