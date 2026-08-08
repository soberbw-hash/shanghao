interface MixedSource {
  stream: MediaStream;
  trackId: string;
  node: MediaStreamAudioSourceNode;
}

export interface MixedCallStream {
  stream: MediaStream;
  sync: (localStream: MediaStream | undefined, remoteStreams: Record<string, MediaStream>) => void;
  dispose: () => void;
}

const LOCAL_SOURCE_KEY = "__local_microphone__";

/** Keeps the recording graph aligned with late joins, leaves and microphone changes. */
export const createMixedCallStream = (
  localStream: MediaStream | undefined,
  remoteStreams: Record<string, MediaStream>,
): MixedCallStream => {
  const audioContext = new AudioContext({ latencyHint: "playback", sampleRate: 48_000 });
  const destination = audioContext.createMediaStreamDestination();
  const sources = new Map<string, MixedSource>();
  let disposed = false;

  const sync = (
    nextLocalStream: MediaStream | undefined,
    nextRemoteStreams: Record<string, MediaStream>,
  ): void => {
    if (disposed) return;
    const requested = new Map<string, MediaStream>(Object.entries(nextRemoteStreams));
    if (nextLocalStream) requested.set(LOCAL_SOURCE_KEY, nextLocalStream);

    for (const [key, source] of sources) {
      const nextStream = requested.get(key);
      const nextTrackId = nextStream?.getAudioTracks()[0]?.id;
      if (!nextTrackId || nextTrackId !== source.trackId) {
        source.node.disconnect();
        sources.delete(key);
      }
    }

    for (const [key, stream] of requested) {
      const trackId = stream.getAudioTracks()[0]?.id;
      if (!trackId || sources.has(key)) continue;
      const node = audioContext.createMediaStreamSource(stream);
      node.connect(destination);
      sources.set(key, { stream, trackId, node });
    }
  };

  sync(localStream, remoteStreams);
  if (sources.size === 0) {
    void audioContext.close();
    throw new Error("当前房间里没有可用于录音的音频来源。");
  }

  void audioContext.resume().catch(() => undefined);

  return {
    stream: destination.stream,
    sync,
    dispose: () => {
      disposed = true;
      for (const source of sources.values()) source.node.disconnect();
      sources.clear();
      destination.disconnect();
      void audioContext.close();
    },
  };
};
