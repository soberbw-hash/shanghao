import { createHash, createPublicKey, verify } from "node:crypto";
import {
  isTemporaryRoomSessionId,
  type TemporaryRoomMember,
} from "../../shared/src/types/temporary-room.types";
import { isBuiltInAvatarId } from "../../shared/src/constants/profile";
import { isValidNickname } from "./protocol";

export interface TemporaryCheckpointMember {
  member: TemporaryRoomMember;
  tokenHash: string | null;
  lastHeartbeatAt: number;
  recoveryDeadline?: number;
  needsReproof?: boolean;
}
/** PRIVATE Main-to-Main state. Never emit through renderer IPC, discovery, diagnostics or logs. */
export interface TemporaryCoordinatorCheckpoint {
  version: 1;
  status: "active" | "closed";
  sessionId: string;
  authorityId: string;
  epoch: number;
  revision: number;
  sequence: number;
  membershipDigest: string;
  code: string;
  locked: boolean;
  adminMemberId: string;
  createdAt: number;
  exportedAt: number;
  expiresAt: number;
  leaseExpiresAt: number;
  fenced: boolean;
  configuration: {
    authAudience: string;
    graceMs: number;
    heartbeatTimeoutMs: number;
    maxRemovedDevices: number;
  };
  members: TemporaryCheckpointMember[];
  removedDevices: string[];
}
export interface SignedTemporaryCheckpoint {
  checkpoint: TemporaryCoordinatorCheckpoint;
  signature: string;
}
interface ReplicaMember {
  deviceId: string;
  publicKey: string;
}
interface ElectionProposal {
  version: 1;
  sessionId: string;
  membershipDigest: string;
  previousEpoch: number;
  epoch: number;
  candidateId: string;
  proposalId: string;
  issuedAt: number;
  expiresAt: number;
}
interface ElectionVotePayload extends ElectionProposal {
  voterId: string;
  proposalDigest: string;
}
export interface TemporaryReplicaElectionCommit {
  proposal: ElectionProposal;
  votes: Array<{ payload: ElectionVotePayload; signature: string }>;
}
export interface TemporaryReplicaApproval {
  version: 1;
  sessionId: string;
  checkpointDigest: string;
  membershipDigest: string;
  fromAuthorityId: string;
  fromEpoch: number;
  fromRevision: number;
  sequence: number;
  toAuthorityId: string;
  toEpoch: number;
  electionProposalDigest: string;
  voterId: string;
  issuedAt: number;
  expiresAt: number;
}
export interface SignedTemporaryReplicaApproval {
  payload: TemporaryReplicaApproval;
  signature: string;
}
export interface VerifiedTemporaryRoomImport {
  readonly sessionId: string;
  readonly authorityId: string;
  readonly epoch: number;
  readonly sourceRevision: number;
  readonly checkpointDigest: string;
}
interface ImportRecord {
  checkpoint: TemporaryCoordinatorCheckpoint;
  authorityId: string;
  epoch: number;
  expiresAt: number;
}
const imports = new WeakMap<object, ImportRecord>();
const hash = (value: string): string => createHash("sha256").update(value).digest("base64url");
const validInt = (value: unknown, min = 0): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;
const deviceIdFor = (publicKey: string): string => {
  if (typeof publicKey !== "string" || publicKey.length > 512) throw new Error();
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error();
  return `device_${createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("base64url")}`;
};
export const temporaryReplicaMembershipDigest = (members: readonly ReplicaMember[]): string =>
  hash(
    JSON.stringify(
      [...members]
        .sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))
        .map((member) => [member.deviceId, member.publicKey]),
    ),
  );

