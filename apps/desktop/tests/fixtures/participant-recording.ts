import {
  createMixedCallStream,
  LOCAL_RECORDING_SOURCE_KEY,
} from "../../src/renderer/src/features/recording/mixRoomAudio";

async function run() {
  const generator = new AudioContext();
  await generator.resume();
  const makeSource = (frequency: number) => {
    const oscillator = generator.createOscillator();
    oscillator.frequency.value = frequency;
    const gain = generator.createGain();
    gain.gain.value = 0.1;
    const destination = generator.createMediaStreamDestination();
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    return { oscillator, stream: destination.stream };
  };
  const first = makeSource(440),
    second = makeSource(880),
    rejoined = makeSource(880);
  const tracks: Array<{
    userId: string;
    speakerId: string;
    startMs: number;
    endMs: number;
    audio: number[];
  }> = [];
  const failures: string[] = [];
  const identities = {
    [LOCAL_RECORDING_SOURCE_KEY]: {
      speakerId: "peer-a",
      userId: "account-a",
      displayNameSnapshot: "演示甲",
      roomId: "room-a",
    },
    "peer-b": {
      speakerId: "peer-b",
      userId: "account-b",
      displayNameSnapshot: "演示乙",
      roomId: "room-a",
    },
    "rejoined-b": {
      speakerId: "rejoined-b",
      userId: "account-b",
      displayNameSnapshot: "演示乙",
      roomId: "room-a",
    },
  };
  const mixed = createMixedCallStream(
    first.stream,
    { "peer-b": second.stream },
    {
      loudnessBalanceEnabled: false,
      sourceIdentities: identities,
      persistParticipantTrack: async (track) => {
        tracks.push({
          userId: track.userId,
          speakerId: track.speakerId,
          startMs: track.startMs,
          endMs: track.endMs,
          audio: Array.from(new Uint8Array(track.buffer)),
        });
      },
      persistSpeakerSegment: async () => {},
      onDiagnostic: (event) => {
        if (event.endsWith("_failed")) failures.push(event);
      },
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 650));
    mixed.sync(first.stream, { "rejoined-b": rejoined.stream }, identities);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await mixed.finish("isolated", "fixture.m4a");
    return { tracks, failures };
  } finally {
    mixed.dispose();
    for (const source of [first, second, rejoined]) {
      source.oscillator.stop();
      source.stream.getTracks().forEach((track) => track.stop());
    }
    await generator.close();
  }
}
Object.assign(window, { runParticipantRecordingProbe: run });
