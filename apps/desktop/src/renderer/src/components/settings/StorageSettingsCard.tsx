import { useEffect, useRef, useState } from "react";
import type { StorageUsage } from "@private-voice/shared";
import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";
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
  const generation = useRef(0);
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const counter = generation;
    counter.current++;
    setBusy(false);
    setConfirming(false);
    return () => {
      counter.current++;
    };
  }, [isActive]);
  useEffect(() => {
    const dialog = confirmation.current;
    if (confirming && isActive) dialog?.showModal();
    return () => dialog?.close();
  }, [confirming, isActive]);
  const inspect = async (clean = false) => {
    const owner = generation.current;
    setBusy(true);
    setMessage("");
    try {
      if (clean) {
        const result = await shanghaoCore.storage.clearExpiredTemporary();
        if (owner !== generation.current) return;
        setMessage(`已清理 ${result.removed} 个过期文件，释放 ${size(result.removedBytes)}。`);
        setConfirming(false);
      }
      const next = await shanghaoCore.storage.inspect();
      if (owner === generation.current) setUsage(next);
    } catch {
      if (owner === generation.current) setMessage("读取或清理失败，请稍后重试。");
    } finally {
      if (owner === generation.current) setBusy(false);
    }
  };
  return (
    <SettingsSection
      title="存储管理"
      description="模型和录音保留原位；更新缓存保留供下载与安装使用。"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void inspect()}>
          {busy ? "正在处理…" : "查看占用"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
          清理过期临时文件
        </Button>
      </div>
      {usage && (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {usage.map((item) => (
            <div
              key={item.category}
              className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/50 px-3 py-2 text-sm"
            >
              <dt className="text-slate-600">{labels[item.category]}</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {item.complete ? "" : "至少 "}
                {size(item.bytes)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {message}
        </p>
      )}
      {confirming && (
        <dialog
          ref={confirmation}
          aria-labelledby="storage-clean-title"
          style={{ background: "rgba(247, 251, 255, 0.98)" }}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setConfirming(false);
          }}
          className="island-panel m-auto max-w-sm rounded-3xl p-6 backdrop:bg-slate-900/20"
        >
          <h2 id="storage-clean-title" className="text-lg font-semibold">
            清理过期临时文件？
          </h2>
          <p className="mt-3 text-pretty text-sm text-slate-600">
            仅清理七天前遗留的转录临时 WAV，运行中的任务保留，每次最多 100
            个。模型、录音、待安装更新和可续传下载均保留。
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
    </SettingsSection>
  );
};