export const temporaryCheckpointSigningPayload = (c: TemporaryCoordinatorCheckpoint): string =>
  JSON.stringify([
    "shanghao.temporary.coordinator-checkpoint",
    c.version,
    c.status,
    c.sessionId,
    c.authorityId,
    c.epoch,
    c.revision,
    c.sequence,
    c.membershipDigest,
    c.code,
    c.locked,
    c.adminMemberId,
    c.createdAt,
    c.exportedAt,
    c.expiresAt,
    c.leaseExpiresAt,
    c.fenced,
    [
      c.configuration.authAudience,
      c.configuration.graceMs,
      c.configuration.heartbeatTimeoutMs,
      c.configuration.maxRemovedDevices,
    ],
    c.members.map(({ member, tokenHash, lastHeartbeatAt, recoveryDeadline, needsReproof }) => [
      member.memberId,
      member.deviceId,
      member.publicKey,
      [
        member.profile.nickname,
        member.profile.avatarId ?? null,
        member.profile.avatarDataUrl ?? null,
      ],
      member.generation,
      member.joinedAt,
      member.state,
      member.reconnectUntil ?? null,
      tokenHash,
      lastHeartbeatAt,
      recoveryDeadline ?? null,
      needsReproof ?? false,
    ]),
    c.removedDevices,
  ]);
export const temporaryCheckpointDigest = (c: TemporaryCoordinatorCheckpoint): string =>
  hash(temporaryCheckpointSigningPayload(c));
export const temporaryReplicaApprovalSigningPayload = (p: TemporaryReplicaApproval): string =>
  JSON.stringify([
    "shanghao.temporary.replica-approval",
    p.version,
    p.sessionId,
    p.checkpointDigest,
    p.membershipDigest,
    p.fromAuthorityId,
    p.fromEpoch,
    p.fromRevision,
    p.sequence,
    p.toAuthorityId,
    p.toEpoch,
    p.electionProposalDigest,
    p.voterId,
    p.issuedAt,
    p.expiresAt,
  ]);

const electionPayload = (p: ElectionProposal): string =>
  JSON.stringify([
    "shanghao.lan.election-proposal",
    p.version,
    p.sessionId,
    p.membershipDigest,
    p.previousEpoch,
    p.epoch,
    p.candidateId,
    p.proposalId,
    p.issuedAt,
    p.expiresAt,
  ]);
const votePayload = (p: ElectionVotePayload): string =>
  JSON.stringify([
    "shanghao.lan.election-vote",
    p.version,
    p.sessionId,
    p.membershipDigest,
    p.previousEpoch,
    p.epoch,
    p.candidateId,
    p.proposalId,
    p.issuedAt,
    p.expiresAt,
    p.voterId,
    p.proposalDigest,
  ]);
const validSignature = (signature: unknown, payload: string, publicKey: string): boolean =>
  typeof signature === "string" &&
  /^[A-Za-z0-9_-]{86}$/.test(signature) &&
  verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url"));

