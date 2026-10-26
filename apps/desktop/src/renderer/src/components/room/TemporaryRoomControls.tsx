import { useEffect, useRef, useState } from "react";
import "./TemporaryRoomDialogs.css";
import { LockKeyhole, UnlockKeyhole, RefreshCw, Copy } from "lucide-react";
import { useRoomStore } from "../../store/roomStore";
import { temporaryRoomMessage } from "../../features/room/temporaryRoomMessages";
import type { TemporaryRoomManageRequest } from "@private-voice/shared";
import { DialogCloseButton } from "../base/DialogCloseButton";

export function TemporaryRoomControls() {
  const descriptor = useRoomStore((state) => state.room.temporaryRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!opened) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [opened]);
  if (!descriptor) return null;
  const { room, peerId, contextId } = descriptor;
  const admin = room.adminMemberId === peerId;
  const copyCode = async () => {
    try {
      await window.desktopApi.clipboard.writeText(room.code);
      setCopiedCode(room.code);
    } catch {
      setError("复制失败，请手动复制房间码。");
    }
  };
  const manage = async (action: TemporaryRoomManageRequest) => {
    setBusy(true);
    setError("");
    try {
      const updated = await window.desktopApi.temporaryRooms.manage(action);
      const current = useRoomStore.getState().room.temporaryRoom;
      if (
        current?.contextId === contextId &&
        (updated.epoch > current.room.epoch ||
          (updated.epoch === current.room.epoch && updated.revision >= current.room.revision))
      )
        useRoomStore.getState().setRoom({
          temporaryRoom: { ...current, room: updated },
          roomName: `临时联机 · ${updated.code.slice(0, 4)} ${updated.code.slice(4)}`,
        });
    } catch (cause) {
      setError(temporaryRoomMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {descriptor.connectionWarning && (
        <span
          role="status"
          className="temporary-room-network-note text-xs text-amber-700"
          title={temporaryRoomMessage(new Error(descriptor.connectionWarning))}
        >
          仅局域网可用
        </span>
      )}
      <button
        type="button"
        className="temporary-room-code"
        title="复制房间码，发给朋友后在临时联机中加入"
        onClick={() => void copyCode()}
      >
        <Copy size={13} />
        {room.code.slice(0, 4)} {room.code.slice(4)}
        {copiedCode === room.code ? " · 已复制" : ""}
      </button>
      <div className="temporary-room-controls">
        <button
          type="button"
          className="temporary-management-trigger"
          onClick={() => {
            setOpened(true);
            setError("");
          }}
        >
          {room.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}房间管理
        </button>
        {opened && (
          <dialog
            ref={dialog}
            className="temporary-management-dialog"
            aria-labelledby="temporary-management-title"
            onCancel={(event) => {
              if (busy) event.preventDefault();
              else setOpened(false);
            }}
          >
            <header className="temporary-dialog-header">
              <h2 id="temporary-management-title">临时房间</h2>
              <DialogCloseButton
                disabled={busy}
                onClick={() => setOpened(false)}
                label="关闭临时房间管理"
              />
            </header>
            <div className="temporary-management-body">
              <button
                type="button"
                className="temporary-room-code temporary-room-code-large"
                onClick={() => void copyCode()}
              >
                <strong>
                  {room.code.slice(0, 4)} {room.code.slice(4)}
                </strong>
                <Copy size={16} />
                {copiedCode === room.code ? "已复制" : "复制房间码"}
              </button>
              <p className="temporary-invite-hint">
                朋友打开「临时联机 → 加入房间」，输入此码即可加入。
                {descriptor.connectionWarning ? "当前请连接同一局域网。" : ""}
              </p>
              {admin ? (
                <div className="temporary-management-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void manage({
                        contextId,
                        expected: room,
                        action: "lock",
                        locked: !room.locked,
                      })
                    }
                  >
                    {room.locked ? "允许加入" : "锁定房间"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void manage({ contextId, expected: room, action: "rotate" })}
                  >
                    <RefreshCw size={13} />
                    更换房间码
                  </button>
                </div>
              ) : (
                <small>{room.locked ? "当前房间已锁定" : "房主可锁定房间或移出成员"}</small>
              )}
              <ul>
                {room.members.map((member) => (
                  <li key={member.memberId}>
                    <span>
                      {member.profile.nickname}
                      {member.memberId === room.adminMemberId ? " · 房主" : ""}
                      {member.state === "disconnected-grace" ? " · 重连中" : ""}
                    </span>
                    {admin && member.memberId !== peerId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void manage({
                            contextId,
                            expected: room,
                            action: "kick",
                            memberId: member.memberId,
                          })
                        }
                      >
                        移出
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {error && <p role="alert">{error}</p>}
            </div>
          </dialog>
        )}
      </div>
    </>
  );
}
