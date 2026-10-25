import assert from "node:assert/strict";
import test from "node:test";
import { TemporaryInternetDirectory } from "../../../packages/signaling/src/temporary-internet-directory";
import type {
  SignedInternetRegistration,
  TemporaryInternetHandoff,
} from "../../../packages/signaling/src/temporary-internet-protocol";
import {
  normalizeInternetCertificate,
  normalizeInternetHistory,
} from "../../../packages/signaling/src/temporary-internet-protocol";
import { temporaryReplicaMembershipDigest } from "../../../packages/signaling/src/temporary-room-replica";
import { lanElectionProposalDigest } from "../src/main/temporary-lan-election";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";

test("a directory verifies every signed majority transition across unseen epochs, including offline roster changes", async () => {
  const identities = [
    temporaryTestIdentity("A"),
    temporaryTestIdentity("B"),
    temporaryTestIdentity("C"),
  ];
  const profiles = await Promise.all(identities.map(async (i) => (await i.getProfile())!));
  const members = profiles.map((p) => ({ deviceId: p.deviceId, publicKey: p.publicKey }));
  const sessionId = "temp_" + "d".repeat(32);
  let now = 1000;
  const registration = async (index: number, epoch: number, revision: number, roster = members) =>
    identities[index]!.signInternetRegistration({
      version: 1,
      sessionId,
      authorityId: profiles[index]!.deviceId,
      publicKey: profiles[index]!.publicKey,
      epoch,
      revision,
      code: "00123456",
      certificateSha256: "a".repeat(64),
      members: roster,
      issuedAt: now,
      expiresAt: now + 15000,
    });
  const transition = async (
    source: SignedInternetRegistration,
    target: number,
  ): Promise<TemporaryInternetHandoff> => {
    const old = source.payload,
      owner = profiles.findIndex((p) => p.deviceId === old.authorityId),
      digest = temporaryReplicaMembershipDigest(old.members);
    const head = await identities[owner]!.signReplicaStateHead({
      version: 1,
      sessionId,
      authorityId: old.authorityId,
      epoch: old.epoch,
      revision: old.revision,
      sequence: old.revision + 1,
      checkpointDigest: "d".repeat(43),
      membershipDigest: digest,
      terminal: false,
      issuedAt: now,
      expiresAt: now + 30000,
    });
    now += 1000;
    const proposal = {
      version: 1 as const,
      sessionId,
      membershipDigest: digest,
      previousEpoch: old.epoch,
      epoch: old.epoch + 1,
      candidateId: profiles[target]!.deviceId,
      proposalId: "p".repeat(43),
      issuedAt: now,
      expiresAt: now + 5000,
    };
    const proposalDigest = lanElectionProposalDigest(proposal);
    const voters = identities.filter((_, index) =>
      old.members.some((m) => m.deviceId === profiles[index]!.deviceId),
    );
    const votes = await Promise.all(
      voters.map(async (i) =>
        i.signElectionVote(
          { ...proposal, voterId: (await i.getProfile())!.deviceId, proposalDigest },
          { sessionId, membershipDigest: digest },
        ),
      ),
    );
    const approvals = await Promise.all(
      voters.map(async (i) =>
        i.signReplicaApproval({
          version: 1,
          sessionId,
          checkpointDigest: head.payload.checkpointDigest,
          membershipDigest: digest,
          fromAuthorityId: old.authorityId,
          fromEpoch: old.epoch,
          fromRevision: old.revision,
          sequence: head.payload.sequence,
          toAuthorityId: proposal.candidateId,
          toEpoch: proposal.epoch,
          electionProposalDigest: proposalDigest,
          voterId: (await i.getProfile())!.deviceId,
          issuedAt: now,
          expiresAt: now + 5000,
        }),
      ),
    );
    return { source, head, election: { proposal, votes }, approvals };
  };
  const first = await registration(0, 1, 1, members.slice(0, 2)),
    directory = new TemporaryInternetDirectory(
      undefined,
      () => false,
      () => now,
    );
  await directory.register(first);
  // The same authority committed a third member while the broker was unavailable.
  const source = await registration(0, 1, 2),
    one = await transition(source, 1),
    second = await registration(1, 2, 3);
  const two = await transition(second, 2);
  now += 20000;
  const third = await registration(2, 3, 4);
  const proof = { ...two, history: [{ next: second, certificate: one }] };
  const dirty = structuredClone(proof);
  Object.assign(dirty.head.payload, { checkpoint: { tokenHash: "must-never-leave-main" } });
  Object.assign(dirty.history[0]!.certificate.election.proposal, {
    ticket: "must-never-leave-main",
  });
  const publicOnly = {
    ...normalizeInternetCertificate(dirty),
    history: normalizeInternetHistory(dirty.history),
  };
  assert.equal(JSON.stringify(publicOnly).includes("must-never-leave-main"), false);
  await directory.register(third, proof);
  assert.equal(directory.records()[0]!.authority.payload.epoch, 3);
  await assert.rejects(directory.register(await registration(1, 2, 5), one), /authority_invalid/);
  const missing = new TemporaryInternetDirectory(
    undefined,
    () => false,
    () => now,
  );
  await missing.register(await registration(0, 1, 1, members.slice(0, 2)));
  await assert.rejects(missing.register(third, two), /authority_invalid/);
  await assert.rejects(
    missing.register(third, {
      ...proof,
      history: [{ next: second, certificate: { ...one, approvals: one.approvals.slice(0, 1) } }],
    }),
    /authority_invalid/,
  );
});
