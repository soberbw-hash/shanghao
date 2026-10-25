import type { TemporaryIdentityStore } from "./temporary-identity-store";
import type {
  SignedTemporaryCheckpoint,
  SignedTemporaryReplicaApproval,
  TemporaryReplicaElectionCommit,
} from "../../../../packages/signaling/src/temporary-room-replica";
import type { SignedTemporaryReplicaStateHead } from "../../../../packages/signaling/src/temporary-room-state-head";
import {
  MAX_INTERNET_HANDOFF_HISTORY,
  normalizeInternetCertificate,
  normalizeInternetHistory,
  type SignedInternetRegistration,
  type TemporaryInternetHandoff,
  type TemporaryInternetTransition,
} from "../../../../packages/signaling/src/temporary-internet-protocol";

export interface InternetReplicaMetadata {
  publicRegistration?: SignedInternetRegistration;
  history?: TemporaryInternetTransition[];
}
interface Migration {
  source: InternetReplicaMetadata & { head?: SignedTemporaryReplicaStateHead };
  election: TemporaryReplicaElectionCommit;
  approvals: SignedTemporaryReplicaApproval[];
}
/** Only the public roster, TLS pin and opaque signed state head leave Main; never copy a private checkpoint into a broker proof. */
export function internetMigrationCertificate(
  migration: Migration | undefined,
): TemporaryInternetHandoff | undefined {
  if (!migration?.source.head) return;
  return {
    ...normalizeInternetCertificate({
      source: migration.source.publicRegistration,
      head: migration.source.head,
      election: migration.election,
      approvals: migration.approvals,
    }),
    history: normalizeInternetHistory(migration.source.history),
  };
}
export function internetMigrationHistory(
  migration: Migration | undefined,
  next: SignedInternetRegistration,
): TemporaryInternetTransition[] | undefined {
  const certificate = internetMigrationCertificate(migration);
  if (!certificate) return;
  const { history, ...current } = certificate;
  return [...(history ?? []), { next, certificate: current }].slice(-MAX_INTERNET_HANDOFF_HISTORY);
}
export async function signCheckpointInternetMetadata(
  identity: TemporaryIdentityStore,
  signed: SignedTemporaryCheckpoint,
  pin: string,
): Promise<SignedInternetRegistration> {
  const c = signed.checkpoint,
    profile = (await identity.getProfile())!;
  return identity.signInternetRegistration({
    version: 1,
    sessionId: c.sessionId,
    authorityId: c.authorityId,
    publicKey: profile.publicKey,
    epoch: c.epoch,
    revision: c.revision,
    code: c.code,
    certificateSha256: pin,
    members: c.members.map(({ member }) => ({
      deviceId: member.deviceId,
      publicKey: member.publicKey,
    })),
    issuedAt: c.exportedAt,
    expiresAt: c.exportedAt + 15000,
  });
}
