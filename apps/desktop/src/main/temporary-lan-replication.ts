import { isIP } from "node:net";
import {
  TemporaryRoomReplica,
  temporaryCheckpointDigest,
  type SignedTemporaryCheckpoint,
  type SignedTemporaryReplicaApproval,
} from "../../../../packages/signaling/src/temporary-room-replica";
import type { TemporaryRoomCoordinator } from "../../../../packages/signaling/src/temporary-room-coordinator";
import {
  assertVerifiedTemporaryPrincipal,
  type VerifiedTemporaryPrincipal,
} from "../../../../packages/signaling/src/temporary-room-auth";
import { TEMPORARY_AUTH_AUDIENCE } from "../../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryRoomSnapshot } from "../../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
import {
  TemporaryLanElection,
  type LanElectionCommit,
  type LanElectionProposal,
  type SignedLanElectionVote,
} from "./temporary-lan-election";
import {
  verifyLanRoomAnnouncement,
  type SignedLanRoomAnnouncement,
} from "./temporary-lan-discovery";
import { readPinnedLanCertificate } from "./temporary-lan-certificate";
import type { TemporaryRoomRoute } from "./temporary-lan-host";
import { temporaryReplicaRpc } from "./temporary-replica-rpc";
import {
  internetBrokerUrl,
  type TemporaryInternetRoute,
  type TemporaryInternetEndpoint,
} from "./temporary-internet-connection";
import {
  verifyInternetRegistration,
  MAX_INTERNET_HANDOFF_HISTORY,
  normalizeInternetRegistration,
  normalizeInternetHistory,
} from "../../../../packages/signaling/src/temporary-internet-protocol";
import type { TemporaryInternetHandoff } from "../../../../packages/signaling/src/temporary-internet-protocol";
import {
  internetMigrationCertificate,
  internetMigrationHistory,
  signCheckpointInternetMetadata,
  type InternetReplicaMetadata,
} from "./temporary-internet-lineage";
import {
  verifyTemporaryReplicaStateHead,
  type SignedTemporaryReplicaStateHead,
  type TemporaryReplicaStateHead,
} from "../../../../packages/signaling/src/temporary-room-state-head";

interface ReplicaPeer {
  endpoint: string;
  announcement: SignedLanRoomAnnouncement;
  bridge?: TemporaryInternetRoute;
}
interface Bundle extends InternetReplicaMetadata {
  signed: SignedTemporaryCheckpoint;
  peers: ReplicaPeer[];
  head?: SignedTemporaryReplicaStateHead;
}
interface Migration {
  peer: ReplicaPeer;
  source: Bundle;
  election: LanElectionCommit;
  approvals: SignedTemporaryReplicaApproval[];
}
interface View {
  replica: TemporaryRoomReplica;
  bundle: Bundle;
  authorityKey: string;
  fence?: TemporaryReplicaStateHead;
  election?: TemporaryLanElection;
  electionMembership?: string;
  campaign?: Promise<Migration>;
}
interface Primary {
  lease: number;
  acks: Map<string, { at: number; membership: string; lease: number }>;
  heads: Map<string, { membership: string; lease: number }>;
  bundle?: Bundle;
  peers: Map<string, ReplicaPeer>;
  committed?: SignedTemporaryCheckpoint;
  previousPeers?: ReplicaPeer[];
}
const LEASE_MS = 5000;
const safeAddress = (address: string) => {
  const value = address.replace(/^::ffff:/, "");
  if (isIP(value) !== 4 || !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(value))
    throw Error("temporary_replica_lan_address_required");
  return value;
};

