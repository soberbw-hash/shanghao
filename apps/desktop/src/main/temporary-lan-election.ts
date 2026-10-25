import { createHash, randomBytes, verify } from "node:crypto";
import { isTemporaryRoomSessionId } from "../../../../packages/shared/src/types/temporary-room.types";
import { lanDeviceId } from "./temporary-lan-discovery";

export interface LanElectionMember {
  deviceId: string;
  publicKey: string;
}
export interface LanElectionProposal {
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
export interface LanElectionVotePayload extends LanElectionProposal {
  voterId: string;
  proposalDigest: string;
}
export interface SignedLanElectionVote {
  payload: LanElectionVotePayload;
  signature: string;
}
export interface LanElectionCommit {
  proposal: LanElectionProposal;
  votes: SignedLanElectionVote[];
}

const digest = (text: string): string => createHash("sha256").update(text).digest("base64url");
export const lanElectionMembershipDigest = (members: readonly LanElectionMember[]): string => {
  if (
    !Array.isArray(members) ||
    members.length < 1 ||
    members.length > 5 ||
    new Set(members.map((member) => member.deviceId)).size !== members.length
  )
    throw new Error("temporary_election_members_invalid");
  for (const member of members)
    if (
      typeof member.publicKey !== "string" ||
      member.publicKey.length > 512 ||
      lanDeviceId(member.publicKey) !== member.deviceId
    )
      throw new Error("temporary_election_members_invalid");
  return digest(
    JSON.stringify(
      [...members]
        .sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0))
        .map((member) => [member.deviceId, member.publicKey]),
    ),
  );
};

const proposalPayload = (p: LanElectionProposal): string =>
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
export const lanElectionProposalDigest = (p: LanElectionProposal): string =>
  digest(proposalPayload(p));
/** Dedicated typed signer domain; must never be exposed as a generic private-key operation. */
export const lanElectionVoteSigningPayload = (p: LanElectionVotePayload): string =>
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

const validProposal = (p: LanElectionProposal, membershipDigest: string): boolean =>
  Boolean(
    p &&
    p.version === 1 &&
    isTemporaryRoomSessionId(p.sessionId) &&
    p.membershipDigest === membershipDigest &&
    Number.isSafeInteger(p.previousEpoch) &&
    p.previousEpoch >= 1 &&
    Number.isSafeInteger(p.epoch) &&
    p.epoch === p.previousEpoch + 1 &&
    typeof p.candidateId === "string" &&
    /^device_[A-Za-z0-9_-]{43}$/.test(p.candidateId) &&
    typeof p.proposalId === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(p.proposalId) &&
    Number.isSafeInteger(p.issuedAt) &&
    Number.isSafeInteger(p.expiresAt) &&
    p.expiresAt > p.issuedAt &&
    p.expiresAt - p.issuedAt <= 30_000,
  );

export const verifyLanElectionVote = (
  proposal: LanElectionProposal,
  value: unknown,
  members: readonly LanElectionMember[],
): boolean => {
  try {
    const membershipDigest = lanElectionMembershipDigest(members);
    if (!validProposal(proposal, membershipDigest) || !value || typeof value !== "object")
      return false;
    const vote = value as SignedLanElectionVote;
    const p = vote.payload;
    if (
      !p ||
      !validProposal(p, membershipDigest) ||
      proposalPayload(p) !== proposalPayload(proposal) ||
      p.proposalDigest !== lanElectionProposalDigest(proposal) ||
      typeof p.voterId !== "string" ||
      typeof vote.signature !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(vote.signature)
    )
      return false;
    const voter = members.find((member) => member.deviceId === p.voterId);
    return Boolean(
      voter &&
      verify(
        null,
        Buffer.from(lanElectionVoteSigningPayload(p)),
        voter.publicKey,
        Buffer.from(vote.signature, "base64url"),
      ),
    );
  } catch {
    return false;
  }
};

export interface TemporaryLanElectionOptions {
  sessionId: string;
  /** Previously authenticated, committed membership. Never substitute a discovered participant list. */
  members: readonly LanElectionMember[];
  localDeviceId: string;
  epoch: number;
  leaderId: string;
  leaseExpiresAt: number;
  leaseMs?: number;
  clockSkewMs?: number;
  /** Zero is safe only for a newly created session with no previous vote promises. */
  startupQuarantineMs?: number;
  now?: () => number;
  signVote: (payload: LanElectionVotePayload) => string | Promise<string>;
}

