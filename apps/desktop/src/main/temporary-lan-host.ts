import { randomBytes } from "node:crypto";
import { createServer } from "node:https";
import { SignalingServer } from "../../../../packages/signaling/src/server";
import type { TemporaryRoomSnapshot } from "../../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
import type { TemporaryLanDiscovery } from "./temporary-lan-discovery";
import { createLanCertificate } from "./temporary-lan-certificate";
import { TemporaryLanReplication } from "./temporary-lan-replication";
import type { SignedLanRoomAnnouncement } from "./temporary-lan-discovery";
import type {
  TemporaryInternetRoute,
  TemporaryInternetEndpoint,
} from "./temporary-internet-connection";
import { TemporaryHostInternet } from "./temporary-host-internet";

export interface TemporaryRoomRoute {
  url: string;
  /** Main-only trust anchor, never placed in a renderer descriptor. */
  certificate?: string;
  bridge?: TemporaryInternetRoute;
  expected?: { sessionId: string; authorityId: string; epoch: number };
}

/** Ephemeral existing signaling engine. No account backend, permanent routes or files. */
export class TemporaryLanHost {
  private server?: SignalingServer;
  private opening?: Promise<TemporaryRoomRoute>;
  private route?: TemporaryRoomRoute;
  private readonly rooms = new Map<string, TemporaryRoomSnapshot>();
  private refresh?: NodeJS.Timeout;
  private generation = 0;
  private closed = false;
  private publishing = false;
  private readonly discoveryId = randomBytes(32).toString("base64url");
  private pin?: string;
  readonly replication: TemporaryLanReplication;
  private internet?: TemporaryHostInternet;
  private internetEndpoint?: () => TemporaryInternetEndpoint | undefined;
  private readonly following = new Set<string>();
  private readonly connectivity = new Set<(sessionId: string, error?: string) => void>();

  constructor(
    private readonly options: {
      identity: TemporaryIdentityStore;
      discovery: TemporaryLanDiscovery;
      bindAddress?: string;
      onError?: (code: string) => void;
    },
  ) {
    this.replication = new TemporaryLanReplication({
      identity: options.identity,
      coordinator: () => {
        if (!this.server) throw Error("temporary_lan_host_unavailable");
        return this.server.temporaryCoordinator;
      },
      localEndpoint: async (sessionId, epoch) => ({
        endpoint: (await this.start()).url,
        announcement: await this.announcement(sessionId, epoch),
        bridge: this.internet?.routeFor(sessionId),
      }),
      rooms: () => [...this.rooms.values()],
      activated: (room) => {
        this.rooms.set(room.sessionId, room);
      },
      onError: options.onError,
      internetEndpoint: () => this.internetEndpoint?.(),
      promoted: (id) => this.publishInternet(id),
      demoted: (id) => {
        this.rooms.delete(id);
        this.options.discovery.unpublish(id);
      },
    });
  }

  private async announcement(sessionId: string, epoch: number): Promise<SignedLanRoomAnnouncement> {
    const route = await this.start();
    const profile = await this.options.identity.getProfile();
    if (!profile || !this.pin) throw Error("temporary_profile_required");
    const issuedAt = Date.now();
    return this.options.identity.signLanAnnouncement({
      protocol: 1,
      type: "announcement",
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
      sessionId,
      epoch,
      port: Number(new URL(route.url).port),
      certificateSha256: this.pin,
      discoveryId: this.discoveryId,
      issuedAt,
      expiresAt: issuedAt + 15_000,
    });
  }

