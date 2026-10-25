import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { lanDeviceId } from "../src/main/temporary-lan-discovery";
import {
  TemporaryLanElection,
  lanElectionVoteSigningPayload,
  verifyLanElectionVote,
} from "../src/main/temporary-lan-election";

const devices = () =>
  Array.from({ length: 5 }, () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    return { keys, publicKey, deviceId: lanDeviceId(publicKey) };
  });
const roomId = "temp_" + "a".repeat(32);

test("a new epoch requires distinct authorized majority votes including the candidate", async () => {
  const members = devices();
  let now = 1000;
  const policies = members.map(
    (member) =>
      new TemporaryLanElection({
        sessionId: roomId,
        members,
        localDeviceId: member.deviceId,
        epoch: 3,
        leaderId: members[0]!.deviceId,
        leaseExpiresAt: 500,
        startupQuarantineMs: 0,
        now: () => now,
        clockSkewMs: 20,
        signVote: (payload) =>
          sign(
            null,
            Buffer.from(lanElectionVoteSigningPayload(payload)),
            member.keys.privateKey,
          ).toString("base64url"),
      }),
  );
  const proposal = policies[1]!.propose();
  const a = await policies[1]!.vote(proposal);
  const b = await policies[2]!.vote(proposal);
  const c = await policies[3]!.vote(proposal);
  assert.equal(verifyLanElectionVote(proposal, a, members), true);
  assert.throws(() => policies[4]!.acceptCommit({ proposal, votes: [a, b] }), /quorum_required/);
  assert.throws(() => policies[4]!.acceptCommit({ proposal, votes: [a, a, b] }), /vote_invalid/);
  policies[4]!.acceptCommit({ proposal, votes: [a, b, c] });
  assert.equal(policies[4]!.leader()?.leaderId, members[1]!.deviceId);
  assert.equal(policies[4]!.leader()?.epoch, 4);
  assert.equal(policies[4]!.authorizes(members[0]!.deviceId, 3), false);
  now = proposal.expiresAt;
  assert.equal(policies[4]!.leader(), undefined);
});

test("an unexpired old lease prevents another candidate and a voter cannot equivocate in one lease", async () => {
  const members = devices();
  let now = 1000;
  const policy = (index: number) =>
    new TemporaryLanElection({
      sessionId: roomId,
      members,
      localDeviceId: members[index]!.deviceId,
      epoch: 1,
      leaderId: members[0]!.deviceId,
      leaseExpiresAt: 2000,
      startupQuarantineMs: 0,
      now: () => now,
      clockSkewMs: 20,
      signVote: (payload) =>
        sign(
          null,
          Buffer.from(lanElectionVoteSigningPayload(payload)),
          members[index]!.keys.privateKey,
        ).toString("base64url"),
    });
  const b = policy(1);
  const c = policy(2);
  const voter = policy(3);
  assert.throws(() => b.propose(), /lease_active/);
  now = 2020;
  const proposedB = b.propose();
  const proposedC = c.propose();
  const voteB = await voter.vote(proposedB);
  assert.deepEqual(await voter.vote(proposedB), voteB);
  await assert.rejects(voter.vote(proposedC), /already_voted/);
});

