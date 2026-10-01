import { useEffect, useRef, useState } from "react";
import { Plus, Search, Star, Pencil, Trash2, ArrowRight } from "lucide-react";
import { cn } from "@private-voice/ui";
import type { PrivateRoomHistory, PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { useAccountStore } from "../../store/accountStore";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { PrivateRoomIcon } from "./PrivateRoomIcon";
import { PrivateRoomEditor } from "./PrivateRoomEditor";

export const PrivateRoomBrowser = ({
  busy: joining,
  onJoin,
}: {
  busy: boolean;
  onJoin: (room: PrivateRoomInfo) => Promise<void>;
}) => {
  const profile = useAccountStore((state) => state.snapshot.profile);
  const serverUrl = useSettingsStore((state) => state.settings?.relayServerUrl);
  const pendingInvite = useAppStore((state) => state.pendingRoomInvite);
  const [history, setHistory] = useState<PrivateRoomHistory>({ recent: [], favorites: [] });
  const [mine, setMine] = useState<PrivateRoomInfo[]>([]);
  const [tab, setTab] = useState<"recent" | "favorites" | "mine">("recent");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<PrivateRoomInfo>();
  const [editor, setEditor] = useState<PrivateRoomInfo | "create">();
  const [deleting, setDeleting] = useState<PrivateRoomInfo>();
  const confirm = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const historyRef = useRef(history);
  historyRef.current = history;
  const blocked = busy || joining;
  const renderedGeneration = generation.current;
  useEffect(() => {
    const counter = generation;
    const current = ++counter.current;
    setLoading(true);
    setHistory({ recent: [], favorites: [] });
    setMine([]);
    setFound(undefined);
    setEditor(undefined);
    setDeleting(undefined);
    setBusy(false);
    setError("");
    void Promise.all([shanghaoCore.rooms.history(), shanghaoCore.rooms.mine()])
      .then(([saved, owned]) => {
        if (generation.current !== current) return;
        setMine(owned);
        setHistory(saved);
        const fresh = new Map(owned.map((room) => [room.roomId, room]));
        if (generation.current !== current) return;
        setHistory({
          ...saved,
          recent: saved.recent.map((room) => fresh.get(room.roomId) ?? room),
          favorites: saved.favorites.map((room) => fresh.get(room.roomId) ?? room),
        });
      })
      .catch((error) => {
        if (generation.current === current) setError(privateRoomErrorMessage(error));
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      counter.current++;
    };
  }, [profile?.userId, serverUrl]);
  useEffect(() => {
    if (!pendingInvite) return;
    let cancelled = false;
    setFinding(true);
    setFound(undefined);
    void shanghaoCore.rooms
      .get(pendingInvite)
      .then((room) => {
        if (!cancelled) {
          setFound(room);
          setCode(room.channelCode);
        }
      })
      .catch((error) => {
        if (!cancelled) setError(privateRoomErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) useAppStore.getState().setPendingRoomInvite(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingInvite, profile?.userId, serverUrl]);
  useEffect(() => {
    if (loading || tab === "mine") return;
    let cancelled = false;
    // Refresh only the first visible page. Joining always resolves the immutable ID again.
    const queue = [...new Set(historyRef.current[tab].slice(0, 10).map((room) => room.roomId))];
    const refresh = async () => {
      while (!cancelled && queue.length) {
        const id = queue.shift()!;
        try {
          const room = await shanghaoCore.rooms.get(id);
          if (!cancelled)
            setHistory((saved) => ({
              ...saved,
              recent: saved.recent.map((item) => (item.roomId === id ? room : item)),
              favorites: saved.favorites.map((item) => (item.roomId === id ? room : item)),
            }));
        } catch {
          /* Deleted rooms retain their saved ID and report the reason when opened. */
        }
      }
    };
    void refresh();
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [tab, loading, profile?.userId, serverUrl]);
  useEffect(() => {
    if (deleting) confirm.current?.showModal();
  }, [deleting]);
  const run = async (operation: (current: () => boolean) => Promise<void>) => {
    const owner = generation.current;
    const current = () => generation.current === owner;
    setBusy(true);
    setError("");
    try {
      await operation(current);
    } catch (error) {
      if (current()) setError(privateRoomErrorMessage(error));
    } finally {
      if (current()) setBusy(false);
    }
  };
  const join = (room: PrivateRoomInfo) =>
    run(async (current) => {
      const fresh = await shanghaoCore.rooms.get(room.roomId);
      if (!current()) return;
      if (fresh.onlineCount >= fresh.capacity) {
        setError("房间已满，最多五人同时在线。");
        return;
      }
      await onJoin(fresh);
    });
  const toggleFavorite = (room: PrivateRoomInfo) =>
    run(async (current) => {
      const saved = await shanghaoCore.rooms.favorite(
        room.roomId,
        !history.favorites.some((item) => item.roomId === room.roomId),
      );
      if (current()) setHistory(saved);
    });
  const rooms = tab === "mine" ? mine : history[tab];
  const last = history.recent.find((room) => room.roomId === history.lastRoomId);
  const roomRow = (room: PrivateRoomInfo, preview = false) => (
    <div
      key={room.roomId}
      className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/65 px-3 py-2.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
        <PrivateRoomIcon icon={room.icon} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={blocked || preview}
        onClick={() => void join(room)}
      >
        <strong className="block truncate text-sm text-[#263b56]">{room.name}</strong>
        <span className="text-xs tabular-nums text-slate-500">
          {room.channelCode} · {room.onlineCount}/{room.capacity} 在线
        </span>
      </button>
      <button
        type="button"
        disabled={blocked}
        onClick={() => void toggleFavorite(room)}
        aria-label={
          history.favorites.some((item) => item.roomId === room.roomId)
            ? "取消收藏房间"
            : "收藏房间"
        }
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-blue-500"
      >
        <Star
          className="size-4"
          fill={
            history.favorites.some((item) => item.roomId === room.roomId) ? "currentColor" : "none"
          }
        />
      </button>
      {room.ownerId === profile?.userId && (
        <>
          <button
            type="button"
            disabled={blocked}
            onClick={() => setEditor(room)}
            aria-label="编辑房间"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => setDeleting(room)}
            aria-label="删除房间"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500"
          >
            <Trash2 className="size-4" />
          </button>
        </>
      )}
    </div>
  );
  return (
    <section className="space-y-4" aria-label="私人房间">
      {last && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-slate-500">上次房间</span>
          {roomRow(last)}
          <Button className="w-full" disabled={blocked} onClick={() => void join(last)}>
            进入上次房间
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={blocked || mine.length >= 3}
          onClick={() => setEditor("create")}
        >
          <Plus className="size-4" />
          创建房间
        </Button>
        <Button
          variant="secondary"
          disabled={blocked}
          onClick={() => {
            setFinding(!finding);
            setFound(undefined);
            setError("");
          }}
        >
          <Search className="size-4" />
          查找房间
        </Button>
      </div>
      {finding && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async (current) => {
              const room = await shanghaoCore.rooms.find(code);
              if (current()) setFound(room);
            });
          }}
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={code}
              placeholder="六位频道号"
              aria-label="查找频道号"
              className="min-w-0 font-mono tabular-nums"
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ""));
                setFound(undefined);
              }}
            />
            <Button type="submit" variant="secondary" disabled={blocked || code.length !== 6}>
              查找
            </Button>
          </div>
          {found && (
            <div className="space-y-2">
              {roomRow(found, true)}
              <Button
                type="button"
                disabled={blocked || found.onlineCount >= found.capacity}
                className="w-full"
                onClick={() => void join(found)}
              >
                {found.onlineCount >= found.capacity ? "房间已满" : "加入房间"}
              </Button>
            </div>
          )}
        </form>
      )}
      <div className="flex gap-1 rounded-xl bg-slate-100/60 p-1" role="group" aria-label="房间列表">
        {(
          [
            ["recent", "最近"],
            ["favorites", "收藏"],
            ["mine", "我的房间"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "min-h-9 flex-1 rounded-lg text-xs font-semibold",
              tab === id ? "bg-white text-blue-600 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
            {id === "mine" ? ` ${mine.length}/3` : ""}
          </button>
        ))}
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {loading && !rooms.length ? (
          <p role="status" className="py-3 text-center text-sm text-slate-500">
            正在读取房间…
          </p>
        ) : rooms.length ? (
          rooms.map((room) => roomRow(room))
        ) : (
          <p className="py-3 text-center text-sm text-slate-500">
            {tab === "favorites"
              ? "收藏常去的房间，方便下次进入。"
              : tab === "mine"
                ? "创建房间后，把频道号发给朋友。"
                : "创建或查找房间，开始上号。"}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-pretty text-sm text-red-600">
          {error}
        </p>
      )}
      {editor && (
        <PrivateRoomEditor
          room={editor === "create" ? undefined : editor}
          defaultName={profile?.displayName ?? "我的"}
          onClose={() => setEditor(undefined)}
          onSaved={(room) => {
            if (generation.current !== renderedGeneration) return;
            setMine((rooms) => [room, ...rooms.filter((item) => item.roomId !== room.roomId)]);
            setHistory((saved) => ({
              ...saved,
              recent: saved.recent.map((item) => (item.roomId === room.roomId ? room : item)),
              favorites: saved.favorites.map((item) => (item.roomId === room.roomId ? room : item)),
            }));
            setEditor(undefined);
            setTab("mine");
          }}
        />
      )}
      {deleting && (
        <dialog
          ref={confirm}
          role="alertdialog"
          aria-labelledby="delete-room-title"
          style={{ background: "rgba(247, 251, 255, 0.98)" }}
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setDeleting(undefined);
          }}
          className="island-panel m-auto w-full max-w-sm rounded-3xl p-6 text-[#263b56] backdrop:bg-slate-900/20"
        >
          <h2 id="delete-room-title" className="text-balance text-lg font-semibold">
            删除“{deleting.name}”？
          </h2>
          <p className="mt-3 text-pretty text-sm text-slate-500">
            房间将立即失效，在线用户会离开。频道号 {deleting.channelCode} 将保留 30
            天冷却期，本地录音不受影响。
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async (current) => {
                  await shanghaoCore.rooms.delete(deleting.roomId);
                  if (!current()) return;
                  setMine((rooms) => rooms.filter((room) => room.roomId !== deleting.roomId));
                  setDeleting(undefined);
                })
              }
            >
              删除房间
            </Button>
          </div>
        </dialog>
      )}
    </section>
  );
};
