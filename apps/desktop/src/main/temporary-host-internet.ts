import type { TemporaryRoomSnapshot } from "../../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryCoordinatorCheckpoint } from "../../../../packages/signaling/src/temporary-room-replica";
import type {
  TemporaryInternetHandoff,
  SignedInternetRegistration,
} from "../../../../packages/signaling/src/temporary-internet-protocol";
import { TemporaryInternetProvider } from "./temporary-internet-provider";
import {
  internetBrokerUrl,
  type TemporaryInternetEndpoint,
  type TemporaryInternetRoute,
} from "./temporary-internet-connection";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
export class TemporaryHostInternet {
  private provider?: TemporaryInternetProvider;
  private endpoint?: TemporaryInternetEndpoint;
  private readonly published = new Map<string, SignedInternetRegistration>();
  private readonly roles = new Map<string, "authority" | "member">();
  private readonly publications = new Map<string, Promise<void>>();
  private failedUntil = 0;
  private closed = false;
  constructor(
    private readonly identity: TemporaryIdentityStore,
    private readonly configured: () => TemporaryInternetEndpoint | undefined,
    private readonly ownedPort: number,
    private readonly certificateSha256: string,
  ) {}
  routeFor(sessionId: string): TemporaryInternetRoute | undefined {
    if (this.closed) return;
    const registration = this.published.get(sessionId);
    return registration && this.endpoint
      ? {
          broker: this.endpoint,
          sessionId,
          deviceId: registration.payload.authorityId,
          registration,
        }
      : undefined;
  }
  async publish(
    room: TemporaryRoomSnapshot | TemporaryCoordinatorCheckpoint,
    handoff?: TemporaryInternetHandoff,
    role?: "member",
  ): Promise<void> {
    return this.serialize(room.sessionId, () => this.publishNow(room, handoff, role));
  }
  private serialize(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const result = (this.publications.get(sessionId) ?? Promise.resolve()).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.publications.set(sessionId, settled);
    void settled.then(() => {
      if (this.publications.get(sessionId) === settled) this.publications.delete(sessionId);
    });
    return result;
  }
  private async publishNow(
    room: TemporaryRoomSnapshot | TemporaryCoordinatorCheckpoint,
    handoff?: TemporaryInternetHandoff,
    role?: "member",
  ): Promise<void> {
    const configured = this.configured();
    if (!configured || this.closed) return;
    if (this.failedUntil > Date.now()) throw Error("temporary_internet_bridge_unavailable");
    const url = internetBrokerUrl(configured.url),
      endpoint = { ...configured, url };
    if (this.endpoint?.url !== url || this.endpoint.certificate !== endpoint.certificate) {
      this.provider?.close();
      this.provider = new TemporaryInternetProvider(this.identity, endpoint, this.ownedPort);
      this.endpoint = endpoint;
      this.published.clear();
      this.roles.clear();
    }
    const provider = this.provider!;
    const previous = this.published.get(room.sessionId)?.payload;
    if (
      previous &&
      (room.epoch < previous.epoch ||
        (room.epoch === previous.epoch && room.revision < previous.revision))
    )
      return;
    const profile = (await this.identity.getProfile())!;
    const members = room.members
      .map((record) => ("member" in record ? record.member : record))
      .map((m) => ({ deviceId: m.deviceId, publicKey: m.publicKey }));
    if (!members.length) {
      await this.unpublishNow(room.sessionId);
      return;
    }
    const issuedAt = Date.now();
    const signed = await this.identity.signInternetRegistration({
      version: 1,
      sessionId: room.sessionId,
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
      code: room.code,
      epoch: room.epoch,
      revision: room.revision,
      members,
      certificateSha256: this.certificateSha256,
      issuedAt,
      expiresAt: issuedAt + 15000,
    });
    const publishedRole = role ?? (room.authorityId === profile.deviceId ? "authority" : "member");
    try {
      await provider.publish(signed, publishedRole, handoff);
      if (this.closed || this.provider !== provider) throw Error("temporary_bridge_closed");
      this.published.set(room.sessionId, signed);
      this.roles.set(room.sessionId, publishedRole);
    } catch (error) {
      if (this.closed || this.provider !== provider)
        throw Error("temporary_bridge_closed", { cause: error });
      if (error instanceof Error && error.message === "temporary_bridge_code_conflict") throw error;
      this.failedUntil = Date.now() + 10000;
      throw Error("temporary_internet_bridge_unavailable", { cause: error });
    }
  }
  async unpublish(sessionId: string) {
    return this.serialize(sessionId, () => this.unpublishNow(sessionId));
  }
  private async unpublishNow(sessionId: string) {
    if (!this.published.has(sessionId)) return;
    this.published.delete(sessionId);
    const role = this.roles.get(sessionId);
    this.roles.delete(sessionId);
    if (role === "authority") await this.provider?.unpublish(sessionId);
    else await this.provider?.withdraw(sessionId);
  }
  close() {
    this.closed = true;
    this.provider?.close();
    this.published.clear();
    this.roles.clear();
  }
  iceServers() {
    return this.provider?.iceServers() ?? [];
  }
}
