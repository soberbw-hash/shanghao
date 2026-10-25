import type { VoiceMemoryRecord } from "@private-voice/shared";
import { CloudLocalAssistAction } from "./HybridTranscriptionNotice";

export const TranscriptionTimingNotice = ({ record }: { record: VoiceMemoryRecord }) => (
  <>
    <CloudLocalAssistAction key={record.recordingId} record={record} />
  </>
);
