import { useState } from "react";
import { LockKeyhole, UnlockKeyhole, RefreshCw } from "lucide-react";
import { useRoomStore } from "../../store/roomStore";
import { temporaryRoomMessage } from "../../features/room/temporaryRoomMessages";
import type { TemporaryRoomManageRequest } from "@private-voice/shared";

export function TemporaryRoomControls() {
  const descriptor = useRoomStore((state) => state.room.temporaryRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!descriptor) return null;
  const { room, peerId, contextId } = descriptor;
  const admin = room.adminMemberId === peerId;
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
        <p role="status" className="temporary-room-network-note text-sm text-amber-700">
          {temporaryRoomMessage(new Error(descriptor.connectionWarning))}
        </p>
      )}
      <details className="temporary-room-controls">
        <summary>
          {room.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}房间管理
        </summary>
        <div className="temporary-management-body">
          <strong>
            房间码 {room.code.slice(0, 4)} {room.code.slice(4)}
          </strong>
          {admin ? (
            <div className="temporary-management-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void manage({ contextId, expected: room, action: "lock", locked: !room.locked })
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
      </details>
    </>
  );
}
