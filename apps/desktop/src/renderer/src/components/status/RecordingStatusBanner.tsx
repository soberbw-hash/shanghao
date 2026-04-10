import { RecordingState } from "@private-voice/shared";

import { RecordingIndicator } from "../audio/RecordingIndicator";
import { RecordingTimer } from "../audio/RecordingTimer";
import { InlineBanner } from "../layout/InlineBanner";
import { getRecordingStateLabel } from "../../utils/labels";

export const RecordingStatusBanner = ({
  state,
  durationMs,
  message,
  startedAt,
}: {
  state: RecordingState;
  durationMs: number;
  message?: string;
  startedAt?: number;
}) => (
  <InlineBanner tone={state === RecordingState.Failed ? "danger" : "neutral"}>
    <div className="flex flex-wrap items-center gap-3">
      <RecordingIndicator isVisible={state === RecordingState.Recording} />
      <RecordingTimer durationMs={durationMs} startedAt={startedAt} />
      <span>{message || getRecordingStateLabel(state)}</span>
    </div>
  </InlineBanner>
);