/**
 * Pure five-member lease policy, with no sockets or native input.
 * Quorum intersects across competing candidates under the explicit bounded-clock-skew assumption.
 * Transport must replicate commits in order and retain the last committed view across handoff.
 */
export class TemporaryLanElection {
  private readonly members: LanElectionMember[];
  private readonly membershipDigest: string;
  private readonly nowSource: () => number;
  private readonly leaseMs: number;
  private readonly skewMs: number;
  private readonly quarantineUntil: number;
  private epoch: number;
  private leaderId: string;
  private leaseExpiresAt: number;
  private previousTime = Number.NEGATIVE_INFINITY;
  private clockUnsafe = false;
  private voteQueue: Promise<unknown> = Promise.resolve();
  private voteReservation?: {
    epoch: number;
    digest: string;
    expiresAt: number;
    vote?: SignedLanElectionVote;
  };

  constructor(private readonly options: TemporaryLanElectionOptions) {
    this.membershipDigest = lanElectionMembershipDigest(options.members);
    this.members = options.members.map((member) => ({ ...member }));
    this.leaseMs = options.leaseMs ?? 5000;
    this.skewMs = options.clockSkewMs ?? 200;
    if (
      !isTemporaryRoomSessionId(options.sessionId) ||
      !Number.isSafeInteger(options.epoch) ||
      options.epoch < 1 ||
      !this.members.some((member) => member.deviceId === options.localDeviceId) ||
      !/^device_[A-Za-z0-9_-]{43}$/.test(options.leaderId) ||
      !Number.isSafeInteger(options.leaseExpiresAt) ||
      options.leaseExpiresAt < 0 ||
      !Number.isInteger(this.leaseMs) ||
      this.leaseMs < 500 ||
      this.leaseMs > 30_000 ||
      !Number.isInteger(this.skewMs) ||
      this.skewMs < 0 ||
      this.skewMs * 4 >= this.leaseMs
    )
      throw new Error("temporary_election_configuration_invalid");
    this.epoch = options.epoch;
    this.leaderId = options.leaderId;
    this.leaseExpiresAt = options.leaseExpiresAt;
    this.nowSource = options.now ?? Date.now;
    const quarantineMs = options.startupQuarantineMs ?? this.leaseMs + 2 * this.skewMs;
    if (!Number.isSafeInteger(quarantineMs) || quarantineMs < 0 || quarantineMs > 60_000)
      throw new Error("temporary_election_configuration_invalid");
    this.quarantineUntil = this.clock() + quarantineMs;
  }

  propose(): LanElectionProposal {
    const now = this.clock();
    this.requireSafeClock();
    this.requireVotingReady(now);
    if (this.options.localDeviceId !== this.leaderId && now < this.leaseExpiresAt + this.skewMs)
      throw new Error("temporary_election_lease_active");
    return {
      version: 1,
      sessionId: this.options.sessionId,
      membershipDigest: this.membershipDigest,
      previousEpoch: this.epoch,
      epoch: this.epoch + 1,
      candidateId: this.options.localDeviceId,
      proposalId: randomBytes(32).toString("base64url"),
      issuedAt: now,
      expiresAt: now + this.leaseMs,
    };
  }

  vote(proposal: LanElectionProposal): Promise<SignedLanElectionVote> {
    const task = this.voteQueue.then(async () => {
      const now = this.clock();
      this.requireSafeClock();
      this.requireVotingReady(now);
      this.checkProposal(proposal, now);
      if (proposal.expiresAt <= now + this.skewMs)
        throw new Error("temporary_election_lease_expired");
      if (proposal.candidateId !== this.leaderId && now < this.leaseExpiresAt + this.skewMs)
        throw new Error("temporary_election_lease_active");
      const proposalDigest = lanElectionProposalDigest(proposal);
      const previous = this.voteReservation;
      if (
        previous?.epoch === proposal.epoch &&
        previous.digest !== proposalDigest &&
        now < previous.expiresAt + this.skewMs
      )
        throw new Error("temporary_election_already_voted");
      if (previous?.digest === proposalDigest && previous.vote)
        return structuredClone(previous.vote);
      const reservation = {
        epoch: proposal.epoch,
        digest: proposalDigest,
        expiresAt: proposal.expiresAt,
        vote: undefined as SignedLanElectionVote | undefined,
      };
      this.voteReservation = reservation;
      const payload: LanElectionVotePayload = {
        ...proposal,
        voterId: this.options.localDeviceId,
        proposalDigest,
      };
      const signature = await this.options.signVote({ ...payload });
      const vote: SignedLanElectionVote = { payload, signature };
      if (!verifyLanElectionVote(proposal, vote, this.members))
        throw new Error("temporary_election_vote_invalid");
      if (this.clock() + this.skewMs >= proposal.expiresAt || this.clockUnsafe)
        throw new Error("temporary_election_lease_expired");
      reservation.vote = vote;
      return structuredClone(vote);
    });
    this.voteQueue = task.catch(() => undefined);
    return task;
  }

