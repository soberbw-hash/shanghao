import { connect, type Socket } from "node:net";
import { type WebSocket } from "ws";
import {
  TemporaryInternetConnection,
  pairInternetSocket,
  internetByteStream,
  type TemporaryInternetEndpoint,
} from "./temporary-internet-connection";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
import type {
  SignedInternetRegistration,
  TemporaryInternetHandoff,
} from "../../../../packages/signaling/src/temporary-internet-protocol";
import type { IceServerConfig } from "../../../../packages/signaling/src/protocol";
/** The only TCP target is this generation's owned local TLS service. No IPC/remote address is accepted. */
export class TemporaryInternetProvider {
  private readonly control: TemporaryInternetConnection;
  private readonly cancel = new AbortController();
  private readonly pipes = new Set<{ outer: WebSocket; local: Socket }>();
  private closed = false;
  private ice: IceServerConfig[] = [];
  constructor(
    identity: TemporaryIdentityStore,
    private readonly endpoint: TemporaryInternetEndpoint,
    private readonly ownedPort: number,
  ) {
    if (!Number.isInteger(ownedPort) || ownedPort < 1 || ownedPort > 65535)
      throw Error("temporary_bridge_target_invalid");
    this.control = new TemporaryInternetConnection(identity, endpoint);
    this.control.onPipe((offer) => {
      if (this.closed || this.pipes.size >= 24) return;
      void this.accept(offer).catch(() => undefined);
    });
  }
  private async accept(offer: Parameters<typeof pairInternetSocket>[1]) {
    const outer = await pairInternetSocket(this.endpoint, offer, "provider", this.cancel.signal);
    if (this.closed) {
      outer.terminate();
      return;
    }
    const local = connect({ host: "127.0.0.1", port: this.ownedPort });
    const pipe = { outer, local };
    this.pipes.add(pipe);
    const stream = internetByteStream(outer);
    const cleanup = () => {
      this.pipes.delete(pipe);
      outer.terminate();
      local.destroy();
    };
    local.once("error", cleanup);
    local.once("close", cleanup);
    stream.once("error", cleanup);
    stream.once("close", cleanup);
    stream.pipe(local).pipe(stream);
  }
  async publish(
    signed: SignedInternetRegistration,
    role: "authority" | "member",
    handoff?: TemporaryInternetHandoff,
  ) {
    if (this.closed) throw Error("temporary_bridge_closed");
    const result = (await this.control.request(
      "register",
      { signed, role, handoff },
      signed.payload.sessionId,
    )) as { iceServers?: IceServerConfig[] };
    if (
      Array.isArray(result.iceServers) &&
      result.iceServers.length <= 8 &&
      result.iceServers.every((s) =>
        Array.isArray(s.urls)
          ? s.urls.every((u) => typeof u === "string" && /^(stun|turn|turns):/.test(u))
          : typeof s.urls === "string" && /^(stun|turn|turns):/.test(s.urls),
      )
    )
      this.ice = result.iceServers;
  }
  async unpublish(sessionId: string) {
    if (!this.closed) await this.control.request("unregister", {}, sessionId);
  }
  async withdraw(sessionId: string) {
    if (!this.closed) await this.control.request("withdraw", {}, sessionId);
  }
  close() {
    this.closed = true;
    this.cancel.abort();
    this.control.close();
    for (const p of this.pipes) {
      p.outer.terminate();
      p.local.destroy();
    }
    this.pipes.clear();
  }
  iceServers(): IceServerConfig[] {
    return structuredClone(this.ice);
  }
}
