interface PeerKeyedState {
  keys(): IterableIterator<string>;
  delete(peerId: string): boolean;
}

/** Prune all member-scoped evidence, including state created before a Peer connection exists. */
export const retireDepartedPeerState = <Peer>(
  activePeerIds: ReadonlySet<string>,
  previousPeerIds: readonly string[],
  peers: Map<string, Peer>,
  stores: readonly PeerKeyedState[],
  onRetire: (peerId: string, peer: Peer | undefined) => void,
): void => {
  const knownPeerIds = new Set(previousPeerIds);
  for (const store of [peers, ...stores]) {
    for (const peerId of store.keys()) knownPeerIds.add(peerId);
  }
  for (const peerId of knownPeerIds) {
    if (activePeerIds.has(peerId)) continue;
    const peer = peers.get(peerId);
    peers.delete(peerId);
    for (const store of stores) store.delete(peerId);
    onRetire(peerId, peer);
  }
};
