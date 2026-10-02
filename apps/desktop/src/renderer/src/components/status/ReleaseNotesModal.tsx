import { useCallback, useEffect, useRef, useState } from "react";
import { DetailedReleaseNotesViewer } from "./DetailedReleaseNotesViewer";
import { useSettingsStore } from "../../store/settingsStore";
import { getReleaseHistoryEntry } from "./releaseHistory";
import { DialogCloseButton } from "../base/DialogCloseButton";

export const ReleaseNotesModal = () => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");
  const hasCompletedProfileSetup = useSettingsStore(
    (state) => state.settings?.hasCompletedProfileSetup,
  );
  const lastReleaseNotesVersionSeen = useSettingsStore(
    (state) => state.settings?.lastReleaseNotesVersionSeen,
  );
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const version = runtimeInfo?.version ?? "";
  const isVisible = Boolean(
    hasCompletedProfileSetup &&
    version &&
    version !== "0.0.0" &&
    lastReleaseNotesVersionSeen !== version &&
    dismissedVersion !== version,
  );
  const dismiss = useCallback(() => {
    if (!version) return;
    setDismissedVersion(version);
    void saveSettings({ lastReleaseNotesVersionSeen: version });
  }, [saveSettings, version]);
  useEffect(() => {
    if (!isVisible) return;
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, [isVisible]);
  if (!isVisible) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="release-notes-title"
      className="modal-surface release-announcement"
      onCancel={dismiss}
    >
      <header className="release-announcement-header">
        <div>
          <p>更新内容</p>
          <h2 id="release-notes-title">上号 {version}</h2>
        </div>
        <DialogCloseButton label="关闭更新公告" onClick={dismiss} />
      </header>
      <DetailedReleaseNotesViewer
        key={version}
        release={getReleaseHistoryEntry(version)}
        onComplete={dismiss}
      />
    </dialog>
  );
};
