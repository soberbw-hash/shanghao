import { useEffect, useMemo, useRef } from "react";

import { TARGET_SAMPLE_RATE } from "@private-voice/shared";
import { RecordingService } from "@private-voice/recording";
import { RecordingState } from "@private-voice/shared";

import { createMixedCallStream } from "../features/recording/mixRoomAudio";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { writeRendererLog } from "../utils/logger";

export const useRecordingController = () => {
  const localStream = useRoomStore((state) => state.localStream);
  const remoteStreamsByPeer = useRoomStore((state) => state.remoteStreams);
  const setStatus = useRecordingStore((state) => state.setStatus);
  const addHistory = useRecordingStore((state) => state.addHistory);
  const serviceRef = useRef<RecordingService | null>(null);
  const mixRef = useRef<ReturnType<typeof createMixedCallStream> | null>(null);

  useEffect(() => {
    mixRef.current?.sync(localStream, remoteStreamsByPeer);
  }, [localStream, remoteStreamsByPeer]);

  const recordingService = useMemo(() => {
    if (serviceRef.current) {
      return serviceRef.current;
    }

    serviceRef.current = new RecordingService({
      exporter: {
        exportRecording: (payload) => window.desktopApi.recording.export(payload),
      },
      onStateChange: (snapshot) => setStatus(snapshot),
      logger: (message, context) => {
        void writeRendererLog("recording", "info", message, context);
      },
    });

    return serviceRef.current;
  }, [setStatus]);

  const startRecording = () => {
    if (mixRef.current) return recordingService.getState();
    mixRef.current = createMixedCallStream(localStream, remoteStreamsByPeer);
    const status = recordingService.start(mixRef.current.stream);
    if (status.state !== RecordingState.Recording) {
      mixRef.current.dispose();
      mixRef.current = null;
    }
    setStatus(status);
    return status;
  };

  const stopRecording = async () => {
    try {
      const result = await recordingService.stop(
        {
          targetSampleRate: 44_100,
          targetFormat: "m4a-aac",
          channels: 1,
          includeMixedCallAudio: true,
        },
        TARGET_SAMPLE_RATE,
      );

      addHistory(result);
      setStatus(recordingService.getState());
      return result;
    } finally {
      mixRef.current?.dispose();
      mixRef.current = null;
    }
  };

  return {
    capability: recordingService.getCapability(),
    startRecording,
    stopRecording,
  };
};
