import type { createSpeakingDetector } from "@private-voice/webrtc";
import type { ProcessedMicrophoneStream } from "../audio/microphoneProcessor";
import type { RoomClient } from "./roomClient";
import type { RoomSessionOwnership } from "./sessionOwnership";

export interface RoomRuntimeHotState {
  activeClient: RoomClient | null;
  activeClientRef?: { current: RoomClient | null };
  activePeerId?: string;
  activeJoinPromise: Promise<void> | null;
  activeSpeakingDetector: ReturnType<typeof createSpeakingDetector> | null;
  activeProcessedMicrophone: ProcessedMicrophoneStream | null;
  activeInputSourceId?: string;
  inputDeviceSwitchQueue: Promise<unknown>;
  activeLeavePromise?: Promise<void>;
  roomSessionOwnership: RoomSessionOwnership;
  lastQuickMessageSentAt: number;
  lastQuickMessageCooldownMs: number;
}

/** Share the live cell, not a snapshot, with async work from the previous module. */
export const restoreRoomClientRef = (previous?: RoomRuntimeHotState) =>
  previous?.activeClientRef ?? { current: previous?.activeClient ?? null };

/** Visual HMR must not orphan live connections or recorders. Production has no HMR. */
export const retainRoomRuntime = (hot: ImportMeta["hot"], snapshot: () => RoomRuntimeHotState) => {
  hot?.dispose((data) => {
    data.roomRuntime = snapshot();
  });
};