  acceptCommit(commit: LanElectionCommit): void {
    const now = this.clock();
    this.requireSafeClock();
    if (commit?.proposal?.previousEpoch !== this.epoch || commit.proposal.epoch !== this.epoch + 1)
      throw new Error("temporary_election_epoch_invalid");
    this.checkProposal(commit.proposal, now);
    if (commit.proposal.candidateId !== this.leaderId && now < this.leaseExpiresAt + this.skewMs)
      throw new Error("temporary_election_lease_active");
    if (!Array.isArray(commit.votes) || commit.votes.length > this.members.length)
      throw new Error("temporary_election_vote_invalid");
    const seen = new Set<string>();
    for (const vote of commit.votes) {
      if (
        !verifyLanElectionVote(commit.proposal, vote, this.members) ||
        seen.has(vote.payload.voterId)
      )
        throw new Error("temporary_election_vote_invalid");
      seen.add(vote.payload.voterId);
    }
    if (seen.size < Math.floor(this.members.length / 2) + 1)
      throw new Error("temporary_election_quorum_required");
    if (!seen.has(commit.proposal.candidateId))
      throw new Error("temporary_election_candidate_approval_required");
    // Historical certificates can advance ordering, but leader() never activates an expired lease.
    this.epoch = commit.proposal.epoch;
    this.leaderId = commit.proposal.candidateId;
    this.leaseExpiresAt = commit.proposal.expiresAt;
    if (this.voteReservation && this.voteReservation.epoch <= this.epoch)
      this.voteReservation = undefined;
  }

  leader(): { leaderId: string; epoch: number; leaseExpiresAt: number } | undefined {
    const now = this.clock();
    if (this.clockUnsafe || now < this.quarantineUntil || now + this.skewMs >= this.leaseExpiresAt)
      return undefined;
    return { leaderId: this.leaderId, epoch: this.epoch, leaseExpiresAt: this.leaseExpiresAt };
  }

  /** Only the pinned authority's verified checkpoint may advance this remembered lease. */
  observeAuthorityLease(epoch: number, leaderId: string, leaseExpiresAt: number): void {
    this.requireSafeClock();
    if (
      epoch !== this.epoch ||
      leaderId !== this.leaderId ||
      !Number.isSafeInteger(leaseExpiresAt) ||
      leaseExpiresAt < 0
    )
      throw Error("temporary_election_epoch_invalid");
    this.leaseExpiresAt = Math.max(this.leaseExpiresAt, leaseExpiresAt);
  }

  authorizes(leaderId: string, epoch: number): boolean {
    const current = this.leader();
    return current?.leaderId === leaderId && current.epoch === epoch;
  }

  private checkProposal(proposal: LanElectionProposal, now: number): void {
    if (
      !validProposal(proposal, this.membershipDigest) ||
      proposal.sessionId !== this.options.sessionId ||
      proposal.previousEpoch !== this.epoch ||
      proposal.epoch !== this.epoch + 1 ||
      !this.members.some((member) => member.deviceId === proposal.candidateId) ||
      proposal.expiresAt - proposal.issuedAt > this.leaseMs ||
      proposal.issuedAt > now + this.skewMs
    )
      throw new Error("temporary_election_proposal_invalid");
  }

  private clock(): number {
    const now = this.nowSource();
    if (!Number.isSafeInteger(now) || now + this.skewMs < this.previousTime)
      this.clockUnsafe = true;
    this.previousTime = Math.max(this.previousTime, now);
    return now;
  }

  private requireSafeClock(): void {
    if (this.clockUnsafe) throw new Error("temporary_election_clock_unsafe");
  }

  private requireVotingReady(now: number): void {
    if (now < this.quarantineUntil) throw new Error("temporary_election_startup_quarantine");
  }
}