const validateCheckpoint = (c: TemporaryCoordinatorCheckpoint, now: number): void => {
  if (
    !c ||
    c.version !== 1 ||
    !["active", "closed"].includes(c.status) ||
    !isTemporaryRoomSessionId(c.sessionId) ||
    !/^device_[A-Za-z0-9_-]{43}$/.test(c.authorityId) ||
    !validInt(c.epoch, 1) ||
    !validInt(c.revision, 1) ||
    !validInt(c.sequence, 1) ||
    typeof c.code !== "string" ||
    !/^[0-9]{8}$/.test(c.code) ||
    typeof c.locked !== "boolean" ||
    typeof c.fenced !== "boolean" ||
    !validInt(c.createdAt) ||
    !validInt(c.exportedAt) ||
    c.createdAt > c.exportedAt ||
    c.exportedAt > now + 2000 ||
    !validInt(c.expiresAt) ||
    c.expiresAt <= now ||
    c.expiresAt <= c.exportedAt ||
    c.expiresAt - c.exportedAt > 30_000 ||
    !validInt(c.leaseExpiresAt) ||
    c.leaseExpiresAt > c.exportedAt + 30_000 ||
    !c.configuration ||
    typeof c.configuration.authAudience !== "string" ||
    !c.configuration.authAudience ||
    c.configuration.authAudience.length > 160 ||
    !validInt(c.configuration.graceMs, 1) ||
    c.configuration.graceMs > 120_000 ||
    !validInt(c.configuration.heartbeatTimeoutMs, 1) ||
    c.configuration.heartbeatTimeoutMs > 120_000 ||
    !validInt(c.configuration.maxRemovedDevices, 1) ||
    c.configuration.maxRemovedDevices > 10_000 ||
    !Array.isArray(c.members) ||
    c.members.length > 5 ||
    !Array.isArray(c.removedDevices) ||
    c.removedDevices.length > c.configuration.maxRemovedDevices + 4 ||
    c.removedDevices.some(
      (id) => typeof id !== "string" || !/^device_[A-Za-z0-9_-]{43}$/.test(id),
    ) ||
    new Set(c.removedDevices).size !== c.removedDevices.length
  )
    throw new Error("temporary_checkpoint_invalid");
  const ids = new Set<string>();
  const devices = new Set<string>();
  for (const record of c.members) {
    const member = record.member;
    if (
      !member ||
      typeof member.memberId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(member.memberId) ||
      ids.has(member.memberId) ||
      devices.has(member.deviceId) ||
      deviceIdFor(member.publicKey) !== member.deviceId ||
      c.removedDevices.includes(member.deviceId) ||
      !member.profile ||
      !isValidNickname(member.profile.nickname) ||
      (member.profile.avatarId !== undefined && !isBuiltInAvatarId(member.profile.avatarId)) ||
      (member.profile.avatarDataUrl !== undefined &&
        (typeof member.profile.avatarDataUrl !== "string" ||
          member.profile.avatarDataUrl.length > 256 * 1024 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
            member.profile.avatarDataUrl,
          ))) ||
      !validInt(member.generation, 1) ||
      !validInt(member.joinedAt) ||
      member.joinedAt > c.exportedAt ||
      !["connected", "disconnected-grace"].includes(member.state) ||
      (member.state === "disconnected-grace" &&
        (!validInt(member.reconnectUntil) ||
          member.reconnectUntil > c.exportedAt + c.configuration.graceMs)) ||
      !validInt(record.lastHeartbeatAt) ||
      record.lastHeartbeatAt > c.exportedAt ||
      (record.tokenHash !== null &&
        (typeof record.tokenHash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(record.tokenHash))) ||
      (record.needsReproof !== undefined && typeof record.needsReproof !== "boolean") ||
      (record.recoveryDeadline !== undefined &&
        (!validInt(record.recoveryDeadline) ||
          member.state !== "disconnected-grace" ||
          record.recoveryDeadline !== member.reconnectUntil))
    )
      throw new Error("temporary_checkpoint_invalid");
    ids.add(member.memberId);
    devices.add(member.deviceId);
  }
  if (
    (c.status === "active" && (!c.members.length || !ids.has(c.adminMemberId))) ||
    (c.status === "closed" && c.members.length !== 0) ||
    c.membershipDigest !== temporaryReplicaMembershipDigest(c.members.map(({ member }) => member))
  )
    throw new Error("temporary_checkpoint_invalid");
};

export interface TemporaryRoomReplicaOptions {
  sessionId: string;
  authorityId: string;
  authorityPublicKey: string;
  epoch: number;
  now?: () => number;
  clockSkewMs?: number;
}

/** A trusted Main replica's highest observed state; only this verifier can mint import capabilities. */
export class TemporaryRoomReplica {
  private readonly now: () => number;
  private readonly skew: number;
  private latest?: SignedTemporaryCheckpoint;
  private terminal = false;
  private readonly approvedHandoffs = new Map<string, number>();

  constructor(private readonly options: TemporaryRoomReplicaOptions) {
    this.now = options.now ?? Date.now;
    this.skew = options.clockSkewMs ?? 200;
    if (
      !isTemporaryRoomSessionId(options.sessionId) ||
      deviceIdFor(options.authorityPublicKey) !== options.authorityId ||
      !validInt(options.epoch, 1) ||
      !validInt(this.skew) ||
      this.skew > 2000
    )
      throw new Error("temporary_replica_configuration_invalid");
  }

