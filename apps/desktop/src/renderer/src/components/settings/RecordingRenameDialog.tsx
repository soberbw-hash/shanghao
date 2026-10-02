import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { DialogCloseButton } from "../base/DialogCloseButton";

export const RecordingRenameDialog = ({
  title,
  blocked,
  onSave,
  onClose,
}: {
  title: string;
  blocked: boolean;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const input = element?.querySelector("input");
    input?.focus();
    input?.select();
    return () => element?.close();
  }, []);
  const save = async () => {
    if (saving.current || blocked) return;
    const next = name.trim().replace(/\.m4a$/i, "");
    if (!next || /[<>:"/\\|?*]/.test(next) || [...next].some((char) => char.charCodeAt(0) < 32)) {
      setError("请输入有效名称，不能包含 /、\\、: 等文件名禁用字符。");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(next);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error && failure.message.includes("invalid_recording_title")
          ? "这个名称不能用于文件，请换一个名称。"
          : "名称未保存，文件可能正在处理或被占用。请稍后重试。",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="recording-rename-title"
      className="island-panel m-auto w-full max-w-sm rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 id="recording-rename-title" className="text-balance text-lg font-semibold">
          重命名录音
        </h2>
        <DialogCloseButton label="取消重命名" disabled={busy} onClick={onClose} />
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor="recording-rename-name" className="mb-2 block text-sm font-medium">
          录音名称
        </label>
        <Input
          id="recording-rename-name"
          autoFocus
          value={name}
          maxLength={120}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={error || blocked ? "recording-rename-message" : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
        {(error || blocked) && (
          <p
            id="recording-rename-message"
            role={error ? "alert" : "status"}
            className={`mt-2 text-pretty text-xs ${error ? "text-red-600" : "text-slate-500"}`}
          >
            {error || "正在录音，可以先修改名称，录音结束后再保存。"}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || blocked || !name.trim()}>
            {busy ? "保存中…" : "保存名称"}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
};
