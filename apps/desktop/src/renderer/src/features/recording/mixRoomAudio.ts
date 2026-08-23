import {
  advanceRecordingLoudness,
  createRecordingLoudnessState,
  gainDbToLinear,
  isRecordingSpeechFrame,
  type RecordingLoudnessState,
} from "./recordingLoudnessBalance";

interface MixedSource {
  stream: MediaStream;
  trackId: string;
  node: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  segmentDestination: MediaStreamAudioDestinationNode;
  samples: Float32Array<ArrayBuffer>;
  loudness: RecordingLoudnessState;
  peak: number;
  speechFrames: number;
  identity: RecordingSourceIdentity;
  silenceFrames: number;
  capture?: ActiveSpeakerCapture;
  stopping?: Promise<void>;
  gainDbMinimum: number;
  gainDbMaximum: number;
  gainDbTotal: number;
  gainFrames: number;
  captureDisabled?: boolean;
}

interface ActiveSpeakerCapture {
  recorder: MediaRecorder;
  chunks: BlobPart[];
  startMs: number;
  identity: RecordingSourceIdentity;
}

export interface RecordingSourceIdentity {
  speakerId: string;
  displayNameSnapshot: string;
}

export interface MixedCallOptions {
  loudnessBalanceEnabled: boolean;
  sourceIdentities?: Record<string, RecordingSourceIdentity>;
  onDiagnostic?: (event: string, context: Record<string, unknown>) => void;
  persistSpeakerSegment?: (segment: {
    sessionId: string;
    buffer: ArrayBuffer;
    sourceMimeType: string;
    speakerId: string;
    displayNameSnapshot: string;
    startMs: number;
    endMs: number;
  }) => Promise<void>;
  finalizeSpeakerSegments?: (
    sessionId: string,
    recordingId: string,
    recordingFilePath: string,
  ) => Promise<void>;
}

export interface MixedCallStream {
  stream: MediaStream;
  sync: (
    localStream: MediaStream | undefined,
    remoteStreams: Record<string, MediaStream>,
    sourceIdentities?: Record<string, RecordingSourceIdentity>,
  ) => void;
  setLoudnessBalanceEnabled: (enabled: boolean) => void;
  finish: (recordingId: string, recordingFilePath: string) => Promise<void>;
  dispose: () => void;
}

export const LOCAL_RECORDING_SOURCE_KEY = "__local_microphone__";
const ANALYSIS_INTERVAL_MS = 100;
const SPEECH_HANGOVER_FRAMES = 6;
const MAX_SPEAKER_SEGMENT_MS = 30_000;

const preferredSegmentMimeType = (): string | undefined =>
  ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );

const measureFrame = (samples: Float32Array): { rms: number; peak: number } => {
  let energy = 0;
  let peak = 0;
  for (const sample of samples) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return { rms: Math.sqrt(energy / Math.max(1, samples.length)), peak };
};

