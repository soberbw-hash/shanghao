import { ArrowRight, FileText, Headphones, X } from "lucide-react";
import replayArt from "../../assets/notices/voice-replay.jpg";
import transcriptArt from "../../assets/notices/transcription.jpg";
import type { ToastMessage } from "../../store/appStore";
import "./recording-notice.css";

export function RecordingNoticeCard({
  toast,
  dismiss,
}: {
  toast: ToastMessage;
  dismiss: () => void;
}) {
  const replay = toast.cardKind === "voice-replay";
  const Icon = replay ? Headphones : FileText;
  return (
    <article className="recording-notice" data-kind={toast.cardKind} role="status">
      <header>
        <Icon size={16} aria-hidden="true" />
        <strong>上号</strong>
        <span>{replay ? "语音回溯" : "转录完成"}</span>
        <button type="button" onClick={dismiss} aria-label="关闭通知">
          <X size={16} />
        </button>
      </header>
      <img className="recording-notice-art" alt="" src={replay ? replayArt : transcriptArt} />
      <div className="recording-notice-copy">
        <h3>{toast.title}</h3>
        <p>{toast.description}</p>
        <button
          type="button"
          onClick={() => {
            dismiss();
            toast.onAction?.();
          }}
        >
          {toast.actionLabel}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
