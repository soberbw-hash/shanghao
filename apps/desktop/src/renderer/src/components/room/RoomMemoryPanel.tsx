import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  ROOM_MEMORY_TEXT_LIMIT,
  ROOM_MEMORY_FACT_LIMIT,
  type RoomMemorySnapshot,
} from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAccountStore } from "../../store/accountStore";
import { useSettingsStore } from "../../store/settingsStore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { mergeRoomMemoryDraft } from "../../features/room/roomMemoryDraft";
import { Button } from "../base/Button";
import { Switch } from "../base/Switch";

const editable = (memory: RoomMemorySnapshot) => ({
  roomId: memory.roomId,
  revision: memory.revision,
  manualText: memory.manualText,
  autoEnabled: memory.autoEnabled,
  entries: memory.entries.map(({ id, text }) => ({ id, text })),
});
/** Scope changes remount the editor, so a late reply cannot show another account's memory. */
export const RoomMemoryPanel = ({ roomId }: { roomId: string }) => {
  const userId = useAccountStore((state) => state.snapshot.profile?.userId);
  const server = useSettingsStore((state) => state.settings?.relayServerUrl);
  return <RoomMemoryEditor key={`${server}|${userId}|${roomId}`} roomId={roomId} />;
};
const RoomMemoryEditor = ({ roomId }: { roomId: string }) => {
  const [base, setBase] = useState<RoomMemorySnapshot>();
  const [draft, setDraft] = useState<RoomMemorySnapshot>({
    roomId,
    revision: 0,
    manualText: "",
    autoEnabled: false,
    entries: [],
  });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(false);
  const pending = useRef(true);
  const sequence = useRef(0);
  useEffect(() => {
    active.current = true;
    const id = ++sequence.current;
    void shanghaoCore.roomMemory
      .get(roomId)
      .then((memory) => {
        if (active.current && sequence.current === id) {
          setBase(memory);
          setDraft(memory);
        }
      })
      .catch((error) => {
        if (active.current && sequence.current === id) setError(privateRoomErrorMessage(error));
      })
      .finally(() => {
        if (active.current && sequence.current === id) {
          pending.current = false;
          setBusy(false);
        }
      });
    return () => {
      active.current = false;
    };
  }, [roomId]);
  const load = async () => {
    if (pending.current) return;
    pending.current = true;
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const latest = await shanghaoCore.roomMemory.get(roomId);
      if (!active.current || sequence.current !== id) return;
      const merged = base ? mergeRoomMemoryDraft(base, draft, latest) : latest;
      setBase(latest);
      setDraft(merged);
      setNotice(draft ? "已载入最新记忆，未保存的编辑已保留，请核对。" : "");
    } catch (error) {
      if (active.current && sequence.current === id) setError(privateRoomErrorMessage(error));
    } finally {
      if (active.current && sequence.current === id) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const save = async () => {
    if (!draft || busy || pending.current) return;
    pending.current = true;
    const id = ++sequence.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await shanghaoCore.roomMemory.save(editable(draft));
      if (active.current && sequence.current === id) {
        setBase(saved);
        setDraft(saved);
        setNotice("记忆已保存");
      }
    } catch (error) {
      if (active.current && sequence.current === id) setError(privateRoomErrorMessage(error));
    } finally {
      if (active.current && sequence.current === id) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  const dirty = Boolean(
    base && draft && JSON.stringify(editable(base)) !== JSON.stringify(editable(draft)),
  );
  return (
    <section
      aria-label="房间记忆"
      className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/40 p-4"
    >
      <h3 className="text-sm font-semibold">房间记忆</h3>
      <p className="mb-3 mt-1 text-xs leading-relaxed text-slate-500">
        AI 回答、整理和每日总结会先参考。仅用于此房间，房主可编辑。
      </p>
      {draft && (
        <>
          <label htmlFor={`room-memory-${roomId}`} className="text-xs font-medium">
            手动记忆
          </label>
          <textarea
            id={`room-memory-${roomId}`}
            rows={4}
            maxLength={ROOM_MEMORY_TEXT_LIMIT}
            disabled={busy || !base}
            value={draft.manualText}
            onChange={(event) => {
              setDraft({ ...draft, manualText: event.target.value });
              setNotice("");
            }}
            placeholder="写下成员的常用称呼、人物关系、长期偏好或约定…"
            className="mt-1 w-full resize-y rounded-xl border border-blue-100 bg-white p-3 text-sm leading-relaxed outline-none focus:border-blue-400 disabled:opacity-60"
          />
          <p className="mt-1 text-right text-xs text-slate-400">
            {draft.manualText.length}/{ROOM_MEMORY_TEXT_LIMIT}
          </p>
          <div className="my-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">自动记忆</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                从已上传的整理摘要中提取称呼、关系和偏好。关闭后保留已有记忆。
              </p>
            </div>
            <Switch
              ariaLabel="自动记忆"
              isChecked={draft.autoEnabled}
              isDisabled={busy || !base}
              onChange={(enabled) => {
                setDraft({ ...draft, autoEnabled: enabled });
                setNotice("");
              }}
            />
          </div>
          <details className="rounded-xl border border-blue-100 bg-white/70 p-3">
            <summary className="cursor-pointer text-xs font-medium">
              自动记忆 · {draft.entries.length} 条
            </summary>
            <div className="mt-2 space-y-3">
              {!draft.entries.length && (
                <p className="text-xs leading-relaxed text-slate-500">
                  上传整理摘要后，会自动提取有明确依据的长期信息。
                </p>
              )}
              {draft.entries.map((entry, index) => (
                <div key={entry.id} className="border-t border-slate-100 pt-2">
                  <div className="flex items-start gap-2">
                    <textarea
                      rows={2}
                      aria-label={`自动记忆 ${index + 1}`}
                      maxLength={ROOM_MEMORY_FACT_LIMIT}
                      disabled={busy || !base}
                      value={entry.text}
                      className="min-w-0 flex-1 resize-y rounded-lg border border-blue-100 p-2 text-sm leading-relaxed"
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          entries: draft.entries.map((item) =>
                            item.id === entry.id ? { ...item, text: event.target.value } : item,
                          ),
                        });
                        setNotice("");
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy || !base}
                      aria-label={`删除自动记忆 ${index + 1}`}
                      title="删除此条记忆"
                      className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      onClick={() => {
                        setDraft({
                          ...draft,
                          entries: draft.entries.filter((item) => item.id !== entry.id),
                        });
                        setNotice("");
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400" title={`原始依据：${entry.quote}`}>
                    来自 {entry.sourceTitle}
                  </p>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      <p style={{ minHeight: 24 }} className="mt-2 text-xs text-slate-500" role="status">
        {busy && !base ? "正在读取记忆…" : notice}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-red-600">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          载入最新
        </Button>
        {draft && (
          <Button
            variant="secondary"
            disabled={busy || !dirty || draft.entries.some((entry) => !entry.text.trim())}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存记忆"}
          </Button>
        )}
      </div>
    </section>
  );
};
