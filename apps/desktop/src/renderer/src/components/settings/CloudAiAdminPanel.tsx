import { useEffect, useRef, useState } from "react";
import type {
  CloudAiAdminMutation,
  CloudAiAdminProvider,
  CloudAiAdminSnapshot,
} from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";

const messages: Record<string, string> = {
  cloud_ai_admin_conflict: "配置已被另一处修改，请刷新后重试。",
  cloud_ai_admin_provider_not_supported:
    "当前支持智谱、硅基流动、DeepSeek 和 OpenAI 的 HTTPS 服务地址。",
  cloud_ai_admin_key_required: "请填写此服务的密钥。",
  cloud_ai_admin_storage_not_configured: "服务器尚未配置可写的管理存储路径。",
  cloud_ai_admin_forbidden: "管理员授权已失效，请重新登录。",
  cloud_ai_admin_key_invalid: "密钥文件无效，或与当前云端服务器不匹配。",
  cloud_ai_admin_key_rejected: "服务器未接受该密钥，请检查服务器是否已启用此密钥。",
};
const errorText = (error: unknown) => {
  const code = String(error instanceof Error ? error.message : error).match(
    /cloud_ai_admin_[a-z_]+/,
  )?.[0];
  return (code && messages[code]) || "操作未完成，请检查服务器连接并重试。";
};
const initial = {
  kind: "text" as "text" | "speech",
  name: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  apiKey: "",
};

