import { useState } from "react";
import { Pencil } from "lucide-react";
import type { PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { Input } from "../base/Input";
import { PrivateRoomIcon } from "./PrivateRoomIcon";
import { PrivateRoomIconPicker } from "./PrivateRoomIconPicker";

/** Owns the inline room name and portrait editing state. */
export function RoomManagementIdentity({
  room,
  busy,
  run,
  onChange,
  onClose,
}: {
  room: PrivateRoomInfo;
  busy: boolean;
  run: (operation: () => Promise<void>) => Promise<void>;
  onChange: (room: PrivateRoomInfo) => void;
  onClose: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(room.name);
  const [choosingIcon, setChoosingIcon] = useState(false);
  return (
    <>
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          className="size-11 shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-blue-500"
          disabled={busy}
          aria-label="更换房间头像"
          aria-expanded={choosingIcon}
          onClick={() => setChoosingIcon((value) => !value)}
        >
          <PrivateRoomIcon icon={room.icon} className="size-full" />
        </button>
        {editingName ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) return;
              void run(async () => {
                const updated = await shanghaoCore.rooms.update({
                  roomId: room.roomId,
                  name: next,
                  icon: room.icon,
                  iconColor: room.iconColor,
                });
                onChange(updated);
                setName(updated.name);
                setEditingName(false);
              });
            }}
          >
            <Input
              aria-label="房间名称"
              value={name}
              maxLength={32}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <Button type="submit" disabled={busy || !name.trim()}>
              保存
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setName(room.name);
                setEditingName(false);
              }}
            >
              取消
            </Button>
          </form>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="min-w-0 truncate text-lg font-semibold">{room.name}</h2>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="修改房间名称"
              title="修改房间名称"
              disabled={busy}
              onClick={() => setEditingName(true)}
            >
              <Pencil size={16} />
            </button>
          </div>
        )}
        <DialogCloseButton onClick={onClose} disabled={busy} label="关闭房间管理" />
      </header>
      {choosingIcon && (
        <div className="mb-4">
          <PrivateRoomIconPicker
            value={room.icon}
            disabled={busy}
            onChange={(icon) => {
              if (icon === room.icon) {
                setChoosingIcon(false);
                return;
              }
              void run(async () => {
                const updated = await shanghaoCore.rooms.update({
                  roomId: room.roomId,
                  name: room.name,
                  icon,
                  iconColor: room.iconColor,
                });
                onChange(updated);
                setChoosingIcon(false);
              });
            }}
          />
        </div>
      )}
    </>
  );
}
