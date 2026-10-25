import type { HostShareInfo, RemoteControlServiceSnapshot } from "@private-voice/shared";
import type { RemoteControlService } from "./remote-control-service";

const empty = (): RemoteControlServiceSnapshot => ({
  host: { phase: "idle", requests: [] },
  incomingRequests: [],
  remoteShares: {},
  outgoingRequests: {},
  remoteGrants: {},
});
/** Main-only binding. A detached renderer never chooses its room, peer or grant. */
export class RemoteControlViewerBinding {
  private service?: RemoteControlService;
  private binding?: { contentsId: number; sessionId: string; peerId: string; share: string };
  configure(service: RemoteControlService) {
    this.service = service;
  }
  private signature(share: HostShareInfo) {
    return JSON.stringify(share);
  }
  bind(contentsId: number, sessionId: string, peerId?: string) {
    this.clear();
    const share = peerId && this.service?.snapshot().remoteShares[peerId];
    if (share && peerId)
      this.binding = { contentsId, sessionId, peerId, share: this.signature(share) };
  }
  peer(contentsId: number): string | undefined {
    const binding = this.binding;
    if (!binding || binding.contentsId !== contentsId) return;
    const share = this.service?.snapshot().remoteShares[binding.peerId];
    if (!share || this.signature(share) !== binding.share) {
      this.clear();
      return;
    }
    return binding.peerId;
  }
  snapshot(contentsId: number): RemoteControlServiceSnapshot {
    const peer = this.peer(contentsId),
      state = this.service?.snapshot();
    const result = empty();
    if (peer && state) {
      result.remoteShares[peer] = state.remoteShares[peer]!;
      if (state.outgoingRequests[peer])
        result.outgoingRequests[peer] = state.outgoingRequests[peer]!;
      if (state.remoteGrants[peer]) result.remoteGrants[peer] = state.remoteGrants[peer]!;
    }
    return result;
  }
  stop(contentsId: number) {
    if (this.binding?.contentsId !== contentsId) return;
    const peer = this.binding.peerId;
    this.service?.cancelRequest(peer);
    this.service?.stopControlling(peer);
  }
  stopSession(sessionId: string) {
    if (this.binding?.sessionId === sessionId) this.stop(this.binding.contentsId);
  }
  clear(contentsId?: number) {
    if (!this.binding || (contentsId !== undefined && this.binding.contentsId !== contentsId))
      return;
    const peer = this.binding.peerId;
    this.binding = undefined;
    this.service?.cancelRequest(peer);
    this.service?.stopControlling(peer);
  }
}
export const remoteControlViewerBinding = new RemoteControlViewerBinding();