/** Main-owned private WSS replication. Nothing in this class is a renderer/UDP payload. */
export class TemporaryLanReplication {
  private readonly views = new Map<string, View>();
  private readonly primaries = new Map<string, Primary>();
  private readonly routes = new Map<string, TemporaryRoomRoute>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly cancel = new AbortController();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private tickOperation?: Promise<void>;
  private readonly committing = new Set<string>();
  private closed = false;
  private localDeviceId = "";
  private readonly migrations = new Map<string, Migration>();
  private readonly commits = new Map<string, Promise<void>>();
  private readonly retirement = new Map<string, NodeJS.Timeout>();
  constructor(
    private readonly options: {
      identity: TemporaryIdentityStore;
      coordinator: () => TemporaryRoomCoordinator;
      localEndpoint: (sessionId: string, epoch: number) => Promise<ReplicaPeer>;
      activated: (room: TemporaryRoomSnapshot) => void;
      promoted?: (sessionId: string) => Promise<void>;
      demoted?: (sessionId: string) => void;
      internetEndpoint?: () => TemporaryInternetEndpoint | undefined;
      rooms: () => TemporaryRoomSnapshot[];
      now?: () => number;
      onError?: (code: string) => void;
    },
  ) {}
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  start(): void {
    if (this.closed || this.timer) return;
    this.timer = setInterval(() => this.track(this.tick()), 750);
    this.timer.unref();
  }
  private track(task: Promise<unknown>) {
    this.tasks.add(task);
    void task
      .catch((error) =>
        this.options.onError?.(
          error instanceof Error && /^temporary_[a-z_]+$/.test(error.message)
            ? error.message
            : "temporary_replication_unavailable",
        ),
      )
      .finally(() => this.tasks.delete(task));
  }
  async joined(route: TemporaryRoomRoute, room: TemporaryRoomSnapshot): Promise<void> {
    if ((!route.certificate && !route.bridge) || this.closed) return;
    this.start();
    const profile = await this.options.identity.getProfile();
    if (!profile) throw Error("temporary_profile_required");
    this.localDeviceId = profile.deviceId;
    if (room.authorityId === profile.deviceId) {
      await this.tick();
      return;
    }
    const authority =
      room.members.find((m) => m.deviceId === room.authorityId) ??
      route.bridge?.registration.payload;
    if (!authority) throw Error("temporary_replica_authority_unknown");
    this.routes.set(room.sessionId, route);
    const peer = await this.options.localEndpoint(room.sessionId, room.epoch);
    const bundle = (await temporaryReplicaRpc(
      this.options.identity,
      route,
      room.sessionId,
      { op: "sync", peer },
      this.cancel.signal,
    )) as Bundle;
    this.accept(bundle, authority.publicKey);
  }
  private accept(bundle: Bundle, authorityKey?: string): View {
    const c = bundle?.signed?.checkpoint;
    if (!c || !Array.isArray(bundle.peers) || bundle.peers.length > 5)
      throw Error("temporary_replica_bundle_invalid");
    let view = this.views.get(c.sessionId);
    if (!view || c.epoch > view.bundle.signed.checkpoint.epoch) {
      if (!authorityKey) throw Error("temporary_replica_authority_unknown");
      view = {
        authorityKey,
        replica: new TemporaryRoomReplica({
          sessionId: c.sessionId,
          authorityId: c.authorityId,
          authorityPublicKey: authorityKey,
          epoch: c.epoch,
          now: () => this.now(),
        }),
        bundle,
      };
    }
    if (
      view.fence &&
      (view.fence.terminal ||
        c.revision < view.fence.revision ||
        c.sequence < view.fence.sequence ||
        (c.sequence === view.fence.sequence &&
          temporaryCheckpointDigest(c) !== view.fence.checkpointDigest))
    )
      throw Error("temporary_checkpoint_stale");
    view.replica.acceptCheckpoint(bundle.signed);
    const registration = bundle.publicRegistration;
    if (
      bundle.history &&
      (!Array.isArray(bundle.history) || bundle.history.length > MAX_INTERNET_HANDOFF_HISTORY)
    )
      throw Error("temporary_replica_bundle_invalid");
    if (
      registration &&
      (!verifyInternetRegistration(registration, registration.payload.issuedAt) ||
        registration.payload.sessionId !== c.sessionId ||
        registration.payload.publicKey !== view.authorityKey ||
        registration.payload.authorityId !== c.authorityId ||
        registration.payload.epoch !== c.epoch ||
        registration.payload.revision !== c.revision ||
        registration.payload.code !== c.code ||
        JSON.stringify(registration.payload.members) !==
          JSON.stringify(
            c.members.map(({ member }) => ({
              deviceId: member.deviceId,
              publicKey: member.publicKey,
            })),
          ))
    )
      throw Error("temporary_replica_bundle_invalid");
    const peers: ReplicaPeer[] = [];
    for (const peer of bundle.peers) {
      // This roster came over authenticated WSS and is bounded by the signed checkpoint's TTL.
      // Discovery's shorter UDP freshness window must not invalidate an already pinned replica endpoint.
      const a = verifyLanRoomAnnouncement(peer.announcement, peer.announcement?.payload?.issuedAt);
      if (
        !a ||
        a.payload.sessionId !== c.sessionId ||
        a.payload.epoch > c.epoch ||
        !c.members.some(
          ({ member }) =>
            member.deviceId === a.payload.authorityId && member.publicKey === a.payload.publicKey,
        )
      )
        throw Error("temporary_replica_peer_invalid");
      const url = new URL(peer.endpoint);
      if (
        url.protocol !== "wss:" ||
        url.username ||
        url.password ||
        url.port !== String(a.payload.port)
      )
        throw Error("temporary_replica_peer_invalid");
      safeAddress(url.hostname);
      let bridge: TemporaryInternetRoute | undefined;
      if (peer.bridge) {
        const configured = this.options.internetEndpoint?.();
        const registration = peer.bridge.registration;
        if (
          configured &&
          verifyInternetRegistration(registration, this.now()) &&
          registration.payload.sessionId === c.sessionId &&
          registration.payload.authorityId === a.payload.authorityId &&
          registration.payload.publicKey === a.payload.publicKey &&
          registration.payload.certificateSha256 === a.payload.certificateSha256 &&
          internetBrokerUrl(configured.url) === internetBrokerUrl(peer.bridge.broker.url)
        )
          bridge = {
            broker: configured,
            sessionId: c.sessionId,
            deviceId: a.payload.authorityId,
            registration,
          };
      }
      peers.push({ announcement: a, endpoint: url.origin + "/temporary", bridge });
    }
    view.bundle = {
      signed: structuredClone(bundle.signed),
      peers,
      head: bundle.head,
      publicRegistration: registration
        ? normalizeInternetRegistration(registration, registration.payload.issuedAt)
        : undefined,
      history: normalizeInternetHistory(bundle.history),
    };
    this.views.set(c.sessionId, view);
    const oldPrimary = this.primaries.get(c.sessionId);
    if (
      oldPrimary?.bundle &&
      c.epoch > oldPrimary.bundle.signed.checkpoint.epoch &&
      c.authorityId !== this.localDeviceId
    ) {
      this.options
        .coordinator()
        .fenceAuthority(c.sessionId, oldPrimary.bundle.signed.checkpoint.epoch);
      this.primaries.delete(c.sessionId);
      this.options.demoted?.(c.sessionId);
    }
    return view;
  }
  private async peerRoute(peer: ReplicaPeer): Promise<TemporaryRoomRoute> {
    const a = verifyLanRoomAnnouncement(peer.announcement, peer.announcement?.payload?.issuedAt);
    if (!a) throw Error("temporary_replica_peer_expired");
    try {
      const certificate = await readPinnedLanCertificate(
        peer.endpoint,
        a.payload.certificateSha256,
        this.cancel.signal,
      );
      return { url: peer.endpoint, certificate };
    } catch (error) {
      if (!peer.bridge) throw error;
    }
    if (peer.bridge) {
      if (
        peer.bridge.deviceId !== a.payload.authorityId ||
        peer.bridge.registration.payload.publicKey !== a.payload.publicKey ||
        peer.bridge.registration.payload.certificateSha256 !== a.payload.certificateSha256
      )
        throw Error("temporary_replica_peer_invalid");
      return { url: peer.bridge.broker.url, bridge: peer.bridge };
    }
    throw Error("temporary_replica_peer_invalid");
  }
  private async call(peer: ReplicaPeer, sessionId: string, value: unknown) {
    return temporaryReplicaRpc(
      this.options.identity,
      await this.peerRoute(peer),
      sessionId,
      value,
      this.cancel.signal,
    );
  }
  private tick(): Promise<void> {
    if (this.closed || this.ticking) return Promise.resolve();
    return (this.tickOperation = this.tickNow());
  }
  private async tickNow(): Promise<void> {
    this.ticking = true;
    try {
      const profile = await this.options.identity.getProfile();
      if (!profile || this.closed) return;
      this.localDeviceId = profile.deviceId;
      for (const room of this.options.rooms()) {
        if (room.authorityId !== profile.deviceId || this.committing.has(room.sessionId)) continue;
        let p = this.primaries.get(room.sessionId);
        if (!p) {
          p = { lease: this.now() + LEASE_MS, acks: new Map(), heads: new Map(), peers: new Map() };
          this.primaries.set(room.sessionId, p);
        }
        const now = this.now();
        const old = p.bundle?.signed.checkpoint;
        const members = room.members;
        const quorum = Math.floor(members.length / 2) + 1;
        const acknowledgedLeases = members
          .map((m) =>
            m.deviceId === profile.deviceId
              ? now + LEASE_MS
              : old && p!.acks.get(m.deviceId)?.membership === old.membershipDigest
                ? p!.acks.get(m.deviceId)!.lease
                : 0,
          )
          .sort((a, b) => b - a);
        // Announce the proposed future lease first. Only acknowledgments for that exact signed head
        // can extend the authority's own write gate; a lost majority cannot renew it unilaterally.
        const acknowledgedLease = acknowledgedLeases[quorum - 1] ?? 0;
        if (now < p.lease && acknowledgedLease > p.lease) p.lease = acknowledgedLease;
        this.options.coordinator().setAuthorityLease(room.sessionId, Math.max(now, p.lease));
        if (now >= p.lease) continue;
        const endpoint = await this.options.localEndpoint(room.sessionId, room.epoch);
        if (members.some((m) => m.deviceId === profile.deviceId))
          p.peers.set(profile.deviceId, endpoint);
        // Preserve the previous roster until removed members have received a signed state fence.
        if (!p.previousPeers) p.previousPeers = [...p.peers.values()];
        const checkpoint = this.options
          .coordinator()
          .exportCheckpoint(room.sessionId, { leaseExpiresAt: now + LEASE_MS });
        const signed = await this.options.identity.signCheckpoint(checkpoint);
        const bundle: Bundle = {
          signed,
          peers: [...p.peers.values()].filter((peer) =>
            members.some((m) => m.deviceId === peer.announcement.payload.authorityId),
          ),
          head: await this.signedHead(signed),
        };
        if (checkpoint.status === "active") {
          bundle.publicRegistration = await signCheckpointInternetMetadata(
            this.options.identity,
            signed,
            endpoint.announcement.payload.certificateSha256,
          );
          bundle.history = internetMigrationHistory(
            this.migrations.get(room.sessionId),
            bundle.publicRegistration,
          );
        }
        // A commit owns its install sequence until the prior majority acknowledges it.
        // A signer that started earlier also cannot publish over a later checkpoint.
        if (
          this.committing.has(room.sessionId) ||
          checkpoint.sequence <= (p.bundle?.signed.checkpoint.sequence ?? 0)
        )
          continue;
        p.bundle = bundle;
        p.heads.set(temporaryCheckpointDigest(checkpoint), {
          membership: checkpoint.membershipDigest,
          lease: checkpoint.leaseExpiresAt,
        });
        while (p.heads.size > 16) p.heads.delete(p.heads.keys().next().value!);
      }
      for (const [sessionId, route] of this.routes) {
        const view = this.views.get(sessionId);
        if (!view || this.primaries.has(sessionId)) continue;
        const c = view.bundle.signed.checkpoint;
        try {
          const peer = await this.options.localEndpoint(sessionId, c.epoch);
          const bundle = (await temporaryReplicaRpc(
            this.options.identity,
            route,
            sessionId,
            { op: "sync", peer, ack: temporaryCheckpointDigest(c) },
            this.cancel.signal,
          )) as Bundle;
          this.accept(bundle, view.authorityKey);
        } catch {
          /* Recovery is requested by the owning signaling connection, never an unbounded background loop. */
        }
      }
    } finally {
      this.ticking = false;
      this.tickOperation = undefined;
    }
  }
  async request(
    principal: VerifiedTemporaryPrincipal,
    raw: unknown,
    address: string,
  ): Promise<unknown> {
    if (this.closed || !principal.sessionId || !raw || typeof raw !== "object")
      throw Error("temporary_replica_request_invalid");
    assertVerifiedTemporaryPrincipal(
      principal,
      TEMPORARY_AUTH_AUDIENCE,
      this.now(),
      principal.sessionId,
    );
    const data = raw as {
      op: string;
      peer?: ReplicaPeer;
      ack?: string;
      bundle?: Bundle;
      migration?: Migration;
      head?: SignedTemporaryReplicaStateHead;
      proposal?: LanElectionProposal;
      election?: LanElectionCommit;
    };
    const sessionId = principal.sessionId;
    if (data.op === "sync" && this.primaries.has(sessionId)) {
      const live = this.options.coordinator().snapshot(sessionId);
      if (
        !live.members.some(
          (m) => m.deviceId === principal.deviceId && m.publicKey === principal.publicKey,
        )
      )
        throw Error("temporary_replica_membership_required");
      for (let attempt = 0; attempt < 20; attempt++) {
        await this.tick();
        if (
          this.primaries
            .get(sessionId)
            ?.bundle?.signed.checkpoint.members.some(
              (m) => m.member.deviceId === principal.deviceId,
            )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    let view = this.views.get(sessionId);
    const primary = this.primaries.get(sessionId);
    if (
      primary?.bundle &&
      (!view || primary.bundle.signed.checkpoint.epoch > view.bundle.signed.checkpoint.epoch)
    ) {
      view = this.accept(primary.bundle, (await this.options.identity.getProfile())!.publicKey);
    }
    const c = primary?.bundle?.signed.checkpoint ?? view?.bundle.signed.checkpoint;
    if (
      !c ||
      !(
        c.members.some(
          ({ member }) =>
            member.deviceId === principal.deviceId && member.publicKey === principal.publicKey,
        ) ||
        ((data.op === "fence" || data.op === "install") &&
          view &&
          principal.deviceId === c.authorityId &&
          principal.publicKey === view.authorityKey)
      )
    )
      throw Error("temporary_replica_membership_required");
    if (data.op === "sync") {
      if (!primary?.bundle || this.now() >= primary.lease)
        throw Error("temporary_authority_lease_expired");
      const signed = verifyLanRoomAnnouncement(data.peer?.announcement, this.now());
      if (
        !signed ||
        signed.payload.authorityId !== principal.deviceId ||
        signed.payload.publicKey !== principal.publicKey ||
        signed.payload.sessionId !== sessionId ||
        signed.payload.epoch !== c.epoch
      )
        throw Error("temporary_replica_peer_invalid");
      primary.peers.set(principal.deviceId, {
        announcement: signed,
        endpoint: `wss://${safeAddress(address)}:${signed.payload.port}/temporary`,
        bridge: data.peer?.bridge,
      });
      const acknowledged = data.ack && primary.heads.get(data.ack);
      if (acknowledged) primary.acks.set(principal.deviceId, { at: this.now(), ...acknowledged });
      primary.bundle.peers = [...primary.peers.values()];
      return primary.bundle;
    }
    if (!view) throw Error("temporary_replication_unavailable");
    if (data.op === "fence") {
      const head = data.head;
      if (
        !head ||
        !verifyTemporaryReplicaStateHead(head, view.authorityKey, this.now()) ||
        head.payload.sessionId !== sessionId ||
        head.payload.epoch !== c.epoch ||
        head.payload.revision < c.revision ||
        head.payload.sequence < c.sequence ||
        (view.fence && head.payload.sequence < view.fence.sequence)
      )
        throw Error("temporary_replica_head_invalid");
      view.fence = head.payload;
      return { digest: head.payload.checkpointDigest };
    }
    if (data.op === "install") {
      let nextKey: string | undefined;
      if (data.bundle?.signed.checkpoint.epoch !== c.epoch) {
        const migration = data.migration;
        if (!migration) throw Error("temporary_replica_migration_invalid");
        const source = new TemporaryRoomReplica({
          sessionId,
          authorityId: c.authorityId,
          authorityPublicKey: view.authorityKey,
          epoch: c.epoch,
          now: () => this.now(),
        });
        source.acceptCheckpoint(migration.source.signed);
        const proof = source.verifyHandoff(migration);
        if (
          migration.source.signed.checkpoint.sequence < c.sequence ||
          proof.authorityId !== data.bundle?.signed.checkpoint.authorityId ||
          proof.epoch !== data.bundle?.signed.checkpoint.epoch
        )
          throw Error("temporary_replica_migration_invalid");
        nextKey = c.members.find((m) => m.member.deviceId === proof.authorityId)?.member.publicKey;
        this.migrations.set(sessionId, migration);
        this.routes.set(sessionId, await this.peerRoute(migration.peer));
      }
      view = this.accept(data.bundle!, nextKey);
      return { digest: temporaryCheckpointDigest(view.bundle.signed.checkpoint) };
    }
    if (view.fence && (view.fence.terminal || view.fence.sequence > c.sequence))
      throw Error("temporary_checkpoint_stale");
    if (data.op === "head") return view.bundle;
    if (data.op === "offer") {
      view = this.accept(data.bundle!);
      return { accepted: temporaryCheckpointDigest(view.bundle.signed.checkpoint) };
    }
    if (data.op === "vote") {
      if (!data.proposal) throw Error("temporary_election_proposal_invalid");
      return this.policy(view).vote(data.proposal);
    }
    if (data.op === "approve")
      return this.options.identity.signReplicaApproval(
        view.replica.approvalFor(
          data.election!,
          (await this.options.identity.getProfile())!.deviceId,
        ),
      );
    if (data.op === "campaign") return this.campaign(sessionId);
    throw Error("temporary_replica_command_invalid");
  }
  private policy(view: View): TemporaryLanElection {
    const c = view.bundle.signed.checkpoint;
    if (view.fence && (view.fence.terminal || view.fence.sequence > c.sequence))
      throw Error("temporary_checkpoint_stale");
    if (!view.election || view.electionMembership !== c.membershipDigest) {
      const resetting = Boolean(view.election);
      view.election = new TemporaryLanElection({
        sessionId: c.sessionId,
        members: c.members.map((m) => m.member),
        localDeviceId: this.localDeviceId,
        epoch: c.epoch,
        leaderId: c.authorityId,
        leaseExpiresAt: c.leaseExpiresAt,
        leaseMs: LEASE_MS,
        startupQuarantineMs: resetting ? LEASE_MS + 400 : 0,
        now: () => this.now(),
        signVote: async (payload) =>
          (
            await this.options.identity.signElectionVote(payload, {
              sessionId: c.sessionId,
              membershipDigest: c.membershipDigest,
            })
          ).signature,
      });
      view.electionMembership = c.membershipDigest;
    }
    view.election.observeAuthorityLease(c.epoch, c.authorityId, c.leaseExpiresAt);
    return view.election;
  }
  async recover(room: TemporaryRoomSnapshot): Promise<TemporaryRoomRoute> {
    const view = this.views.get(room.sessionId);
    if (!view) throw Error("temporary_replication_unavailable");
    const approved = this.migrations.get(room.sessionId);
    if (approved && approved.election.proposal.previousEpoch === room.epoch) {
      const route = await this.peerRoute(approved.peer);
      return {
        ...route,
        expected: {
          sessionId: room.sessionId,
          authorityId: approved.election.proposal.candidateId,
          epoch: approved.election.proposal.epoch,
        },
      };
    }
    const wait = view.bundle.signed.checkpoint.leaseExpiresAt + 250 - this.now();
    if (wait > 0)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(wait, LEASE_MS + 250));
        this.cancel.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Error("temporary_replica_cancelled"));
          },
          { once: true },
        );
      });
    const me = (await this.options.identity.getProfile())!.deviceId;
    for (const peer of [...view.bundle.peers].sort((a, b) =>
      a.announcement.payload.authorityId.localeCompare(b.announcement.payload.authorityId),
    )) {
      if (peer.announcement.payload.authorityId === room.authorityId) continue;
      try {
        const migration =
          peer.announcement.payload.authorityId === me
            ? await this.campaign(room.sessionId)
            : ((await this.call(peer, room.sessionId, { op: "campaign" })) as Migration);
        const source = migration.source.signed.checkpoint;
        const verifier = new TemporaryRoomReplica({
          sessionId: room.sessionId,
          authorityId: room.authorityId,
          authorityPublicKey: view.authorityKey,
          epoch: room.epoch,
          now: () => this.now(),
        });
        verifier.acceptCheckpoint(migration.source.signed);
        const verified = verifier.verifyHandoff(migration);
        const target = migration.peer;
        if (
          source.sequence < view.bundle.signed.checkpoint.sequence ||
          target.announcement.payload.authorityId !== verified.authorityId ||
          target.announcement.payload.epoch !== verified.epoch
        )
          throw Error("temporary_replica_migration_invalid");
        const route = await this.peerRoute(target);
        return {
          ...route,
          expected: {
            sessionId: room.sessionId,
            authorityId: verified.authorityId,
            epoch: verified.epoch,
          },
        };
      } catch (error) {
        if (error instanceof Error && /^temporary_[a-z_]+$/.test(error.message))
          this.options.onError?.(error.message);
      }
    }
    throw Error("temporary_replica_quorum_required");
  }
  private async campaign(sessionId: string): Promise<Migration> {
    const done = this.migrations.get(sessionId);
    const view = this.views.get(sessionId);
    if (!view) throw Error("temporary_replication_unavailable");
    if (done && done.election.proposal.previousEpoch === view.bundle.signed.checkpoint.epoch)
      return done;
    if (view.campaign) return view.campaign;
    view.campaign = this.runCampaign(sessionId, view).finally(() => {
      view.campaign = undefined;
    });
    return view.campaign;
  }
  private async runCampaign(sessionId: string, original: View): Promise<Migration> {
    const me = (await this.options.identity.getProfile())!.deviceId;
    const primary = this.primaries.get(sessionId);
    if (primary && primary.lease > this.now()) throw Error("temporary_authority_lease_active");
    const known = original.bundle.peers.filter((p) => p.announcement.payload.authorityId !== me);
    await Promise.allSettled(
      known.map(async (peer) => {
        const bundle = (await this.call(peer, sessionId, { op: "head" })) as Bundle;
        if (
          bundle.signed.checkpoint.sequence >
          this.views.get(sessionId)!.bundle.signed.checkpoint.sequence
        )
          this.accept(bundle);
      }),
    );
    const view = this.views.get(sessionId)!;
    const remainingLease = view.bundle.signed.checkpoint.leaseExpiresAt + 250 - this.now();
    if (remainingLease > 0)
      await new Promise((resolve) => setTimeout(resolve, Math.min(remainingLease, LEASE_MS + 250)));
    await Promise.allSettled(
      known.map((peer) => this.call(peer, sessionId, { op: "offer", bundle: view.bundle })),
    );
    const proposal = this.policy(view).propose();
    const votes = [await this.policy(view).vote(proposal)];
    await Promise.allSettled(
      known.map(async (peer) => {
        votes.push(
          (await this.call(peer, sessionId, { op: "vote", proposal })) as SignedLanElectionVote,
        );
      }),
    );
    const election: LanElectionCommit = { proposal, votes };
    const policy = this.policy(view);
    policy.acceptCommit(election);
    const approvals = [
      await this.options.identity.signReplicaApproval(view.replica.approvalFor(election, me)),
    ];
    await Promise.allSettled(
      known.map(async (peer) => {
        approvals.push(
          (await this.call(peer, sessionId, {
            op: "approve",
            election,
          })) as SignedTemporaryReplicaApproval,
        );
      }),
    );
    const proof = view.replica.verifyHandoff({ election, approvals });
    const room = this.options.coordinator().importCheckpoint(proof);
    this.primaries.set(sessionId, {
      lease: proposal.expiresAt,
      acks: new Map(),
      heads: new Map(),
      // The authenticated source roster remains reachable before every member has refreshed its new-epoch announcement.
      // Endpoint signatures are trust anchors only; old member tickets still cannot authorize an import or room RPC.
      peers: new Map(
        view.bundle.peers.map((peer) => [peer.announcement.payload.authorityId, peer]),
      ),
      committed: view.bundle.signed,
      previousPeers: view.bundle.peers,
    });
    this.routes.delete(sessionId);
    this.options.activated(room);
    await this.tick();
    const migration = {
      peer: {
        ...(await this.options.localEndpoint(sessionId, room.epoch)),
        endpoint:
          view.bundle.peers.find((p) => p.announcement.payload.authorityId === me)?.endpoint ??
          (await this.options.localEndpoint(sessionId, room.epoch)).endpoint,
      },
      source: view.bundle,
      election,
      approvals,
    };
    this.migrations.set(sessionId, migration);
    await this.options
      .promoted?.(sessionId)
      .catch(() => this.options.onError?.("temporary_internet_bridge_unavailable"));
    return migration;
  }
  /** Mutating room RPCs return only after a majority of the previous view retained the new state/fence. */
  commit(sessionId: string): Promise<void> {
    if (this.closed) return Promise.reject(Error("temporary_replication_unavailable"));
    const previous = this.commits.get(sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => this.commitState(sessionId));
    this.commits.set(sessionId, task);
    this.track(task);
    return task.finally(() => {
      if (this.commits.get(sessionId) === task) this.commits.delete(sessionId);
    });
  }
  private async commitState(sessionId: string): Promise<void> {
    await this.tickOperation;
    await this.tick();
    this.committing.add(sessionId);
    try {
      await this.commitCheckpoint(sessionId);
    } finally {
      this.committing.delete(sessionId);
    }
  }
  private async commitCheckpoint(sessionId: string): Promise<void> {
    const p = this.primaries.get(sessionId);
    if (!p?.bundle) throw Error("temporary_replication_unavailable");
    const profile = (await this.options.identity.getProfile())!;
    const before = p.committed?.checkpoint ?? p.bundle.signed.checkpoint;
    const c = this.options
      .coordinator()
      .exportCheckpoint(sessionId, { leaseExpiresAt: Math.max(this.now(), p.lease) });
    const signed = await this.options.identity.signCheckpoint(c);
    const currentIds = new Set(c.members.map((m) => m.member.deviceId));
    const peers = [
      ...new Map(
        [...(p.previousPeers ?? []), ...p.peers.values()].map((peer) => [
          peer.announcement.payload.authorityId,
          peer,
        ]),
      ).values(),
    ];
    const bundle: Bundle = {
      signed,
      peers: peers.filter(
        (peer) =>
          currentIds.has(peer.announcement.payload.authorityId) &&
          peer.announcement.payload.epoch <= c.epoch,
      ),
      head: await this.signedHead(signed),
    };
    if (c.status === "active") {
      const endpoint = await this.options.localEndpoint(sessionId, c.epoch);
      bundle.publicRegistration = await signCheckpointInternetMetadata(
        this.options.identity,
        signed,
        endpoint.announcement.payload.certificateSha256,
      );
      bundle.history = internetMigrationHistory(
        this.migrations.get(sessionId),
        bundle.publicRegistration,
      );
    }
    const head = await this.options.identity.signReplicaStateHead({
      version: 1,
      sessionId,
      authorityId: c.authorityId,
      epoch: c.epoch,
      revision: c.revision,
      sequence: c.sequence,
      checkpointDigest: temporaryCheckpointDigest(c),
      membershipDigest: c.membershipDigest,
      terminal: c.status === "closed",
      issuedAt: this.now(),
      expiresAt: this.now() + 10_000,
    });
    const acknowledgers = new Set<string>();
    if (before.members.some((m) => m.member.deviceId === profile.deviceId))
      acknowledgers.add(profile.deviceId);
    await Promise.allSettled(
      peers
        .map(async (peer) => {
          const id = peer.announcement.payload.authorityId;
          if (id === profile.deviceId) return;
          const result = (await this.call(
            peer,
            sessionId,
            currentIds.has(id) || c.status === "closed"
              ? { op: "install", bundle, migration: this.migrations.get(sessionId) }
              : { op: "fence", head },
          )) as { digest?: string };
          if (
            result?.digest === head.payload.checkpointDigest &&
            before.members.some((m) => m.member.deviceId === id)
          )
            acknowledgers.add(id);
        })
        .map((task) =>
          task.catch((error) => {
            if (error instanceof Error && /^temporary_[a-z_]+$/.test(error.message))
              this.options.onError?.(error.message);
            throw error;
          }),
        ),
    );
    if (acknowledgers.size < Math.floor(before.members.length / 2) + 1) {
      this.options.coordinator().setAuthorityLease(sessionId, this.now());
      p.lease = this.now();
      throw Error("temporary_replica_quorum_required");
    }
    p.committed = signed;
    p.bundle = bundle;
    p.previousPeers = bundle.peers;
    for (const id of p.peers.keys()) if (!currentIds.has(id)) p.peers.delete(id);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.cancel.abort();
    for (const timer of this.retirement.values()) clearTimeout(timer);
    this.retirement.clear();
    await Promise.allSettled([...this.tasks]);
    this.views.clear();
    this.primaries.clear();
    this.routes.clear();
    this.migrations.clear();
  }

  left(sessionId: string): void {
    this.routes.delete(sessionId);
    clearTimeout(this.retirement.get(sessionId));
    const timer = setTimeout(() => {
      this.views.delete(sessionId);
      this.migrations.delete(sessionId);
      this.retirement.delete(sessionId);
    }, 70_000);
    timer.unref();
    this.retirement.set(sessionId, timer);
  }

  private signedHead(signed: SignedTemporaryCheckpoint): Promise<SignedTemporaryReplicaStateHead> {
    const c = signed.checkpoint;
    return this.options.identity.signReplicaStateHead({
      version: 1,
      sessionId: c.sessionId,
      authorityId: c.authorityId,
      epoch: c.epoch,
      revision: c.revision,
      sequence: c.sequence,
      checkpointDigest: temporaryCheckpointDigest(c),
      membershipDigest: c.membershipDigest,
      terminal: c.status === "closed",
      issuedAt: c.exportedAt,
      expiresAt: c.expiresAt,
    });
  }
  publication(sessionId: string) {
    const p = this.primaries.get(sessionId);
    if (!p?.bundle || p.lease <= this.now()) return undefined;
    const c =
      p.committed?.checkpoint.authorityId === this.localDeviceId
        ? p.committed.checkpoint
        : p.bundle.signed.checkpoint;
    return c.status === "active" ? structuredClone(c) : undefined;
  }
  internetHandoff(sessionId: string): TemporaryInternetHandoff | undefined {
    return internetMigrationCertificate(this.migrations.get(sessionId));
  }
  internetState(sessionId: string) {
    const primary = this.primaries.get(sessionId);
    if (primary) return this.publication(sessionId);
    const view = this.views.get(sessionId);
    const c = view?.bundle.signed.checkpoint;
    return c && c.status === "active" && !view?.fence?.terminal && c.expiresAt > this.now()
      ? structuredClone(c)
      : undefined;
  }
  standbyState(sessionId: string) {
    const c = this.primaries.get(sessionId)?.bundle?.signed.checkpoint;
    return c && c.status === "active" && c.expiresAt > this.now() ? structuredClone(c) : undefined;
  }
}
