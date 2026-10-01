import { useEffect, useRef } from "react";
import type { PrivateRoomInfo } from "@private-voice/shared";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { PrivateRoomBrowser } from "./PrivateRoomBrowser";

export const RoomSwitchDialog = ({
  busy,
  onJoin,
  onClose,
}: {
  busy: boolean;
  onJoin: (room: PrivateRoomInfo) => Promise<void>;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="room-switch-title"
      style={{ background: "rgba(247, 251, 255, 0.98)" }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      className="island-panel m-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 id="room-switch-title" className="text-lg font-semibold">
          选择房间
        </h2>
        <DialogCloseButton onClick={onClose} disabled={busy} label="关闭房间选择" />
      </header>
      <PrivateRoomBrowser busy={busy} onJoin={onJoin} />
    </dialog>
  );
};
