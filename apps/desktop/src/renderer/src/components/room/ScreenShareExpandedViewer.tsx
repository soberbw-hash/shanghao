import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Minimize2, X } from "lucide-react";

/** Presentation only: closing this viewer never stops or replaces the shared track. */
export const ScreenShareExpandedViewer = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialogRef}
      className="screen-share-expanded-viewer"
      aria-label="放大共享画面"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <strong>{title}</strong>
        <button type="button" aria-label="返回房间" onClick={onClose} autoFocus>
          <Minimize2 size={18} /> 返回房间
        </button>
        <button type="button" aria-label="关闭放大画面" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="screen-share-expanded-media">{children}</div>
    </dialog>,
    document.body,
  );
};
