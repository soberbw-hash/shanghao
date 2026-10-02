import { useEffect, useRef, useState } from "react";
import { Plus, Search, Star, ArrowRight } from "lucide-react";
import { cn } from "@private-voice/ui";
import type { PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { privateRoomErrorMessage } from "../../features/room/privateRoomMessages";
import { useAccountStore } from "../../store/accountStore";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { PrivateRoomIcon } from "./PrivateRoomIcon";
import { roomIconStyle } from "./roomIconColors";
import { PrivateRoomEditor } from "./PrivateRoomEditor";
import { usePendingRoomInvite } from "../../features/room/usePendingRoomInvite";
import { usePrivateRoomDirectory } from "../../features/room/usePrivateRoomDirectory";

export const PrivateRoomBrowser = ({
  busy: joining,
  onJoin,
  currentRoom,
}: {
  busy: boolean;
  onJoin: (room: PrivateRoomInfo) => Promise<void>;
  currentRoom?: PrivateRoomInfo;
}) => {
  const profile = useAccountStore((state) => state.snapshot.profile);
  const serverUrl = useSettingsStore((state) => state.settings?.relayServerUrl);
  const pendingInvite = useAppStore((state) => state.pendingRoomInvite);
  const autoJoinInvite = useAppStore((state) => state.pendingRoomInviteAutoJoin);
  const generation = useRef(0);
  const {
    history,
    setHistory,
    mine,
    setMine,
    loading,
    error: directoryError,
  } = usePrivateRoomDirectory(profile?.userId, serverUrl, generation, currentRoom);
  const [tab, setTab] = useState<"recent" | "favorites" | "mine">("recent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<PrivateRoomInfo>();
  const [creating, setCreating] = useState(false);
  const historyRef = useRef(history);
  historyRef.current = history;
  const blocked = busy || joining;
  const renderedGeneration = generation.current;
  useEffect(() => {
    setFound(undefined);
    setCreating(false);
    setBusy(false);
    setError("");
  }, [profile?.userId, serverUrl]);
  usePendingRoomInvite({
    roomId: pendingInvite,
    autoJoin: autoJoinInvite,
    userId: profile?.userId,
    serverUrl,
    joining: blocked,
    generation,
    onFound: (room) => {
      setFinding(true);
      setFound(room);
      setCode(room.channelCode);
      setError("");
    },
    onBusy: setBusy,
    onError: (error) => setError(privateRoomErrorMessage(error)),
    onJoin,
  });
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
  }, [tab, loading, profile?.userId, serverUrl, setHistory]);
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
  const showDirectory =
    !loading &&
    (!last ||
      [...history.recent, ...history.favorites, ...mine].some(
        (room) => room.roomId !== last.roomId,
      ));
  const visibleRooms =
    tab === "recent" ? rooms.filter((room) => room.roomId !== last?.roomId) : rooms;
  const roomRow = (room: PrivateRoomInfo, preview = false, featured = false) => (
    <div
      key={room.roomId}
      className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/65 px-3 py-2.5"
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl",
          featured ? "size-12" : "size-10",
        )}
        style={roomIconStyle(room.iconColor)}
      >
        <PrivateRoomIcon icon={room.icon} className={featured ? "size-6" : "size-5"} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        disabled={blocked || preview}
        onClick={() => void join(room)}
      >
        <strong className={cn("block truncate text-[#263b56]", featured ? "text-lg" : "text-sm")}>
          {room.name}
        </strong>
        <span className="text-xs tabular-nums text-slate-500">
          频道 {room.channelCode} · {room.onlineCount}/{room.capacity} 在线
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
    </div>
  );
  return (
    <section className="private-room-browser space-y-4" aria-label="私人房间" aria-busy={loading}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-balance text-base font-semibold text-[#263b56]">
          {last ? "回到房间" : "进入房间"}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={blocked}
            aria-expanded={finding}
            onClick={() => {
              setFinding(!finding);
              setFound(undefined);
              setError("");
            }}
          >
            <Search className="size-3.5" />
            查找
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-2 text-xs"
            disabled={blocked || mine.length >= 3}
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" />
            创建
          </Button>
        </div>
      </header>
      {loading && !last && (
        <div className="private-room-placeholder" role="status">
          正在读取房间…
        </div>
      )}
      {last && (
        <div className="private-room-featured space-y-3 rounded-2xl border border-blue-200/60 bg-blue-50/40 p-3">
          <span className="text-xs font-medium text-slate-500">上次一起玩的房间</span>
          {roomRow(last, false, true)}
          <Button className="w-full" disabled={blocked} onClick={() => void join(last)}>
            {joining ? "正在进入…" : "进入上次房间"}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}
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
              placeholder="频道号"
              aria-label="查找频道号"
              className="min-w-0 flex-1 font-mono tabular-nums"
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, ""));
                setFound(undefined);
              }}
            />
            <Button
              type="submit"
              variant="secondary"
              className="min-w-16 shrink-0 whitespace-nowrap"
              disabled={blocked || code.length !== 6}
            >
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
      {showDirectory && (
        <div
          className="flex gap-1 rounded-xl bg-slate-100/60 p-1"
          role="group"
          aria-label="房间列表"
        >
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
      )}
      {showDirectory && (visibleRooms.length > 0 || tab !== "recent" || !last) && (
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {visibleRooms.length ? (
            visibleRooms.map((room) => roomRow(room))
          ) : (
            <p className="py-3 text-center text-sm text-slate-500">
              {tab === "favorites"
                ? "收藏常去的房间，方便下次进入。"
                : tab === "mine"
                  ? "创建房间后，把频道号发给朋友。"
                  : "用朋友的频道号查找，或创建你的房间。"}
            </p>
          )}
        </div>
      )}
      {(error || directoryError) && (
        <p role="alert" className="text-pretty text-sm text-red-600">
          {error || directoryError}
        </p>
      )}
      {creating && (
        <PrivateRoomEditor
          defaultName={profile?.displayName ?? "我的"}
          onClose={() => setCreating(false)}
          onSaved={(room) => {
            if (generation.current !== renderedGeneration) return;
            setMine((rooms) => [room, ...rooms.filter((item) => item.roomId !== room.roomId)]);
            setCreating(false);
            setTab("mine");
          }}
        />
      )}
    </section>
  );
};