function AuthorizedPanel() {
  const [snapshot, setSnapshot] = useState<CloudAiAdminSnapshot>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(initial as typeof initial & { id?: string });
  const [confirmation, setConfirmation] = useState<CloudAiAdminMutation>();
  const sequence = useRef(0);
  const operationPending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const mine = ++sequence.current;
    void window.desktopApi.cloudAiAdmin
      .get()
      .then((value) => {
        if (active.current && sequence.current === mine) setSnapshot(value);
      })
      .catch(() => undefined);
    return () => {
      active.current = false;
    };
  }, []);
  const refresh = async () => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await window.desktopApi.cloudAiAdmin.get();
      if (active.current) setSnapshot(value);
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      operationPending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const change = async (mutation: CloudAiAdminMutation) => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    setConfirmation(undefined);
    try {
      const value = await window.desktopApi.cloudAiAdmin.change(mutation);
      if (active.current) {
        setSnapshot(value);
        setEditing(false);
        setForm(initial);
      }
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      operationPending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const edit = (provider?: CloudAiAdminProvider) => {
    setForm(
      provider
        ? {
            id: provider.id,
            kind: provider.kind,
            name: provider.name,
            baseUrl: provider.baseUrl,
            model: provider.model,
            apiKey: "",
          }
        : initial,
    );
    setEditing(true);
    setError("");
  };
  if (!snapshot) return null;
  const fieldClass = "w-full min-w-0 rounded-xl border border-[#d9e6f7] bg-white px-3 py-2 text-sm";
  return (
    <section className="mb-4 rounded-2xl border border-[#cfdff4] bg-[#f5f9ff] p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left font-semibold text-[#344d6c]"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (open) {
            setForm(initial);
            setEditing(false);
            setConfirmation(undefined);
          }
        }}
      >
        <span>
          云端服务管理 <small className="font-normal text-[#718399]">管理员</small>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-[#718399]">
            密钥仅保存在服务器。修改当前或备用服务会对后续请求生效，进行中的任务保留原配置。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
              刷新
            </Button>
            <Button disabled={busy || snapshot.providers.length >= 16} onClick={() => edit()}>
              添加服务
            </Button>
          </div>
          {snapshot.providers.map((provider) => (
            <article key={provider.id} className="rounded-xl border border-[#dce7f4] bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">{provider.name}</strong>
                <small className={provider.active ? "text-[#228268]" : "text-[#7a899c]"}>
                  {provider.active ? "当前启用" : provider.fallback ? "备用服务" : "已停用"} ·{" "}
                  {provider.kind === "text" ? "文字" : "语音"}
                </small>
              </div>
              <p className="mt-1 break-all text-xs text-[#718399]">
                {provider.model} · {provider.hasKey ? "密钥已保存" : "尚无密钥"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => edit(provider)}>
                  修改
                </Button>
                {provider.kind === "text" && !provider.active ? (
                  <Button
                    variant="secondary"
                    disabled={busy || !provider.hasKey}
                    onClick={() =>
                      setConfirmation({
                        revision: snapshot.revision,
                        action: provider.fallback ? "clear-fallback" : "set-fallback",
                        id: provider.id,
                      })
                    }
                  >
                    {provider.fallback ? "取消备用" : "设为备用"}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={busy || (!provider.active && !provider.hasKey)}
                  onClick={() =>
                    setConfirmation({
                      revision: snapshot.revision,
                      action: provider.active ? "disable" : "activate",
                      id: provider.id,
                    })
                  }
                >
                  {provider.active ? "停用" : "启用"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      revision: snapshot.revision,
                      action: "delete",
                      id: provider.id,
                    })
                  }
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
          {editing ? (
            <form
              className="space-y-3 rounded-xl bg-[#eaf2ff] p-3"
              onSubmit={(event) => {
                event.preventDefault();
                const mutation: CloudAiAdminMutation = {
                  action: "save",
                  revision: snapshot.revision,
                  provider: form,
                };
                if (
                  snapshot.providers.some(
                    (provider) => provider.id === form.id && (provider.active || provider.fallback),
                  )
                )
                  setConfirmation(mutation);
                else void change(mutation);
              }}
            >
              <label className="block text-xs">
                用途
                <select
                  className={fieldClass}
                  disabled={busy || Boolean(form.id)}
                  value={form.kind}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      kind: event.target.value as "text" | "speech",
                      baseUrl:
                        event.target.value === "speech"
                          ? "https://api.siliconflow.cn/v1"
                          : initial.baseUrl,
                      model:
                        event.target.value === "speech"
                          ? "FunAudioLLM/SenseVoiceSmall"
                          : initial.model,
                    })
                  }
                >
                  <option value="text">文字摘要与问答</option>
                  <option value="speech">语音转文字</option>
                </select>
              </label>
              {(
                [
                  ["name", "服务名称", 80],
                  [
                    "baseUrl",
                    "API 基础地址（不含 chat/completions 或 audio/transcriptions）",
                    1024,
                  ],
                  ["model", "模型名称", 160],
                  ["apiKey", "API 密钥（留空保留现有密钥）", 8192],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key} className="block text-xs">
                  {label}
                  <input
                    className={fieldClass}
                    type={key === "apiKey" ? "password" : "text"}
                    autoComplete={key === "apiKey" ? "new-password" : "off"}
                    spellCheck={false}
                    maxLength={max}
                    required={key !== "apiKey"}
                    disabled={busy}
                    value={form[key]}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                  />
                </label>
              ))}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "保存中…" : "保存"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setForm(initial);
                    setConfirmation(undefined);
                  }}
                >
                  取消
                </Button>
              </div>
            </form>
          ) : null}
          {confirmation ? (
            <div
              role="alert"
              className="rounded-xl border border-[#e9cfa2] bg-[#fff9ed] p-3 text-sm"
            >
              <p>
                {confirmation.action === "delete"
                  ? "确认删除此云端服务？删除当前服务后，对应云端功能将暂停。"
                  : confirmation.action === "disable"
                    ? "确认停用？对应云端功能将暂停。"
                    : "确认应用这项配置？后续云端请求将使用新配置。"}
              </p>
              <div className="mt-3 flex gap-2">
                <Button disabled={busy} onClick={() => void change(confirmation)}>
                  确认
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[#bd4651]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AdminGate() {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importing = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <section className="mb-4 rounded-2xl border border-[#cfdff4] bg-[#f5f9ff] p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left font-semibold text-[#344d6c]"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>管理员功能</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open &&
        (unlocked ? (
          <AuthorizedPanel />
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-[#718399]">
              选择管理员密钥文件以管理云端 AI 服务。密钥只在本次运行中使用。
            </p>
            <Button
              disabled={busy}
              onClick={() => {
                if (importing.current) return;
                importing.current = true;
                setBusy(true);
                setError("");
                void window.desktopApi.cloudAiAdmin
                  .importKey()
                  .then((ok) => {
                    if (ok && active.current) setUnlocked(true);
                  })
                  .catch((cause) => {
                    if (active.current) setError(errorText(cause));
                  })
                  .finally(() => {
                    importing.current = false;
                    if (active.current) setBusy(false);
                  });
              }}
            >
              上传密钥文件
            </Button>
            {error && (
              <p role="alert" className="text-sm text-[#bd4651]">
                {error}
              </p>
            )}
          </div>
        ))}
    </section>
  );
}

export function CloudAiAdminPanel() {
  const relay = useSettingsStore((state) => state.settings?.relayServerUrl);
  return <AdminGate key={relay} />;
}
