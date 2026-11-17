import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History } from "lucide-react";
import type { useVoiceReplay } from "../../features/recording/useVoiceReplay";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { VoiceReplayLibraryButton } from "./VoiceReplayLibraryButton";

export function VoiceReplayControl({
  controller,
}: {
  controller: ReturnType<typeof useVoiceReplay>;
}) {
  const { save, start, stop, enabled, status, seconds, setSeconds } = controller;
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  return (
    <>
      <button type="button" title="保存刚才的对话或调整回溯设置" onClick={() => setOpen(true)}>
        <History size={14} />
        <span>保存刚才对话</span>
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="voice-replay-dialog"
            aria-labelledby={titleId}
            onCancel={(event) => {
              event.preventDefault();
              setOpen(false);
            }}
            onClick={(event) => {
              if (event.target === dialog.current) {
                const rect = dialog.current.getBoundingClientRect();
                if (
                  event.clientX < rect.left ||
                  event.clientX > rect.right ||
                  event.clientY < rect.top ||
                  event.clientY > rect.bottom
                )
                  setOpen(false);
              }
            }}
          >
            <header>
              <h2 id={titleId}>保存刚才对话</h2>
              <DialogCloseButton label="关闭语音回溯" onClick={() => setOpen(false)} />
            </header>
            <div className="voice-replay-actions">
              <select
                aria-label="保存最近多久"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value) as 15 | 30 | 60)}
              >
                <option value={15}>15 秒</option>
                <option value={30}>30 秒</option>
                <option value={60}>60 秒</option>
              </select>
              <Button disabled={!enabled} onClick={() => void save()}>
                保存片段
              </Button>
              <VoiceReplayLibraryButton />
            </div>
            <details className="voice-replay-local-buffer" open={!enabled}>
              <summary>{enabled ? "本机原声缓冲已开启" : "本机原声缓冲未开启"}</summary>
              {enabled ? (
                <>
                  <p>进房后自动缓冲最近一分钟，仅保存在本机内存；离开房间时清空。</p>
                  <Button variant="ghost" onClick={stop}>
                    停止本机缓冲
                  </Button>
                </>
              ) : (
                <>
                  <p>开启后，仅此设备在内存中缓冲最近一分钟；离开房间或停止时会清空。</p>
                  <Button onClick={start}>开启本机原声缓冲</Button>
                </>
              )}
            </details>
            {status && <p role="status">{status}</p>}
          </dialog>,
          document.body,
        )}
    </>
  );
}
