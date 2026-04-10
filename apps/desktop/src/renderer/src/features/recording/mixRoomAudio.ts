export const createMixedCallStream = (
  localStream: MediaStream | undefined,
  remoteStreams: MediaStream[],
): { stream: MediaStream; dispose: () => void } => {
  const sources = [...remoteStreams];
  if (localStream) {
    sources.unshift(localStream);
  }

  if (sources.length === 0) {
    throw new Error("No room audio sources are available for recording.");
  }

  const audioContext = new AudioContext({ sampleRate: 44_100 });
  const destination = audioContext.createMediaStreamDestination();

  const connectedSources = sources.map((stream) => {
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(destination);
    return source;
  });

  return {
    stream: destination.stream,
    dispose: () => {
      connectedSources.forEach((source) => source.disconnect());
      destination.disconnect();
      void audioContext.close();
    },
  };
};
