import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { isStoredRoomId, type VoiceMemoryRecord } from "@private-voice/shared";

/** Kept visible throughout the transcript → organization → upload workflow. */
export const RecordingUploadAction = ({
  record,
  disabled,
  onRecord,
  onError,
}: {
  record?: VoiceMemoryRecord;
  disabled: boolean;
  onRecord: (value: VoiceMemoryRecord) => void;
  onError: (message: string | undefined) => void;
}) => {
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const published = record?.organizationPublication?.status === "published";
  const ready =
    record?.phase === "ready" &&
    record.organization?.status === "completed" &&
    Boolean(record.organization.finalResult) &&
    isStoredRoomId(record.roomId);
  const upload = async () => {
    if (!record || busy.current || disabled || !ready || published) return;
    busy.current = true;
    setUploading(true);
    onError(undefined);
    try {
      const value = await window.desktopApi.ai.publishOrganization(record.recordingId);
      if (active.current) onRecord(value);
    } catch (error) {
      if (active.current)
        onError(error instanceof Error ? error.message : "recording_recap_publish_failed");
    } finally {
      busy.current = false;
      if (active.current) setUploading(false);
    }
  };
  return (
    <button
      type="button"
      className="voice-memory-quiet-action"
      disabled={disabled || uploading || published || !ready}
      title={
        ready
          ? `上传整理摘要到服务器，仅供「${record?.roomName ?? "录音所属房间"}」成员和每日总结使用。需进入对应房间。`
          : "先完成转录和内容整理，才能上传到服务器"
      }
      onClick={() => void upload()}
    >
      {published ? <Check aria-hidden="true" /> : <Upload aria-hidden="true" />}
      {published ? "已上传到服务器" : uploading ? "上传中…" : "上传到服务器"}
    </button>
  );
};
