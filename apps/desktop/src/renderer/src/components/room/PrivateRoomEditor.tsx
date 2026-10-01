import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Shuffle } from "lucide-react";
import {
  ROOM_ICON_IDS,
  isChannelCode,
  type PrivateRoomInfo,
  type RoomIconId,
  type RoomIconColor,
} from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAppStore } from "../../store/appStore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { PrivateRoomIcon } from "./PrivateRoomIcon";
import { PrivateRoomIconPicker } from "./PrivateRoomIconPicker";
import { PrivateRoomColorPicker } from "./PrivateRoomColorPicker";
import { roomIconStyle } from "./roomIconColors";
export const PrivateRoomEditor = ({
  room,
  defaultName,
  onClose,
  onSaved,
}: {
  room?: PrivateRoomInfo;
  defaultName: string;
  onClose: () => void;
  onSaved: (room: PrivateRoomInfo) => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const randomGeneration = useRef(0);
  const [name, setName] = useState(room?.name ?? `${defaultName}的房间`.slice(0, 32));
  const [icon, setIcon] = useState<RoomIconId>(
    room?.icon ?? ROOM_ICON_IDS[Math.floor(Math.random() * ROOM_ICON_IDS.length)]!,
  );
  const [code, setCode] = useState(room?.channelCode ?? "");
  const [iconColor, setIconColor] = useState<RoomIconColor>(room?.iconColor ?? "blue");
  const [busy, setBusy] = useState(false);
  const [randomBusy, setRandomBusy] = useState(false);
  const [error, setError] = useState("");
  const [availability, setAvailability] = useState<string>();
  const [checkingCode, setCheckingCode] = useState(false);
  const shuffle = async () => {
    const generation = ++randomGeneration.current;
    setRandomBusy(true);
    setError("");
    try {
      const result = await shanghaoCore.rooms.randomCode();
      if (generation === randomGeneration.current) setCode(result);
    } catch (error) {
      if (generation === randomGeneration.current) setError(privateRoomErrorMessage(error));
    } finally {
      if (generation === randomGeneration.current) setRandomBusy(false);
    }
  };
  useEffect(() => {
    const element = dialog.current;
    const counter = randomGeneration;
    element?.showModal();
    if (!room) void shuffle();
    return () => {
      counter.current++;
      element?.close();
    };
  }, [room]);
  useEffect(() => {
    if (room || !isChannelCode(code)) {
      setAvailability(undefined);
      setCheckingCode(false);
      return;
    }
    let cancelled = false;
    setCheckingCode(true);
    setAvailability(undefined);
    const timer = window.setTimeout(() => {
      void shanghaoCore.rooms
        .available(code)
        .then((available) => {
          if (!cancelled) setAvailability(available ? "可用" : "已被使用或正在冷却");
        })
        .catch((error) => {
          if (!cancelled) setError(privateRoomErrorMessage(error));
        })
        .finally(() => {
          if (!cancelled) setCheckingCode(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, room]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = room
        ? await shanghaoCore.rooms.update({ roomId: room.roomId, name, icon, iconColor })
        : await shanghaoCore.rooms.create({ name, icon, iconColor, channelCode: code });
      onSaved(result);
      if (iconColor !== "blue" && result.iconColor !== iconColor)
        useAppStore.getState().pushToast({
          tone: "warning",
          title: "房间已保存",
          description: "当前服务器尚不支持图标颜色，服务器更新后即可保存颜色。",
        });
    } catch (error) {
      setError(privateRoomErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="private-room-editor-title"
      style={{ background: "rgba(247, 251, 255, 0.98)" }}
      className="island-panel m-auto max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
    >
      <header className="mb-5 flex items-start justify-between gap-3 border-b border-slate-200/70 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-slate-200/60"
            style={roomIconStyle(iconColor)}
          >
            <PrivateRoomIcon icon={icon} className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 id="private-room-editor-title" className="text-balance text-lg font-semibold">
              {room ? "编辑房间" : "创建房间"}
            </h2>
            {room && (
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <LockKeyhole className="size-3" aria-hidden="true" />
                <span className="tabular-nums">频道 {room.channelCode} · 创建后固定</span>
              </p>
            )}
          </div>
        </div>
        <DialogCloseButton onClick={onClose} disabled={busy} label="关闭房间编辑" />
      </header>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-2 text-sm font-medium">
          房间名称
          <Input
            value={name}
            maxLength={32}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="给房间起个名字"
          />
        </label>
        {!room && (
          <label className="block space-y-2 text-sm font-medium">
            频道号
            <div className="flex gap-2">
              <Input
                value={code}
                aria-label="频道号"
                inputMode="numeric"
                maxLength={6}
                className="min-w-0 font-mono tabular-nums"
                disabled={busy || randomBusy}
                onChange={(event) => {
                  randomGeneration.current++;
                  setCode(event.target.value.replace(/\D/g, ""));
                  setError("");
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void shuffle()}
                disabled={busy || randomBusy}
                aria-label="随机可用频道号"
              >
                <Shuffle className="size-4" />
              </Button>
            </div>
            <span className="block text-xs text-slate-500" role="status">
              {checkingCode ? "检查中…" : (availability ?? "六位数字，可保留开头的 0")}
            </span>
          </label>
        )}
        <PrivateRoomIconPicker value={icon} disabled={busy} onChange={setIcon} />
        <PrivateRoomColorPicker value={iconColor} disabled={busy} onChange={setIconColor} />
        {error && (
          <p role="alert" className="text-pretty text-sm text-red-600">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={
            busy ||
            randomBusy ||
            !name.trim() ||
            !isChannelCode(code) ||
            (!room && availability === "已被使用或正在冷却")
          }
        >
          {busy ? "保存中…" : room ? "保存修改" : "创建房间"}
        </Button>
      </form>
    </dialog>
  );
};