  acceptCheckpoint(value: SignedTemporaryCheckpoint): string {
    try {
      if (!value || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) throw new Error();
      validateCheckpoint(value.checkpoint, this.now());
      if (
        value.checkpoint.sessionId !== this.options.sessionId ||
        value.checkpoint.authorityId !== this.options.authorityId ||
        value.checkpoint.epoch !== this.options.epoch ||
        !validSignature(
          value.signature,
          temporaryCheckpointSigningPayload(value.checkpoint),
          this.options.authorityPublicKey,
        )
      )
        throw new Error();
    } catch {
      throw new Error("temporary_checkpoint_invalid");
    }
    if (this.terminal && value.checkpoint.status !== "closed")
      throw new Error("temporary_checkpoint_closed");
    const old = this.latest?.checkpoint;
    if (old && temporaryCheckpointDigest(value.checkpoint) === temporaryCheckpointDigest(old))
      return temporaryCheckpointDigest(old);
    if (
      old &&
      (value.checkpoint.revision < old.revision ||
        value.checkpoint.sequence <= old.sequence ||
        value.checkpoint.exportedAt < old.exportedAt)
    )
      throw new Error("temporary_checkpoint_stale");
    this.latest = structuredClone(value);
    if (value.checkpoint.status === "closed") this.terminal = true;
    return temporaryCheckpointDigest(value.checkpoint);
  }

  /** PRIVATE copy for an authenticated encrypted replication channel, never renderer IPC. */
  checkpoint(): SignedTemporaryCheckpoint | undefined {
    return this.latest ? structuredClone(this.latest) : undefined;
  }

  approvalFor(election: TemporaryReplicaElectionCommit, voterId: string): TemporaryReplicaApproval {
    const c = this.activeCheckpoint();
    const now = this.now();
    if (!c.fenced && now < c.leaseExpiresAt + this.skew)
      throw new Error("temporary_replica_lease_active");
    this.verifyElection(election, c, now);
    if (!c.members.some(({ member }) => member.deviceId === voterId))
      throw new Error("temporary_replica_voter_invalid");
    return {
      version: 1,
      sessionId: c.sessionId,
      checkpointDigest: temporaryCheckpointDigest(c),
      membershipDigest: c.membershipDigest,
      fromAuthorityId: c.authorityId,
      fromEpoch: c.epoch,
      fromRevision: c.revision,
      sequence: c.sequence,
      toAuthorityId: election.proposal.candidateId,
      toEpoch: election.proposal.epoch,
      electionProposalDigest: hash(electionPayload(election.proposal)),
      voterId,
      issuedAt: now,
      expiresAt: Math.min(c.expiresAt, election.proposal.expiresAt, now + 10_000),
    };
  }

  verifyHandoff(input: {
    election: TemporaryReplicaElectionCommit;
    approvals: SignedTemporaryReplicaApproval[];
  }): VerifiedTemporaryRoomImport {
    const c = this.activeCheckpoint();
    const now = this.now();
    if (!c.fenced && now < c.leaseExpiresAt + this.skew)
      throw new Error("temporary_replica_lease_active");
    this.verifyElection(input.election, c, now);
    if (!Array.isArray(input.approvals) || input.approvals.length > c.members.length)
      throw new Error("temporary_replica_approval_invalid");
    const voters = new Set<string>();
    let expiresAt = Math.min(c.expiresAt, input.election.proposal.expiresAt);
    for (const approval of input.approvals) {
      const p = approval?.payload;
      const member = c.members.find(({ member }) => member.deviceId === p?.voterId)?.member;
      const expected = p && this.approvalFor(input.election, p.voterId);
      if (
        !p ||
        !member ||
        !expected ||
        voters.has(p.voterId) ||
        !validInt(p.issuedAt) ||
        p.issuedAt < c.exportedAt ||
        p.issuedAt > now + this.skew ||
        !validInt(p.expiresAt) ||
        p.expiresAt <= now + this.skew ||
        p.expiresAt >
          Math.min(c.expiresAt, input.election.proposal.expiresAt, p.issuedAt + 10_000) ||
        temporaryReplicaApprovalSigningPayload({
          ...p,
          issuedAt: expected.issuedAt,
          expiresAt: expected.expiresAt,
        }) !== temporaryReplicaApprovalSigningPayload(expected) ||
        !validSignature(
          approval.signature,
          temporaryReplicaApprovalSigningPayload(p),
          member.publicKey,
        )
      )
        throw new Error("temporary_replica_approval_invalid");
      voters.add(p.voterId);
      expiresAt = Math.min(expiresAt, p.expiresAt);
    }
    this.requireQuorum(voters, c, input.election.proposal.candidateId);
    const electionDigest = hash(electionPayload(input.election.proposal));
    for (const [key, expiry] of this.approvedHandoffs)
      if (expiry <= now) this.approvedHandoffs.delete(key);
    if (this.approvedHandoffs.has(electionDigest))
      throw new Error("temporary_replica_handoff_replayed");
    if (this.approvedHandoffs.size >= 128) throw new Error("temporary_replica_capacity");
    this.approvedHandoffs.set(electionDigest, expiresAt);
    const proof = Object.freeze({
      sessionId: c.sessionId,
      authorityId: input.election.proposal.candidateId,
      epoch: input.election.proposal.epoch,
      sourceRevision: c.revision,
      checkpointDigest: temporaryCheckpointDigest(c),
    });
    imports.set(proof, {
      checkpoint: structuredClone(c),
      authorityId: proof.authorityId,
      epoch: proof.epoch,
      expiresAt,
    });
    return proof;
  }

