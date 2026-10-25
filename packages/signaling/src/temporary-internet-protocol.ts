import { createHash, createPublicKey, verify } from "node:crypto";
import { isTemporaryRoomSessionId } from "../../shared/src/types/temporary-room.types";
import {
  temporaryReplicaMembershipDigest,
  type TemporaryReplicaElectionCommit,
  type SignedTemporaryReplicaApproval,
} from "./temporary-room-replica";
import {
  verifyTemporaryReplicaStateHead,
  type SignedTemporaryReplicaStateHead,
} from "./temporary-room-state-head";
export interface InternetMember {
  deviceId: string;
  publicKey: string;
}
export interface TemporaryInternetRegistration {
  version: 1;
  sessionId: string;
  authorityId: string;
  epoch: number;
  revision: number;
  code: string;
  publicKey: string;
  certificateSha256: string;
  members: InternetMember[];
  issuedAt: number;
  expiresAt: number;
}
export interface SignedInternetRegistration {
  payload: TemporaryInternetRegistration;
  signature: string;
}
export interface TemporaryInternetCertificate {
  source?: SignedInternetRegistration;
  head: SignedTemporaryReplicaStateHead;
  election: TemporaryReplicaElectionCommit;
  approvals: SignedTemporaryReplicaApproval[];
}
export interface TemporaryInternetTransition {
  next: SignedInternetRegistration;
  certificate: TemporaryInternetCertificate;
}
export interface TemporaryInternetHandoff extends TemporaryInternetCertificate {
  history?: TemporaryInternetTransition[];
}
export const MAX_INTERNET_HANDOFF_HISTORY = 24;
function primitives<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(
    keys.map((key) => {
      const item = value[key];
      if (!["string", "number", "boolean"].includes(typeof item))
        throw Error("temporary_bridge_handoff_invalid");
      return [key, item];
    }),
  ) as Pick<T, K>;
}
const signature = (value: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value))
    throw Error("temporary_bridge_handoff_invalid");
  return value;
};
/** Strip unsigned fields before Main sends any proof to a public broker. */
export function normalizeInternetCertificate(
  value: TemporaryInternetCertificate,
): TemporaryInternetCertificate {
  const source =
    value.source && normalizeInternetRegistration(value.source, value.source.payload.issuedAt);
  if (value.source && !source) throw Error("temporary_bridge_handoff_invalid");
  const proposalKeys = [
    "version",
    "sessionId",
    "membershipDigest",
    "previousEpoch",
    "epoch",
    "candidateId",
    "proposalId",
    "issuedAt",
    "expiresAt",
  ] as const;
  if (value.election.votes.length > 5 || value.approvals.length > 5)
    throw Error("temporary_bridge_handoff_invalid");
  return {
    source,
    head: {
      signature: signature(value.head.signature),
      payload: primitives(value.head.payload, [
        "version",
        "sessionId",
        "authorityId",
        "epoch",
        "revision",
        "sequence",
        "checkpointDigest",
        "membershipDigest",
        "terminal",
        "issuedAt",
        "expiresAt",
      ]),
    },
    election: {
      proposal: primitives(value.election.proposal, proposalKeys),
      votes: value.election.votes.map((v) => ({
        signature: signature(v.signature),
        payload: primitives(v.payload, [...proposalKeys, "voterId", "proposalDigest"]),
      })),
    },
    approvals: value.approvals.map((a) => ({
      signature: signature(a.signature),
      payload: primitives(a.payload, [
        "version",
        "sessionId",
        "checkpointDigest",
        "membershipDigest",
        "fromAuthorityId",
        "fromEpoch",
        "fromRevision",
        "sequence",
        "toAuthorityId",
        "toEpoch",
        "electionProposalDigest",
        "voterId",
        "issuedAt",
        "expiresAt",
      ]),
    })),
  };
}
export function normalizeInternetHistory(
  value: TemporaryInternetTransition[] | undefined,
): TemporaryInternetTransition[] | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_INTERNET_HANDOFF_HISTORY)
    throw Error("temporary_bridge_handoff_invalid");
  return value.map((link) => {
    const next = normalizeInternetRegistration(link.next, link.next.payload.issuedAt);
    if (!next) throw Error("temporary_bridge_handoff_invalid");
    const certificate = normalizeInternetCertificate(link.certificate);
    if (
      !certificate.source ||
      !verifyInternetHandoff(certificate.source.payload, next.payload, certificate)
    )
      throw Error("temporary_bridge_handoff_invalid");
    return { next, certificate };
  });
}
export const internetRegistrationSigningPayload = (p: TemporaryInternetRegistration): string =>
  JSON.stringify([
    "shanghao.temporary.internet-registration",
    p.version,
    p.sessionId,
    p.authorityId,
    p.epoch,
    p.revision,
    p.code,
    p.publicKey,
    p.certificateSha256,
    p.members.map((m) => [m.deviceId, m.publicKey]),
    p.issuedAt,
    p.expiresAt,
  ]);
