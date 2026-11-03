import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History } from "lucide-react";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { VoiceReplayLibrary } from "./VoiceReplayLibrary";

/** Library access remains available after leaving the room; it never starts a capture. */
export function VoiceReplayLibraryButton() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  if (!window.desktopApi.voiceReplay) return null;
  return (
    <>
      <Button variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        <History size={14} />
        精彩片段
      </Button>
      {open &&
        createPortal(
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
            <VoiceReplayLibrary revision="library" />
          </dialog>,
          document.body,
        )}
    </>
  );
}