  private activeCheckpoint(): TemporaryCoordinatorCheckpoint {
    if (this.terminal) throw new Error("temporary_checkpoint_closed");
    const c = this.latest?.checkpoint;
    if (!c || c.expiresAt <= this.now()) throw new Error("temporary_checkpoint_expired");
    return c;
  }

  private verifyElection(
    e: TemporaryReplicaElectionCommit,
    c: TemporaryCoordinatorCheckpoint,
    now: number,
  ): void {
    const p = e?.proposal;
    if (
      !p ||
      p.version !== 1 ||
      p.sessionId !== c.sessionId ||
      p.membershipDigest !== c.membershipDigest ||
      p.previousEpoch !== c.epoch ||
      p.epoch !== c.epoch + 1 ||
      typeof p.proposalId !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(p.proposalId) ||
      !validInt(p.issuedAt) ||
      p.issuedAt < c.exportedAt ||
      p.issuedAt > now + this.skew ||
      !validInt(p.expiresAt) ||
      p.expiresAt <= now + this.skew ||
      p.expiresAt <= p.issuedAt ||
      p.expiresAt - p.issuedAt > 30_000 ||
      !c.members.some(({ member }) => member.deviceId === p.candidateId) ||
      !Array.isArray(e.votes) ||
      e.votes.length > c.members.length
    )
      throw new Error("temporary_replica_election_invalid");
    if (!c.fenced && p.issuedAt < c.leaseExpiresAt + this.skew)
      throw new Error("temporary_replica_lease_active");
    const voters = new Set<string>();
    for (const vote of e.votes) {
      const v = vote?.payload;
      const member = c.members.find(({ member }) => member.deviceId === v?.voterId)?.member;
      if (
        !v ||
        !member ||
        voters.has(v.voterId) ||
        electionPayload(v) !== electionPayload(p) ||
        v.proposalDigest !== hash(electionPayload(p)) ||
        !validSignature(vote.signature, votePayload(v), member.publicKey)
      )
        throw new Error("temporary_replica_election_invalid");
      voters.add(v.voterId);
    }
    this.requireQuorum(voters, c, p.candidateId);
  }

  private requireQuorum(
    voters: Set<string>,
    c: TemporaryCoordinatorCheckpoint,
    candidate: string,
  ): void {
    if (voters.size < Math.floor(c.members.length / 2) + 1)
      throw new Error("temporary_replica_quorum_required");
    if (!voters.has(candidate)) throw new Error("temporary_replica_candidate_approval_required");
  }
}

/** Only a verified, one-use in-process capability reaches the coordinator import path. */
export const consumeTemporaryRoomImport = (
  proof: VerifiedTemporaryRoomImport,
  authorityId: string,
  now: number,
): ImportRecord => {
  const record = proof && imports.get(proof);
  if (!record || record.authorityId !== authorityId || record.expiresAt <= now)
    throw new Error("temporary_import_proof_invalid");
  imports.delete(proof);
  return structuredClone(record);
};
