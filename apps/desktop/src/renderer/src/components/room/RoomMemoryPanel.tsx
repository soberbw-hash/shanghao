import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  ROOM_MEMORY_TEXT_LIMIT,
  ROOM_MEMORY_AUTO_TEXT_LIMIT,
  roomAutomaticMemoryText,
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
  automaticText: roomAutomaticMemoryText(memory),
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
      setNotice("已更新，编辑已保留");
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
    <section aria-label="房间记忆" className="space-y-4">
      {draft && (
        <>
          <div>
            <label htmlFor={`room-memory-${roomId}`} className="text-sm font-semibold">
              房间记忆 <span className="font-normal text-slate-500">（手动记忆）</span>
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
              placeholder="写下称呼、偏好或约定"
              className="mt-2 w-full resize-y rounded-xl border border-blue-100 bg-white p-3 text-sm leading-relaxed outline-none focus:border-blue-400 disabled:opacity-60"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor={`room-auto-memory-${roomId}`} className="text-sm font-semibold">
                自动记忆
              </label>
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
            <textarea
              id={`room-auto-memory-${roomId}`}
              aria-label="自动记忆内容"
              rows={4}
              maxLength={ROOM_MEMORY_AUTO_TEXT_LIMIT}
              disabled={busy || !base}
              value={roomAutomaticMemoryText(draft)}
              placeholder="暂无自动记忆"
              className="w-full resize-y rounded-xl border border-blue-100 bg-white p-3 text-sm leading-relaxed outline-none focus:border-blue-400 disabled:opacity-60"
              onChange={(event) => {
                setDraft({ ...draft, automaticText: event.target.value });
                setNotice("");
              }}
            />
          </div>
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
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void load()}
          aria-label="刷新房间记忆"
          title="载入最新记忆，保留当前编辑"
        >
          <RefreshCw size={16} aria-hidden="true" />
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
