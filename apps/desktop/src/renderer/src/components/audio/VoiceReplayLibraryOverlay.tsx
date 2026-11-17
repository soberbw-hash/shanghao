import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { VoiceReplayLibrary } from "./VoiceReplayLibrary";

/** App-wide target for content-card actions, including when the room dialog is closed. */
export function VoiceReplayLibraryOverlay() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const requestOpen = () => setOpen(true);
    window.addEventListener("shanghao:open-voice-replay-library", requestOpen);
    return () => window.removeEventListener("shanghao:open-voice-replay-library", requestOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="voice-replay-dialog"
      aria-label="本机精彩片段"
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
    >
      <header>
        <div>
          <h2>精彩片段</h2>
          <p>保存的语音回溯，仅存本机。</p>
        </div>
        <DialogCloseButton label="关闭精彩片段" onClick={() => setOpen(false)} />
      </header>
      <VoiceReplayLibrary revision="global-library" />
    </dialog>,
    document.body,
  );
}
