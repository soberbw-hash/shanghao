import { useEffect, useRef, useState } from "react";
import type { PrivateRoomInfo, RoomMember, RoomBan } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { PrivateRoomEditor } from "./PrivateRoomEditor";
import { RoomMemoryPanel } from "./RoomMemoryPanel";
export const RoomManagementDialog = ({
  room,
  members,
  onClose,
}: {
  room: PrivateRoomInfo;
  members: RoomMember[];
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [bans, setBans] = useState<RoomBan[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<{ member: RoomMember; kind: "kick" | "ban" }>();
  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    void shanghaoCore.rooms
      .bans(room.roomId)
      .then((result) => {
        if (!cancelled) setBans(result);
      })
      .catch((error) => {
        if (!cancelled) setError(privateRoomErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [room.roomId]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      setAction(undefined);
    } catch (error) {
      setError(privateRoomErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="room-management-title"
      style={{ background: "rgba(247, 251, 255, 0.98)" }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      className="island-panel m-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
    >
      <header className="mb-4 flex items-center gap-3">
        <h2 id="room-management-title" className="min-w-0 flex-1 truncate text-lg font-semibold">
          {room.name}
        </h2>
        <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
          编辑
        </Button>
        <DialogCloseButton onClick={onClose} disabled={busy} label="关闭房间管理" />
      </header>
      <RoomMemoryPanel roomId={room.roomId} />
      <h3 className="mb-2 text-sm font-semibold">
        {members.length ? "在线成员" : "进入此房间后可管理在线成员"}
      </h3>
      <div className="space-y-2">
        {members
          .filter((member) => !member.isEmptySlot)
          .map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-xl border border-slate-200/80 p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{member.nickname}</span>
              {member.userId === room.ownerId ? (
                <span className="text-xs text-slate-500">房主</span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setAction({ member, kind: "kick" });
                    }}
                  >
                    移出
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || !member.userId}
                    onClick={() => {
                      setError("");
                      setAction({ member, kind: "ban" });
                    }}
                  >
                    封禁
                  </Button>
                </>
              )}
            </div>
          ))}
      </div>
      {action && (
        <section
          className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-3"
          role="group"
          aria-label="确认成员操作"
        >
          <p className="text-sm">
            {action.kind === "kick"
              ? `移出“${action.member.nickname}”？对方仍可重新加入。`
              : `封禁“${action.member.nickname}”？解除前无法再加入。`}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setAction(undefined)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (action.kind === "kick")
                    await shanghaoCore.rooms.kick(room.roomId, action.member.id);
                  else {
                    await shanghaoCore.rooms.ban(
                      room.roomId,
                      action.member.userId!,
                      action.member.nickname,
                    );
                    setBans(await shanghaoCore.rooms.bans(room.roomId));
                  }
                })
              }
            >
              确认{action.kind === "kick" ? "移出" : "封禁"}
            </Button>
          </div>
        </section>
      )}
      <h3 className="mb-2 mt-5 text-sm font-semibold">已封禁</h3>
      <div className="space-y-2">
        {bans.length ? (
          bans.map((ban) => (
            <div
              key={ban.userId}
              className="flex items-center gap-2 rounded-xl border border-slate-200/80 p-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">{ban.displayName}</span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await shanghaoCore.rooms.unban(room.roomId, ban.userId);
                    setBans((items) => items.filter((item) => item.userId !== ban.userId));
                  })
                }
              >
                解除封禁
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">暂无封禁成员</p>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
      {editing && (
        <PrivateRoomEditor
          room={room}
          defaultName="我的"
          onClose={() => setEditing(false)}
          onSaved={onClose}
        />
      )}
    </dialog>
  );
};
