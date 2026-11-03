import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { History } from "lucide-react";
import type { RoomReplayClient } from "../../features/room/RoomReplayClient";
import type { useVoiceReplay } from "../../features/recording/useVoiceReplay";
import { useRoomStore } from "../../store/roomStore";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { VoiceReplayLibraryButton } from "./VoiceReplayLibraryButton";

export function VoiceReplayControl({
  transport,
  controller,
}: {
  transport?: RoomReplayClient;
  controller: ReturnType<typeof useVoiceReplay>;
}) {
  const replay = useRoomStore((state) => state.replay);
  const localId = useRoomStore((state) => state.room.members.find((member) => member.isLocal)?.id);
  const { save, status, setStatus, seconds, setSeconds } = controller;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const state = replay?.state;
  const approved = !!localId && !!state?.approved.includes(localId);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  const control = async (action: "start" | "approve" | "revoke" | "stop") => {
    if (operation.current || !transport) return;
    operation.current = true;
    setBusy(true);
    try {
      await transport.control(action, state);
      setStatus("");
    } catch {
      setStatus("未能同步回溯设置，请等待房间恢复连接。");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-pressed={!!state?.enabled}
        title={state?.enabled ? "全员已同意，正在缓冲最近一分钟" : "全员同意后，可保存刚才的对话"}
        onClick={() => setOpen(true)}
      >
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
            {!replay?.available && <p role="status">当前房间暂不可用，已保存片段仍可导出。</p>}
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
              <Button
                disabled={!state?.enabled || busy || !replay?.available}
                onClick={() => void save()}
              >
                保存片段
              </Button>
              <VoiceReplayLibraryButton />
            </div>
            {replay?.available && (
              <details className="voice-replay-consent" open={!state?.enabled}>
                <summary>
                  {state?.enabled
                    ? "原声缓冲已开启"
                    : state
                      ? `等待同意 · ${state.approved.length}/${state.members.length} 人`
                      : "启用原声保存"}
                </summary>
                {!state ? (
                  <>
                    <p>全员同意后，保留最近一分钟原声。</p>
                    <Button
                      disabled={busy}
                      title="邀请全员同意；声音暂存本机内存，离房或撤回即清空"
                      onClick={() => void control("start")}
                    >
                      开启原声缓冲
                    </Button>
                  </>
                ) : (
                  <div className="voice-replay-actions">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void control(approved ? "revoke" : "approve")}
                    >
                      {approved ? "停止保留我的声音" : "同意保留我的声音"}
                    </Button>
                  </div>
                )}
              </details>
            )}
            {status && <p role="status">{status}</p>}
          </dialog>,
          document.body,
        )}
    </>
  );
}
