import type { MeshPeerConnection, RemoteControlTransportOptions } from "@private-voice/webrtc";

/** Carries only control data over the existing peer. No alternate signaling/media path. */
export class RoomRemoteControlBridge {
  private readonly stopOutgoing?: () => void;
  private readonly peerIds = new Set<string>();
  private disposed = false;
  constructor(private readonly peers: ReadonlyMap<string, MeshPeerConnection>) {
    this.stopOutgoing = window.desktopApi.remoteControl?.onOutgoing(({ peerId, message, lane }) => {
      const peer = this.peers.get(peerId);
      const result =
        lane === "pointer" && message.type === "input"
          ? peer?.sendRemotePointer(message.input)
          : peer?.sendRemoteControl(message);
      if (!result?.ok) window.desktopApi.remoteControl.peerCapability(peerId, false);
    });
  }
  handlers(peerId: string): RemoteControlTransportOptions | undefined {
    if (!window.desktopApi.remoteControl) return undefined;
    this.peerIds.add(peerId);
    return {
      onMessage: (sender, message, lane) => {
        if (!this.disposed && sender === peerId && this.peers.has(peerId))
          window.desktopApi.remoteControl.receive(peerId, message, lane);
      },
      onCapabilityChange: (sender, capability) => {
        if (!this.disposed && sender === peerId)
          window.desktopApi.remoteControl.peerCapability(peerId, capability.available);
      },
    };
  }
  dispose(): void {
    this.disposed = true;
    this.stopOutgoing?.();
    for (const id of this.peerIds) window.desktopApi.remoteControl?.peerCapability(id, false);
    this.peerIds.clear();
  }
}