export const internetDeviceId = (publicKey: string) => {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw Error("temporary_bridge_key_invalid");
  return (
    "device_" +
    createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("base64url")
  );
};
export const internetSignatureValid = (
  signature: string,
  payload: string,
  publicKey: string,
): boolean => {
  try {
    return (
      /^[A-Za-z0-9_-]{86}$/.test(signature) &&
      verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, "base64url"))
    );
  } catch {
    return false;
  }
};
export function verifyInternetRegistration(
  value: SignedInternetRegistration,
  now = Date.now(),
): boolean {
  try {
    const p = value?.payload;
    return Boolean(
      p &&
      p.version === 1 &&
      isTemporaryRoomSessionId(p.sessionId) &&
      typeof p.publicKey === "string" &&
      p.publicKey.length <= 512 &&
      internetDeviceId(p.publicKey) === p.authorityId &&
      Number.isSafeInteger(p.epoch) &&
      p.epoch > 0 &&
      Number.isSafeInteger(p.revision) &&
      p.revision >= 0 &&
      /^\d{8}$/.test(p.code) &&
      /^[a-f0-9]{64}$/.test(p.certificateSha256) &&
      Array.isArray(p.members) &&
      p.members.length > 0 &&
      p.members.length <= 5 &&
      new Set(p.members.map((m) => m.deviceId)).size === p.members.length &&
      p.members.every(
        (m) => m.publicKey.length <= 512 && internetDeviceId(m.publicKey) === m.deviceId,
      ) &&
      Number.isSafeInteger(p.issuedAt) &&
      Number.isSafeInteger(p.expiresAt) &&
      p.issuedAt <= now + 200 &&
      p.expiresAt > now &&
      p.expiresAt - p.issuedAt <= 15_000 &&
      internetSignatureValid(value.signature, internetRegistrationSigningPayload(p), p.publicKey),
    );
  } catch {
    return false;
  }
}
export function normalizeInternetRegistration(
  value: SignedInternetRegistration,
  now = Date.now(),
): SignedInternetRegistration | undefined {
  if (!verifyInternetRegistration(value, now)) return;
  const p = value.payload;
  return {
    signature: value.signature,
    payload: {
      version: 1,
      sessionId: p.sessionId,
      authorityId: p.authorityId,
      epoch: p.epoch,
      revision: p.revision,
      code: p.code,
      publicKey: p.publicKey,
      certificateSha256: p.certificateSha256,
      members: p.members.map((m) => ({ deviceId: m.deviceId, publicKey: m.publicKey })),
      issuedAt: p.issuedAt,
      expiresAt: p.expiresAt,
    },
  };
}
/** Verify the private-state majority certificate using its signed opaque head, without transferring checkpoint secrets to the broker. */
export function verifyInternetHandoff(
  old: TemporaryInternetRegistration,
  next: TemporaryInternetRegistration,
  input: TemporaryInternetCertificate,
  now = Date.now(),
): boolean {
  try {
    const h = input.head.payload,
      e = input.election.proposal;
    // A directory binding records epoch ordering, never grants an active coordinator lease.
    // Historical quorum certificates remain usable after an internet outage; imports still require fresh proofs.
    const certificateTime = Math.max(e.issuedAt, ...input.approvals.map((a) => a.payload.issuedAt));
    if (
      !Number.isSafeInteger(certificateTime) ||
      certificateTime > now + 200 ||
      !verifyTemporaryReplicaStateHead(input.head, old.publicKey, certificateTime) ||
      h.terminal ||
      h.sessionId !== old.sessionId ||
      h.epoch !== old.epoch ||
      h.revision < old.revision ||
      h.membershipDigest !== temporaryReplicaMembershipDigest(old.members) ||
      e.version !== 1 ||
      e.sessionId !== old.sessionId ||
      e.membershipDigest !== h.membershipDigest ||
      e.previousEpoch !== old.epoch ||
      e.epoch !== old.epoch + 1 ||
      e.candidateId !== next.authorityId ||
      next.epoch !== e.epoch ||
      next.sessionId !== old.sessionId ||
      !Number.isSafeInteger(e.issuedAt) ||
      e.issuedAt < h.issuedAt ||
      e.issuedAt > now + 200 ||
      e.expiresAt <= certificateTime ||
      e.expiresAt - e.issuedAt > 30_000 ||
      !/^[A-Za-z0-9_-]{43}$/.test(e.proposalId)
    )
      return false;
    const electionPayload = JSON.stringify([
      "shanghao.lan.election-proposal",
      e.version,
      e.sessionId,
      e.membershipDigest,
      e.previousEpoch,
      e.epoch,
      e.candidateId,
      e.proposalId,
      e.issuedAt,
      e.expiresAt,
    ]);
    const digest = createHash("sha256").update(electionPayload).digest("base64url");
    const voters = new Set<string>(),
      approvers = new Set<string>();
    if (
      input.election.votes.length > old.members.length ||
      input.approvals.length > old.members.length
    )
      return false;
    for (const vote of input.election.votes) {
      const p = vote.payload,
        member = old.members.find((m) => m.deviceId === p.voterId);
      const payload = JSON.stringify([
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
      if (
        !member ||
        voters.has(p.voterId) ||
        p.proposalDigest !== digest ||
        JSON.stringify([
          p.version,
          p.sessionId,
          p.membershipDigest,
          p.previousEpoch,
          p.epoch,
          p.candidateId,
          p.proposalId,
          p.issuedAt,
          p.expiresAt,
        ]) !==
          JSON.stringify([
            e.version,
            e.sessionId,
            e.membershipDigest,
            e.previousEpoch,
            e.epoch,
            e.candidateId,
            e.proposalId,
            e.issuedAt,
            e.expiresAt,
          ]) ||
        !internetSignatureValid(vote.signature, payload, member.publicKey)
      )
        return false;
      voters.add(p.voterId);
    }
    for (const approval of input.approvals) {
      const p = approval.payload,
        member = old.members.find((m) => m.deviceId === p.voterId);
      const payload = JSON.stringify([
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
      if (
        !member ||
        approvers.has(p.voterId) ||
        p.version !== 1 ||
        p.sessionId !== old.sessionId ||
        p.checkpointDigest !== h.checkpointDigest ||
        p.membershipDigest !== h.membershipDigest ||
        p.fromAuthorityId !== old.authorityId ||
        p.fromEpoch !== old.epoch ||
        p.fromRevision !== h.revision ||
        p.sequence !== h.sequence ||
        p.toAuthorityId !== next.authorityId ||
        p.toEpoch !== next.epoch ||
        p.electionProposalDigest !== digest ||
        p.issuedAt < h.issuedAt ||
        p.issuedAt > now + 200 ||
        p.expiresAt <= certificateTime ||
        p.expiresAt - p.issuedAt > 10_000 ||
        !internetSignatureValid(approval.signature, payload, member.publicKey)
      )
        return false;
      approvers.add(p.voterId);
    }
    const quorum = Math.floor(old.members.length / 2) + 1;
    return (
      voters.size >= quorum &&
      approvers.size >= quorum &&
      voters.has(next.authorityId) &&
      approvers.has(next.authorityId)
    );
  } catch {
    return false;
  }
}

/** Historical source registrations authorize offline membership changes with the already pinned authority key.
 * Every missing epoch still needs its own distinct-member majority; a higher integer alone never advances the directory. */
export function verifyInternetHandoffChain(
  old: TemporaryInternetRegistration,
  next: TemporaryInternetRegistration,
  input: TemporaryInternetHandoff,
  now = Date.now(),
): boolean {
  try {
    if (
      input.history !== undefined &&
      (!Array.isArray(input.history) || input.history.length > MAX_INTERNET_HANDOFF_HISTORY)
    )
      return false;
    let current = old;
    const step = (
      target: TemporaryInternetRegistration,
      certificate: TemporaryInternetCertificate,
    ): boolean => {
      const source = certificate.source;
      if (source) {
        const p = source.payload;
        if (
          !verifyInternetRegistration(source, p.issuedAt) ||
          p.issuedAt > now + 200 ||
          p.sessionId !== current.sessionId ||
          p.authorityId !== current.authorityId ||
          p.publicKey !== current.publicKey ||
          p.epoch !== current.epoch ||
          p.revision < current.revision
        )
          return false;
        current = p;
      }
      if (!verifyInternetHandoff(current, target, certificate, now)) return false;
      current = target;
      return true;
    };
    for (const link of input.history ?? []) {
      if (
        !link ||
        !verifyInternetRegistration(link.next, link.next?.payload?.issuedAt) ||
        link.next.payload.issuedAt > now + 200
      )
        return false;
      if (link.next.payload.epoch <= current.epoch) continue;
      if (!step(link.next.payload, link.certificate)) return false;
    }
    return step(next, input);
  } catch {
    return false;
  }
}
