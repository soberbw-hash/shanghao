export const createMixedCallStream = (
  localStream: MediaStream | undefined,
  remoteStreams: MediaStream[],
): { stream: MediaStream; dispose: () => void } => {
  const sources = [...remoteStreams];
  if (localStream) {
    sources.unshift(localStream);
  }

  if (sources.length === 0) {
    throw new Error("当前房间里没有可用于录音的音频来源。");
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
