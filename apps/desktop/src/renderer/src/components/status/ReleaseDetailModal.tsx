import { useEffect, useRef } from "react";
import type { ReleaseHistoryEntry } from "./releaseHistory";
import { DetailedReleaseNotesViewer } from "./DetailedReleaseNotesViewer";
import { DialogCloseButton } from "../base/DialogCloseButton";

export const ReleaseDetailModal = ({
  release,
  onClose,
}: {
  release?: ReleaseHistoryEntry;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!release) return;
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, [release]);
  if (!release) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="release-detail-title"
      className="modal-surface release-announcement"
      onCancel={onClose}
    >
      <header className="release-announcement-header">
        <div>
          <p>版本记录</p>
          <h2 id="release-detail-title">上号 {release.version}</h2>
        </div>
        <DialogCloseButton label="关闭更新详情" onClick={onClose} />
      </header>
      <DetailedReleaseNotesViewer
        key={release.version}
        release={release}
        onComplete={onClose}
        completeLabel="关闭"
      />
    </dialog>
  );
};
