import { useCallback, useEffect, useMemo } from "react";

import { TARGET_SAMPLE_RATE, type RecordingResult } from "@private-voice/shared";
import { RecordingService } from "@private-voice/recording";
import { RecordingState } from "@private-voice/shared";

import {
  createMixedCallStream,
  LOCAL_RECORDING_SOURCE_KEY,
  type RecordingSourceIdentity,
} from "../features/recording/mixRoomAudio";
import { getRemoteAudioMixer } from "../features/audio/RemoteAudioMixer";
import { createRecordingTopologyGuard } from "../features/recording/recordingTopology";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { writeRendererLog } from "../utils/logger";

type MixedCallStream = ReturnType<typeof createMixedCallStream>;

interface RecordingRuntime {
  service: RecordingService;
  mix: MixedCallStream | null;
  finalizing?: Promise<RecordingResult>;
  roomName?: string;
  roomId?: string;
}

const RECORDING_RUNTIME_KEY = "__shanghaoRecordingRuntimeV2__";

const getRecordingRuntime = (): RecordingRuntime => {
  const host = globalThis as typeof globalThis & {
    [RECORDING_RUNTIME_KEY]?: RecordingRuntime;
  };
  const existing = host[RECORDING_RUNTIME_KEY];
  if (existing) return existing;

  const runtime: RecordingRuntime = {
    mix: null,
    service: new RecordingService({
      exporter: {
        exportRecording: (payload) => {
          const roomLabel = (runtime.roomName || "房间")
            .replace(/[<>:"/\\|?*]/g, "-")
            .split("")
            .map((char) => (char.charCodeAt(0) < 32 ? "-" : char))
            .join("")
            .slice(0, 32);
          const now = new Date();
          const stamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0"),
          ].join("-");
          return window.desktopApi.recording.export({
            ...payload,
            suggestedFileName: `上号-${roomLabel}-${stamp}.m4a`,
          });
        },
      },
      streamingExporter: {
        startSession: (payload) => window.desktopApi.recording.startSession(payload),
        appendChunk: (sessionId, buffer) =>
          window.desktopApi.recording.appendChunk(sessionId, buffer),
        finalizeSession: (payload) => window.desktopApi.recording.finalizeSession(payload),
        sealSession: (sessionId) => window.desktopApi.recording.sealSession(sessionId),
        abortSession: (sessionId) => window.desktopApi.recording.abortSession(sessionId),
      },
      onStateChange: (snapshot) => useRecordingStore.getState().setStatus(snapshot),
      logger: (message, context) => {
        void writeRendererLog("recording", "info", message, context);
      },
    }),
  };
  host[RECORDING_RUNTIME_KEY] = runtime;
  return runtime;
};

const recordingSourceIdentities = (): Record<string, RecordingSourceIdentity> => {
  const { room } = useRoomStore.getState();
  const identities: Record<string, RecordingSourceIdentity> = {};
  for (const member of room.members) {
    if (member.isEmptySlot) continue;
    const key = member.isLocal ? LOCAL_RECORDING_SOURCE_KEY : member.id;
    identities[key] = {
      speakerId: member.id,
      displayNameSnapshot: member.nickname,
      userId: member.userId ?? member.id,
      avatarId: member.avatarId,
      roomId: room.roomId,
      joinedAt: member.joinedAt,
    };
  }
  return identities;
};

export const useRecordingController = () => {
  const setStatus = useRecordingStore((state) => state.setStatus);
  const addHistory = useRecordingStore((state) => state.addHistory);
  const runtime = useMemo(getRecordingRuntime, []);
  const recordingService = runtime.service;

  useEffect(() => {
    const changed = createRecordingTopologyGuard();
    let removeMediaListeners = () => {};
    const sync = () => {
      const state = useRoomStore.getState();
      if (!changed(state)) return;
      removeMediaListeners();
      const streams = new Set(
        [state.localStream, ...Object.values(state.remoteStreams)].filter(
          (stream): stream is MediaStream => Boolean(stream),
        ),
      );
      const cleanup: Array<() => void> = [];
      for (const stream of streams) {
        for (const event of ["addtrack", "removetrack"]) {
          stream.addEventListener(event, sync);
          cleanup.push(() => stream.removeEventListener(event, sync));
        }
        for (const track of stream.getAudioTracks()) {
          track.addEventListener("ended", sync);
          cleanup.push(() => track.removeEventListener("ended", sync));
        }
      }
      removeMediaListeners = () => cleanup.forEach((remove) => remove());
      runtime.mix?.sync(state.localStream, state.remoteStreams, recordingSourceIdentities());
    };
    sync();
    const unsubscribe = useRoomStore.subscribe(sync);
    return () => {
      unsubscribe();
      removeMediaListeners();
    };
  }, [runtime]);

  useEffect(() => {
    // This is part of the recording pipeline, not a user preference. Reassert it for a
    // recording runtime retained across renderer hot reloads as well as for new sessions.
    runtime.mix?.setLoudnessBalanceEnabled(true);
  }, [runtime]);

  useEffect(() => {
    const storedStatus = useRecordingStore.getState().status;
    if (recordingService.hasRecording()) {
      setStatus(recordingService.getState());
      return;
    }

    if (storedStatus.state === RecordingState.Recording) {
      setStatus({
        state: RecordingState.Idle,
        durationMs: 0,
        message: "上一次录音会话已中断，请重新开始录音。",
      });
      void writeRendererLog("recording", "warn", "recording_runtime_state_reconciled", {
        storedState: storedStatus.state,
      });
    }
  }, [recordingService, setStatus]);

  const startRecording = useCallback(() => {
    const currentState = recordingService.getState().state;
    if (
      runtime.finalizing ||
      recordingService.hasRecording() ||
      currentState === RecordingState.Stopping ||
      currentState === RecordingState.Saving
    ) {
      const status = recordingService.getState();
      setStatus(status);
      return status;
    }

    runtime.mix?.dispose();
    const roomState = useRoomStore.getState();
    runtime.roomId = roomState.room.roomId;
    runtime.roomName = roomState.room.roomName;
    runtime.mix = createMixedCallStream(roomState.localStream, roomState.remoteStreams, {
      loudnessBalanceEnabled: true,
      finalRemotePlaybackStream: getRemoteAudioMixer().getFinalOutputStream(),
      sourceIdentities: recordingSourceIdentities(),
      onDiagnostic: (event, context) => {
        void writeRendererLog("recording", "info", event, context);
      },
      persistSpeakerSegment: async (segment) => {
        const response = await window.desktopApi.recording.saveSpeakerSegment(segment);
        if (!response.ok) {
          throw new Error(response.errorMessage ?? "speaker_segment_save_failed");
        }
      },
      persistParticipantTrack: async (track) => {
        const response = await window.desktopApi.recording.saveParticipantTrack(track);
        if (!response.ok) {
          throw new Error(response.errorMessage ?? "participant_track_save_failed");
        }
      },
      finalizeSpeakerSegments: async (sessionId, recordingId, recordingFilePath) => {
        await window.desktopApi.recording.finalizeSpeakerSegments({
          sessionId,
          recordingId,
          recordingFilePath,
        });
      },
      finalizeParticipantTracks: async (sessionId, recordingId, recordingFilePath) => {
        await window.desktopApi.recording.finalizeParticipantTracks({
          sessionId,
          recordingId,
          recordingFilePath,
        });
      },
    });
    const status = recordingService.start(runtime.mix.stream);
    if (status.state !== RecordingState.Recording) {
      runtime.mix.dispose();
      runtime.mix = null;
    }
    setStatus(status);
    return status;
  }, [recordingService, runtime, setStatus]);

  const stopRecording = useCallback((): Promise<RecordingResult> => {
    if (runtime.finalizing) return runtime.finalizing;
    const mix = runtime.mix;
    const operation = (async () => {
      try {
        const result = await recordingService.stop(
          {
            targetSampleRate: 48_000,
            targetFormat: "m4a-aac",
            channels: 1,
            includeMixedCallAudio: true,
          },
          TARGET_SAMPLE_RATE,
        );

        if (result.recordingId) {
          await mix?.finish(result.recordingId, result.filePath).catch((error) => {
            void writeRendererLog(
              "recording",
              "error",
              "recording_speaker_segments_finalize_failed",
              {
                recordingId: result.recordingId,
                error: error instanceof Error ? error.message : "unknown_error",
              },
            );
          });
        }

        addHistory(result);
        setStatus(recordingService.getState());
        return result;
      } finally {
        mix?.dispose();
        if (runtime.mix === mix) runtime.mix = null;
      }
    })();
    runtime.finalizing = operation;
    void operation.then(
      () => {
        if (runtime.finalizing === operation) runtime.finalizing = undefined;
      },
      () => {
        if (runtime.finalizing === operation) runtime.finalizing = undefined;
      },
    );
    return operation;
  }, [addHistory, recordingService, runtime, setStatus]);

  const discardRecording = useCallback(async () => {
    if (runtime.finalizing) return;
    const currentState = recordingService.getState().state;
    if (currentState === RecordingState.Stopping || currentState === RecordingState.Saving) return;
    const mix = runtime.mix;
    try {
      await recordingService.discard();
      setStatus(recordingService.getState());
    } finally {
      mix?.dispose();
      if (runtime.mix === mix) runtime.mix = null;
    }
  }, [recordingService, runtime, setStatus]);

  return {
    capability: recordingService.getCapability(),
    startRecording,
    stopRecording,
    discardRecording,
  };
};
