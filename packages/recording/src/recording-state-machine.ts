import { RecordingState, type RecordingStatusSnapshot } from "@private-voice/shared";

export class RecordingStateMachine {
  private snapshot: RecordingStatusSnapshot = {
    state: RecordingState.Idle,
    durationMs: 0,
  };

  getState(): RecordingStatusSnapshot {
    return this.snapshot;
  }

  transition(
    state: RecordingState,
    patch: Partial<Omit<RecordingStatusSnapshot, "state">> = {},
  ): RecordingStatusSnapshot {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      state,
    };

    return this.snapshot;
  }
}
