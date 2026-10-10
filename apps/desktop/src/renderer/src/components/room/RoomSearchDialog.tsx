import { useEffect, useRef, type ReactNode } from "react";
import { DialogCloseButton } from "../base/DialogCloseButton";

export const RoomSearchDialog = ({
  children,
  busy,
  onClose,
}: {
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="private-room-search-title"
      className="island-panel m-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
      style={{ background: "rgba(247, 251, 255, 0.98)" }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 id="private-room-search-title" className="text-balance text-xl font-semibold">
          查找房间
        </h2>
        <DialogCloseButton onClick={onClose} disabled={busy} label="关闭房间查找" />
      </header>
      {children}
    </dialog>
  );
};
