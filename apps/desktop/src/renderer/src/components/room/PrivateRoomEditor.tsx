import { useEffect, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import { cn } from "@private-voice/ui";
import {
  ROOM_ICON_IDS,
  isChannelCode,
  type PrivateRoomInfo,
  type RoomIconId,
} from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { PrivateRoomIcon, roomIconLabels } from "./PrivateRoomIcon";

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
        ? await shanghaoCore.rooms.update({ roomId: room.roomId, name, icon })
        : await shanghaoCore.rooms.create({ name, icon, channelCode: code });
      onSaved(result);
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
      className="island-panel m-auto w-full max-w-md rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 id="private-room-editor-title" className="text-balance text-lg font-semibold">
          {room ? "编辑房间" : "创建房间"}
        </h2>
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
        <label className="block space-y-2 text-sm font-medium">
          频道号
          <div className="flex gap-2">
            <Input
              value={code}
              aria-label="频道号"
              inputMode="numeric"
              maxLength={6}
              readOnly={Boolean(room)}
              className="min-w-0 font-mono tabular-nums"
              disabled={busy || randomBusy}
              onChange={(event) => {
                randomGeneration.current++;
                setCode(event.target.value.replace(/\D/g, ""));
                setError("");
              }}
            />
            {!room && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => void shuffle()}
                disabled={busy || randomBusy}
                aria-label="随机可用频道号"
              >
                <Shuffle className="size-4" />
              </Button>
            )}
          </div>
          <span className="block text-xs text-slate-500" role="status">
            {room
              ? "创建后不变"
              : checkingCode
                ? "检查中…"
                : (availability ?? "六位数字，可保留开头的 0")}
          </span>
        </label>
        <fieldset disabled={busy}>
          <legend className="mb-2 text-sm font-medium">房间图标</legend>
          <div className="grid grid-cols-5 gap-2">
            {ROOM_ICON_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={roomIconLabels[id]}
                aria-pressed={icon === id}
                title={roomIconLabels[id]}
                onClick={() => setIcon(id)}
                className={cn(
                  "flex h-11 items-center justify-center rounded-xl border",
                  icon === id
                    ? "border-blue-300 bg-blue-50 text-blue-600"
                    : "border-slate-200 bg-white/60 text-slate-500",
                )}
              >
                <PrivateRoomIcon icon={id} />
              </button>
            ))}
          </div>
        </fieldset>
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
          {busy ? "保存中…" : room ? "保存" : "创建房间"}
        </Button>
      </form>
    </dialog>
  );
};
