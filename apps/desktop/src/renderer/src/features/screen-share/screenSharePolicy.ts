export const SCREEN_FALLBACK_TARGET_FPS = 24;

/** Small transport-independent state holder for the sharer's current audience. */
export class ScreenShareViewerTracker {
  private readonly peerIds = new Set<string>();

  setActive(peerId: string, active: boolean): boolean {
    const hadPeer = this.peerIds.has(peerId);
    if (active) this.peerIds.add(peerId);
    else this.peerIds.delete(peerId);
    return hadPeer !== active;
  }

  clear(): boolean {
    if (this.peerIds.size === 0) return false;
    this.peerIds.clear();
    return true;
  }

  snapshot(): string[] {
    return [...this.peerIds].sort();
  }
}