  async start(): Promise<TemporaryRoomRoute> {
    if (this.closed) throw Error("temporary_lan_host_closed");
    if (this.route) return this.route;
    if (this.opening) return this.opening;
    const generation = this.generation;
    this.opening = (async () => {
      const profile = await this.options.identity.getProfile();
      if (!profile) throw Error("temporary_profile_required");
      await this.options.discovery.start();
      if (this.closed || generation !== this.generation) throw Error("temporary_lan_host_closed");
      const certificate = createLanCertificate();
      this.pin = certificate.sha256;
      const https = createServer({ cert: certificate.cert, key: certificate.key });
      const server = new SignalingServer({
        roomName: "临时联机",
        host: this.options.bindAddress ?? "0.0.0.0",
        temporaryOnly: true,
        temporaryAuthorityId: profile.deviceId,
        temporaryIceServers: () => this.internet?.iceServers() ?? [],
        temporaryReplicaRequest: (principal, value, address) =>
          this.replication.request(principal, value, address),
        temporaryCommit: async (sessionId) => {
          await this.replication.commit(sessionId);
          await this.publishInternet(sessionId).catch((error) => {
            if (error instanceof Error && error.message === "temporary_bridge_code_conflict")
              throw error;
          });
        },
        httpServer: https,
        accountBackend: { configured: false } as never,
      });
      this.server = server;
      server.on("temporaryRoom", (id: string, room?: TemporaryRoomSnapshot) => {
        if (this.closed || this.server !== server) return;
        if (room) this.rooms.set(id, room);
        else {
          this.rooms.delete(id);
          this.options.discovery.unpublish(id);
        }
        void this.publish(certificate.sha256, profile);
      });
      try {
        const port = await server.listen();
        if (this.closed || generation !== this.generation) {
          await server.close();
          throw Error("temporary_lan_host_closed");
        }
        this.route = { url: `wss://127.0.0.1:${port}/temporary`, certificate: certificate.cert };
        this.internet = new TemporaryHostInternet(
          this.options.identity,
          () => this.internetEndpoint?.(),
          port,
          certificate.sha256,
        );
        this.refresh = setInterval(() => void this.publish(certificate.sha256, profile), 5000);
        this.refresh.unref();
        this.replication.start();
        return this.route;
      } catch (error) {
        if (this.server === server) this.server = undefined;
        if (https.listening) await server.close();
        else https.close();
        throw error;
      }
    })().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private async publish(
    pin: string,
    profile: { publicKey: string; deviceId: string },
  ): Promise<void> {
    if (this.closed || !this.route || this.publishing) return;
    this.publishing = true;
    const generation = this.generation;
    try {
      const port = Number(new URL(this.route.url).port);
      for (const room of this.rooms.values()) {
        const issuedAt = Date.now();
        const signed = await this.options.identity.signLanAnnouncement({
          protocol: 1,
          type: "announcement",
          authorityId: profile.deviceId,
          publicKey: profile.publicKey,
          sessionId: room.sessionId,
          epoch: room.epoch,
          port,
          certificateSha256: pin,
          discoveryId: this.discoveryId,
          issuedAt,
          expiresAt: issuedAt + 15_000,
        });
        if (
          this.closed ||
          this.generation !== generation ||
          this.rooms.get(room.sessionId) !== room
        )
          continue;
        this.options.discovery.publish(signed);
      }
      for (const id of new Set([...this.rooms.keys(), ...this.following]))
        await this.publishInternet(id);
    } catch {
      this.options.onError?.("temporary_lan_announcement_failed");
    } finally {
      this.publishing = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    clearInterval(this.refresh);
    this.internet?.close();
    await this.replication.close();
    await this.opening?.catch(() => undefined);
    for (const id of this.rooms.keys()) this.options.discovery.unpublish(id);
    this.rooms.clear();
    this.route = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await server.close();
  }

  configureInternet(endpoint: () => string | TemporaryInternetEndpoint): void {
    this.internetEndpoint = () => {
      const value = endpoint();
      const configured = typeof value === "string" ? { url: value.trim() } : value;
      return configured.url ? configured : undefined;
    };
  }
  async joined(
    route: TemporaryRoomRoute,
    room: TemporaryRoomSnapshot,
  ): Promise<string | undefined> {
    await this.start();
    this.following.add(room.sessionId);
    let warning: string | undefined = this.internetEndpoint?.()
      ? undefined
      : "temporary_internet_bridge_unavailable";
    try {
      if (room.authorityId === (await this.options.identity.getProfile())?.deviceId)
        await this.publishInternet(room.sessionId);
      else await this.internet?.publish(room, this.replication.internetHandoff(room.sessionId));
    } catch {
      warning = "temporary_internet_bridge_unavailable";
    }
    await this.replication.joined(route, room);
    return warning;
  }
  private async publishInternet(sessionId: string): Promise<void> {
    if (!this.internetEndpoint?.()) {
      this.networkState(sessionId, "temporary_internet_bridge_unavailable");
      return;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const active = this.replication.internetState(sessionId);
      const c = active ?? this.replication.standbyState(sessionId);
      if (!c) {
        if (!this.rooms.has(sessionId))
          await this.internet?.unpublish(sessionId).catch(() => undefined);
        return;
      }
      try {
        await this.internet?.publish(
          c,
          this.replication.internetHandoff(sessionId),
          !active ? "member" : undefined,
        );
        this.networkState(sessionId, !active ? "temporary_internet_bridge_unavailable" : undefined);
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "temporary_bridge_code_conflict" &&
          c.authorityId === (await this.options.identity.getProfile())?.deviceId
        ) {
          this.server!.temporaryCoordinator.rotateReservedCode(sessionId, c);
          this.server!.refreshTemporaryRoom(sessionId);
          await this.replication.commit(sessionId);
          continue;
        }
        this.options.onError?.("temporary_internet_bridge_unavailable");
        this.networkState(sessionId, "temporary_internet_bridge_unavailable");
        throw Error("temporary_internet_bridge_unavailable", { cause: error });
      }
    }
    throw Error("temporary_bridge_code_conflict");
  }
  onConnectivity(listener: (sessionId: string, error?: string) => void): () => void {
    this.connectivity.add(listener);
    return () => this.connectivity.delete(listener);
  }
  left(sessionId: string): void {
    this.following.delete(sessionId);
    this.replication.left(sessionId);
    // A creator leaving the room does not own the service lifetime while other members still use it.
    if (!this.rooms.has(sessionId)) void this.internet?.unpublish(sessionId).catch(() => undefined);
  }
  private networkState(sessionId: string, error?: string) {
    for (const listener of this.connectivity)
      try {
        listener(sessionId, error);
      } catch {
        /* Observer does not own the host. */
      }
  }
}