test("tampering, wrong session or membership, stale epochs and missing candidate approval cannot grant authority", async () => {
  const members = devices();
  const now = () => 1000;
  const policies = members.map(
    (member) =>
      new TemporaryLanElection({
        sessionId: roomId,
        members,
        localDeviceId: member.deviceId,
        epoch: 1,
        leaderId: members[0]!.deviceId,
        leaseExpiresAt: 0,
        startupQuarantineMs: 0,
        now,
        clockSkewMs: 20,
        signVote: (payload) =>
          sign(
            null,
            Buffer.from(lanElectionVoteSigningPayload(payload)),
            member.keys.privateKey,
          ).toString("base64url"),
      }),
  );
  const proposal = policies[1]!.propose();
  const votes = await Promise.all(policies.slice(2, 5).map((policy) => policy.vote(proposal)));
  assert.throws(
    () => policies[0]!.acceptCommit({ proposal, votes }),
    /candidate_approval_required/,
  );
  const candidateVote = await policies[1]!.vote(proposal);
  assert.equal(
    verifyLanElectionVote(
      { ...proposal, sessionId: "temp_" + "b".repeat(32) },
      candidateVote,
      members,
    ),
    false,
  );
  assert.equal(
    verifyLanElectionVote(
      proposal,
      {
        ...candidateVote,
        payload: { ...candidateVote.payload, candidateId: members[0]!.deviceId },
      },
      members,
    ),
    false,
  );
  assert.throws(
    () =>
      policies[0]!.acceptCommit({
        proposal: { ...proposal, membershipDigest: "x".repeat(43) },
        votes: [candidateVote, ...votes],
      }),
    /proposal_invalid/,
  );
  policies[0]!.acceptCommit({ proposal, votes: [candidateVote, ...votes] });
  assert.throws(
    () => policies[0]!.acceptCommit({ proposal, votes: [candidateVote, ...votes] }),
    /epoch_invalid/,
  );
});

test("partition cannot extend a lease without quorum and a backward clock disables authority", async () => {
  const members = devices();
  let now = 1000;
  const leader = new TemporaryLanElection({
    sessionId: roomId,
    members,
    localDeviceId: members[0]!.deviceId,
    epoch: 1,
    leaderId: members[0]!.deviceId,
    leaseExpiresAt: 2000,
    startupQuarantineMs: 0,
    now: () => now,
    clockSkewMs: 20,
    signVote: (payload) =>
      sign(
        null,
        Buffer.from(lanElectionVoteSigningPayload(payload)),
        members[0]!.keys.privateKey,
      ).toString("base64url"),
  });
  assert.equal(leader.authorizes(members[0]!.deviceId, 1), true);
  const renewal = leader.propose();
  const ownVote = await leader.vote(renewal);
  assert.throws(
    () => leader.acceptCommit({ proposal: renewal, votes: [ownVote] }),
    /quorum_required/,
  );
  now = 2000;
  assert.equal(leader.leader(), undefined);
  now = 100;
  assert.equal(leader.leader(), undefined);
  assert.throws(() => leader.propose(), /clock_unsafe/);
});

test("a receiver refuses a competing leader certificate while its previous lease is still valid", async () => {
  const members = devices();
  const policy = (index: number, leaseExpiresAt: number) =>
    new TemporaryLanElection({
      sessionId: roomId,
      members,
      localDeviceId: members[index]!.deviceId,
      epoch: 1,
      leaderId: members[0]!.deviceId,
      leaseExpiresAt,
      now: () => 1000,
      clockSkewMs: 20,
      startupQuarantineMs: 0,
      signVote: (payload) =>
        sign(
          null,
          Buffer.from(lanElectionVoteSigningPayload(payload)),
          members[index]!.keys.privateKey,
        ).toString("base64url"),
    });
  const voters = [policy(1, 0), policy(2, 0), policy(3, 0)];
  const proposal = voters[0]!.propose();
  const votes = await Promise.all(voters.map((voter) => voter.vote(proposal)));
  assert.throws(() => policy(0, 5000).acceptCommit({ proposal, votes }), /lease_active/);
});

test("restart quarantine waits out forgotten in-flight vote promises before allowing a new ballot", async () => {
  const members = devices();
  let now = 1000;
  const recovered = new TemporaryLanElection({
    sessionId: roomId,
    members,
    localDeviceId: members[1]!.deviceId,
    epoch: 2,
    leaderId: members[0]!.deviceId,
    leaseExpiresAt: 0,
    now: () => now,
    clockSkewMs: 20,
    signVote: (payload) =>
      sign(
        null,
        Buffer.from(lanElectionVoteSigningPayload(payload)),
        members[1]!.keys.privateKey,
      ).toString("base64url"),
  });
  assert.equal(recovered.leader(), undefined);
  assert.throws(() => recovered.propose(), /startup_quarantine/);
  now = 6040;
  assert.equal(recovered.propose().epoch, 3);
});