/** Keeps the recording graph aligned with late joins, leaves and microphone changes. */
export const createMixedCallStream = (
  localStream: MediaStream | undefined,
  remoteStreams: Record<string, MediaStream>,
  options: MixedCallOptions,
): MixedCallStream => {
  const audioContext = new AudioContext({ latencyHint: "playback", sampleRate: 48_000 });
  const destination = audioContext.createMediaStreamDestination();
  destination.channelCount = 1;
  destination.channelCountMode = "explicit";
  const mixBus = audioContext.createGain();
  mixBus.channelCount = 1;
  mixBus.channelCountMode = "explicit";
  const overloadCompressor = audioContext.createDynamicsCompressor();
  overloadCompressor.threshold.value = -12;
  overloadCompressor.knee.value = 12;
  overloadCompressor.ratio.value = 1.8;
  overloadCompressor.attack.value = 0.012;
  overloadCompressor.release.value = 0.18;
  const samplePeakGuard = audioContext.createDynamicsCompressor();
  samplePeakGuard.threshold.value = -1.5;
  samplePeakGuard.knee.value = 0;
  samplePeakGuard.ratio.value = 20;
  samplePeakGuard.attack.value = 0.002;
  samplePeakGuard.release.value = 0.08;
  const outputAnalyser = audioContext.createAnalyser();
  outputAnalyser.fftSize = 1024;
  mixBus.connect(overloadCompressor);
  overloadCompressor.connect(samplePeakGuard);
  samplePeakGuard.connect(outputAnalyser);
  outputAnalyser.connect(destination);
  const sources = new Map<string, MixedSource>();
  let disposed = false;
  let loudnessBalanceEnabled = options.loudnessBalanceEnabled;
  let identities = options.sourceIdentities ?? {};
  let maximumOutputPeak = 0;
  let maximumCompressorReductionDb = 0;
  let maximumPeakGuardReductionDb = 0;
  let peakGuardTriggerCount = 0;
  const outputSamples = new Float32Array(outputAnalyser.fftSize);
  const sessionId = crypto.randomUUID();
  const sessionStartedAt = performance.now();
  const segmentMimeType = preferredSegmentMimeType();
  const pendingSegmentWrites = new Set<Promise<void>>();
  const pendingSegmentStops = new Set<Promise<void>>();
  const segmentStats = new Map<string, { count: number; durationMs: number }>();
  let overlappingSegmentStarts = 0;

  const elapsedMs = (): number => Math.max(0, Math.round(performance.now() - sessionStartedAt));

  const stopSpeakerCapture = (source: MixedSource, endMs = elapsedMs()): Promise<void> => {
    if (source.stopping) return source.stopping;
    const capture = source.capture;
    if (!capture) return Promise.resolve();
    source.capture = undefined;
    const stopped = new Promise<void>((resolve) => {
      capture.recorder.addEventListener(
        "stop",
        () => {
          const persist = (async () => {
            const blob = new Blob(capture.chunks, { type: capture.recorder.mimeType });
            if (blob.size === 0 || !options.persistSpeakerSegment) return;
            await options.persistSpeakerSegment({
              sessionId,
              buffer: await blob.arrayBuffer(),
              sourceMimeType: capture.recorder.mimeType,
              speakerId: capture.identity.speakerId,
              displayNameSnapshot: capture.identity.displayNameSnapshot,
              startMs: capture.startMs,
              endMs: Math.max(capture.startMs + 1, endMs),
            });
            const durationMs = Math.max(1, endMs - capture.startMs);
            const existing = segmentStats.get(capture.identity.speakerId) ?? {
              count: 0,
              durationMs: 0,
            };
            segmentStats.set(capture.identity.speakerId, {
              count: existing.count + 1,
              durationMs: existing.durationMs + durationMs,
            });
          })()
            .catch((error) => {
              options.onDiagnostic?.("recording_speaker_segment_save_failed", {
                speakerId: capture.identity.speakerId,
                startMs: capture.startMs,
                endMs,
                error: error instanceof Error ? error.message : "unknown_error",
              });
            })
            .finally(resolve);
          pendingSegmentWrites.add(persist);
          void persist.finally(() => pendingSegmentWrites.delete(persist));
        },
        { once: true },
      );
      if (capture.recorder.state !== "inactive") {
        capture.recorder.requestData();
        capture.recorder.stop();
      } else {
        resolve();
      }
    }).finally(() => {
      if (source.stopping === stopped) source.stopping = undefined;
      pendingSegmentStops.delete(stopped);
    });
    source.stopping = stopped;
    pendingSegmentStops.add(stopped);
    return stopped;
  };

  const startSpeakerCapture = (source: MixedSource): void => {
    if (
      !segmentMimeType ||
      !options.persistSpeakerSegment ||
      source.captureDisabled ||
      source.capture ||
      source.stopping
    ) {
      return;
    }
    try {
      const recorder = new MediaRecorder(source.segmentDestination.stream, {
        mimeType: segmentMimeType,
        audioBitsPerSecond: 64_000,
      });
      const capture: ActiveSpeakerCapture = {
        recorder,
        chunks: [],
        startMs: elapsedMs(),
        identity: { ...source.identity },
      };
      if ([...sources.values()].some((candidate) => candidate.capture)) {
        overlappingSegmentStarts += 1;
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) capture.chunks.push(event.data);
      };
      recorder.start(250);
      source.capture = capture;
    } catch (error) {
      source.captureDisabled = true;
      options.onDiagnostic?.("recording_speaker_segment_start_failed", {
        speakerId: source.identity.speakerId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  };

  const flushSpeakerSegments = async (): Promise<void> => {
    await Promise.all([...sources.values()].map((source) => stopSpeakerCapture(source)));
    await Promise.all([...pendingSegmentStops]);
    await Promise.all([...pendingSegmentWrites]);
  };

  const sync = (
    nextLocalStream: MediaStream | undefined,
    nextRemoteStreams: Record<string, MediaStream>,
    nextIdentities?: Record<string, RecordingSourceIdentity>,
  ): void => {
    if (disposed) return;
    if (nextIdentities) identities = nextIdentities;
    const requested = new Map<string, MediaStream>(Object.entries(nextRemoteStreams));
    if (nextLocalStream) requested.set(LOCAL_RECORDING_SOURCE_KEY, nextLocalStream);

    for (const [key, source] of sources) {
      const nextStream = requested.get(key);
      const nextTrackId = nextStream?.getAudioTracks()[0]?.id;
      if (!nextTrackId || nextTrackId !== source.trackId) {
        const stopped = stopSpeakerCapture(source);
        source.node.disconnect();
        source.analyser.disconnect();
        source.gain.disconnect();
        source.segmentDestination.disconnect();
        void stopped.finally(() =>
          source.segmentDestination.stream.getTracks().forEach((track) => track.stop()),
        );
        sources.delete(key);
      }
    }

    for (const [key, stream] of requested) {
      const trackId = stream.getAudioTracks()[0]?.id;
      if (!trackId || sources.has(key)) continue;
      const node = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.15;
      const gain = audioContext.createGain();
      const segmentDestination = audioContext.createMediaStreamDestination();
      segmentDestination.channelCount = 1;
      segmentDestination.channelCountMode = "explicit";
      node.connect(analyser);
      analyser.connect(gain);
      analyser.connect(segmentDestination);
      gain.connect(mixBus);
      sources.set(key, {
        stream,
        trackId,
        node,
        analyser,
        gain,
        segmentDestination,
        samples: new Float32Array(analyser.fftSize),
        loudness: createRecordingLoudnessState(),
        peak: 0,
        speechFrames: 0,
        identity: identities[key] ?? {
          speakerId: key,
          displayNameSnapshot: key === LOCAL_RECORDING_SOURCE_KEY ? "我" : "未知成员",
        },
        silenceFrames: 0,
        gainDbMinimum: 0,
        gainDbMaximum: 0,
        gainDbTotal: 0,
        gainFrames: 0,
      });
      options.onDiagnostic?.("recording_source_attached", {
        sourceKey: key,
        speakerId: identities[key]?.speakerId ?? key,
        displayNameSnapshot: identities[key]?.displayNameSnapshot,
      });
    }
    for (const [key, source] of sources) {
      const nextIdentity = identities[key];
      if (nextIdentity) source.identity = nextIdentity;
    }
  };

  sync(localStream, remoteStreams);
  if (sources.size === 0) {
    void audioContext.close();
    throw new Error("当前房间里没有可用于录音的音频来源。");
  }

  void audioContext.resume().catch(() => undefined);

  const analysisTimer = window.setInterval(() => {
    if (disposed) return;
    for (const source of sources.values()) {
      source.analyser.getFloatTimeDomainData(source.samples);
      const frame = measureFrame(source.samples);
      const speech = isRecordingSpeechFrame(frame);
      source.peak = Math.max(source.peak, frame.peak);
      if (speech) {
        source.speechFrames += 1;
        source.silenceFrames = 0;
        startSpeakerCapture(source);
      } else if (source.capture) {
        source.silenceFrames += 1;
        if (source.silenceFrames >= SPEECH_HANGOVER_FRAMES) {
          void stopSpeakerCapture(source);
        }
      }
      if (source.capture && elapsedMs() - source.capture.startMs >= MAX_SPEAKER_SEGMENT_MS) {
        void stopSpeakerCapture(source);
      }
      source.loudness = advanceRecordingLoudness(source.loudness, frame, loudnessBalanceEnabled);
      if (speech) {
        source.gainDbMinimum =
          source.gainFrames === 0
            ? source.loudness.gainDb
            : Math.min(source.gainDbMinimum, source.loudness.gainDb);
        source.gainDbMaximum =
          source.gainFrames === 0
            ? source.loudness.gainDb
            : Math.max(source.gainDbMaximum, source.loudness.gainDb);
        source.gainDbTotal += source.loudness.gainDb;
        source.gainFrames += 1;
      }
      const now = audioContext.currentTime;
      source.gain.gain.setTargetAtTime(
        loudnessBalanceEnabled ? gainDbToLinear(source.loudness.gainDb) : 1,
        now,
        source.loudness.gainDb > 0 ? 0.75 : 0.08,
      );
    }
    outputAnalyser.getFloatTimeDomainData(outputSamples);
    maximumOutputPeak = Math.max(maximumOutputPeak, measureFrame(outputSamples).peak);
    const compressorReductionDb = Math.abs(Math.min(0, overloadCompressor.reduction));
    const peakGuardReductionDb = Math.abs(Math.min(0, samplePeakGuard.reduction));
    maximumCompressorReductionDb = Math.max(maximumCompressorReductionDb, compressorReductionDb);
    maximumPeakGuardReductionDb = Math.max(maximumPeakGuardReductionDb, peakGuardReductionDb);
    if (peakGuardReductionDb >= 0.1) peakGuardTriggerCount += 1;
  }, ANALYSIS_INTERVAL_MS);

  return {
    stream: destination.stream,
    sync,
    setLoudnessBalanceEnabled: (enabled) => {
      loudnessBalanceEnabled = enabled;
    },
    finish: async (recordingId, recordingFilePath) => {
      await flushSpeakerSegments();
      await options.finalizeSpeakerSegments?.(sessionId, recordingId, recordingFilePath);
    },
    dispose: () => {
      disposed = true;
      window.clearInterval(analysisTimer);
      void flushSpeakerSegments();
      options.onDiagnostic?.("recording_mix_summary", {
        sourceCount: sources.size,
        loudnessBalanceEnabled,
        maximumOutputSamplePeak: Number(maximumOutputPeak.toFixed(4)),
        clippingDetected: maximumOutputPeak >= 0.999,
        outputHeadroomDb: 1.5,
        maximumCompressorReductionDb: Number(maximumCompressorReductionDb.toFixed(2)),
        maximumPeakGuardReductionDb: Number(maximumPeakGuardReductionDb.toFixed(2)),
        peakGuardTriggerCount,
        outputSampleRate: audioContext.sampleRate,
        outputChannels: destination.channelCount,
        outputCodec: "AAC 128 kbps",
        overlappingSegmentStarts,
        speakerSegmentStats: Object.fromEntries(segmentStats),
        sources: [...sources.entries()].map(([key, source]) => ({
          sourceKey: key,
          speakerId: identities[key]?.speakerId ?? key,
          displayNameSnapshot: identities[key]?.displayNameSnapshot,
          measuredSpeechDb: source.loudness.measuredSpeechDb,
          appliedGainDb: Number(source.loudness.gainDb.toFixed(2)),
          minimumGainDb: Number(source.gainDbMinimum.toFixed(2)),
          maximumGainDb: Number(source.gainDbMaximum.toFixed(2)),
          averageGainDb: Number((source.gainDbTotal / Math.max(1, source.gainFrames)).toFixed(2)),
          speechFrames: source.speechFrames,
          maximumSamplePeak: Number(source.peak.toFixed(4)),
        })),
      });
      for (const source of sources.values()) {
        source.node.disconnect();
        source.analyser.disconnect();
        source.gain.disconnect();
        source.segmentDestination.disconnect();
        void (source.stopping ?? Promise.resolve()).finally(() =>
          source.segmentDestination.stream.getTracks().forEach((track) => track.stop()),
        );
      }
      sources.clear();
      mixBus.disconnect();
      overloadCompressor.disconnect();
      samplePeakGuard.disconnect();
      outputAnalyser.disconnect();
      destination.disconnect();
      void audioContext.close();
    },
  };
};
