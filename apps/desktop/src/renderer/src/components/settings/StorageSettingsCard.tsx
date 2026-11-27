import { useEffect, useRef, useState } from "react";
import { HardDrive, Search, Trash2 } from "lucide-react";
import type { StorageUsage } from "@private-voice/shared";
import { Button } from "../base/Button";
import { shanghaoCore } from "../../core/shanghaoCore";

const labels: Record<StorageUsage["category"], string> = {
  models: "AI 模型",
  runtimes: "AI 运行环境",
  recordings: "录音",
  updates: "更新缓存",
  temporary: "转录临时文件",
};
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export const StorageSettingsCard = ({ isActive }: { isActive: boolean }) => {
  const [usage, setUsage] = useState<StorageUsage[]>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const running = useRef(false);
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = confirmation.current;
    if (!isActive) setConfirming(false);
    if (!isActive || !confirming || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [confirming, isActive]);
  const inspect = async (clean = false) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (clean) {
        const result = await shanghaoCore.storage.clearExpiredTemporary();
        setMessage(
          result.removed
            ? `已清理 ${result.removed} 个过期文件，释放 ${size(result.removedBytes)}。`
            : "没有可清理的过期文件。",
        );
        setConfirming(false);
      }
      const next = await shanghaoCore.storage.inspect().catch(() => undefined);
      setUsage(next);
      if (!next) setMessage((previous) => `${previous} 占用读取失败，请稍后再试。`.trim());
    } catch {
      setMessage("清理失败，请稍后再试。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <article className="about-info-card about-maintenance-card" aria-label="存储管理">
      <span className="about-info-icon about-info-icon--project">
        <HardDrive aria-hidden="true" />
      </span>
      <div className="about-info-copy">
        <h4>存储管理</h4>
        <p>查看本机存储占用，清理过期转录临时文件。</p>
      </div>
      <div className="about-card-actions">
        <Button variant="secondary" disabled={busy} onClick={() => void inspect()}>
          <Search className="size-4" aria-hidden="true" />
          {busy && !confirming ? "正在处理…" : "查看占用"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          清理临时文件
        </Button>
      </div>
      {usage && (
        <dl className="about-storage-usage">
          {usage.map((item) => (
            <div key={item.category} className="about-storage-usage-row">
              <dt className="text-slate-600">{labels[item.category]}</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {item.complete ? "" : "至少 "}
                {size(item.bytes)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {message && !confirming && (
        <p role="status" className="about-storage-feedback">
          {message}
        </p>
      )}
      {confirming && (
        <dialog
          ref={confirmation}
          aria-labelledby="storage-clean-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setConfirming(false);
          }}
          className="island-panel m-auto max-w-sm rounded-3xl bg-[#f7fbff] p-6 backdrop:bg-slate-900/20"
        >
          <h2 id="storage-clean-title" className="font-semibold">
            清理临时文件？
          </h2>
          <p className="mt-3 text-pretty text-sm text-slate-600">
            清理七天前遗留的转录临时文件，每次最多 100 个。正在转录的文件、录音、模型与更新均保留。
          </p>
          {message && (
            <p role="status" className="mt-3 text-sm">
              {message}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void inspect(true)}>
              {busy ? "正在清理…" : "清理"}
            </Button>
          </div>
        </dialog>
      )}
    </article>
  );
};
