import { ipcMain } from "electron";

import {
  IPC_CHANNELS,
  type RecordingParticipantTrackPayload,
  type RecordingParticipantTrackResponse,
  type RecordingParticipantTracksFinalizePayload,
  type RecordingSpeakerSegmentFinalizePayload,
  type RecordingSpeakerSegmentPayload,
  type RecordingSpeakerSegmentResponse,
} from "@private-voice/shared";

import {
  finalizeRecordingSpeakerSegments,
  saveRecordingSpeakerSegment,
} from "./recording-speaker-segments";
import {
  finalizeRecordingParticipantTracks,
  saveRecordingParticipantTrack,
} from "./recording-participant-tracks";

export const registerRecordingTrackIpcHandlers = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.recording.saveSpeakerSegment,
    async (
      _event,
      payload: RecordingSpeakerSegmentPayload,
    ): Promise<RecordingSpeakerSegmentResponse> => saveRecordingSpeakerSegment(payload),
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.finalizeSpeakerSegments,
    async (_event, payload: RecordingSpeakerSegmentFinalizePayload): Promise<void> => {
      await finalizeRecordingSpeakerSegments(payload);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.saveParticipantTrack,
    async (
      _event,
      payload: RecordingParticipantTrackPayload,
    ): Promise<RecordingParticipantTrackResponse> => saveRecordingParticipantTrack(payload),
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.finalizeParticipantTracks,
    async (_event, payload: RecordingParticipantTracksFinalizePayload): Promise<void> => {
      await finalizeRecordingParticipantTracks(payload);
    },
  );
};
