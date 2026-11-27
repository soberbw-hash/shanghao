import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useScrollEdgeFade } from "../../features/motion/useScrollEdgeFade";
import {
  applyRoomMemoryNames,
  isPrivateRoomId,
  roomAutomaticMemoryText,
  roomMemoryNames,
} from "@private-voice/shared";
import { BookOpen, Download, Info, Mic, MicOff } from "lucide-react";
import { useRoomStore } from "../../store/roomStore";
import type { RoomChronicleClient } from "../../features/room/RoomChronicleClient";
import { useChronicleArchive } from "../../features/room/useChronicleArchive";

const EMPTY_ENTRIES: [] = [];
const EMPTY_NAMES = new Map<string, string>();
const chronicleTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});

export function RoomChroniclePanel({
  transport,
  status,
  replayControl,
}: {
  transport?: RoomChronicleClient;
  status: string;
  replayControl?: ReactNode;
}) {
  const message = useRoomStore((state) => state.chronicle);
  const room = useRoomStore((state) => state.room);
  const localId = useRoomStore((state) => state.room.members.find((member) => member.isLocal)?.id);
  const state = message?.state;
  const participating = !!localId && !!state?.participants.includes(localId);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const helpId = useId();
  const [helpDismissed, setHelpDismissed] = useState(false);
  const pendingRef = useRef(false);
  const [shown, setShown] = useState(60);
  const archive = useChronicleArchive(room.roomId, state?.entries ?? EMPTY_ENTRIES, message?.day);
  useEffect(() => setShown(60), [message?.day?.date, room.roomId]);
  const [memoryNames, setMemoryNames] = useState<{ roomId: string; names: Map<string, string> }>();
  useEffect(() => {
    const roomId = room.roomId;
    const api = window.desktopApi?.roomMemory;
    if (!api || !isPrivateRoomId(roomId)) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      void api
        .get(roomId)
        .then((memory) => {
          if (active && request === generation) {
            setMemoryNames({
              roomId,
              names: roomMemoryNames(memory.manualText, roomAutomaticMemoryText(memory)),
            });
          }
        })
        .catch(() => undefined);
    };
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === roomId) load();
    };
    load();
    window.addEventListener("shanghao:room-memory-saved", refresh);
    return () => {
      active = false;
      window.removeEventListener("shanghao:room-memory-saved", refresh);
    };
  }, [room.roomId]);
  const listRef = useRef<HTMLDivElement>(null);
  useScrollEdgeFade(listRef, archive.entries.length > 0);
  const newest = archive.entries.at(-1)?.id;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && newest) list.scrollTop = list.scrollHeight;
  }, [newest]);
  const names = memoryNames?.roomId === room.roomId ? memoryNames.names : EMPTY_NAMES;
  const stories = useMemo(
    () =>
      archive.entries.slice(-shown).map((entry) => (
        <article key={entry.id}>
          <time dateTime={new Date(entry.at).toISOString()}>
            {chronicleTimeFormat.format(entry.at)}
          </time>
          <div>
            <p>{applyRoomMemoryNames(entry.text, names)}</p>
          </div>
        </article>
      )),
    [archive.entries, names, shown],
  );
  const members = room.members.filter((member) => !member.isEmptySlot);
  const heard = members.filter((member) => state?.participants.includes(member.id));
  const act = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      if (!transport) throw Error();
      await transport.control(state ? "participate" : "start", state?.sessionId, !participating);
    } catch {
      setError("当前连接暂不可用，请稍后再试");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const available = message?.available === true;
  return (
    <section className="room-chronicle" aria-label="房间转录纪事">
      <div className="room-chronicle-toolbar">
        {replayControl}
        <button
          type="button"
          disabled={!archive.stored || !archive.entries.length}
          title={message?.day ? "导出当天纪事，不包含逐字转录稿" : "导出本机纪事，不包含逐字转录稿"}
          onClick={() => void archive.exportStories()}
        >
          <Download size={14} />
          导出聊天纪事
        </button>
        <button
          type="button"
          className="chronicle-transcription-control"
          aria-label={
            pending
              ? "正在处理转录请求"
              : participating
                ? "停止我的转录"
                : state
                  ? "加入转录"
                  : "开始转录"
          }
          disabled={!available || pending}
          aria-pressed={participating}
          title={!available ? "服务器尚未启用纪事" : "房间语音会发送至云端转录，可随时停止提供"}
          onClick={() => void act()}
        >
          {participating ? <MicOff size={14} /> : <Mic size={14} />}
          {pending
            ? "正在处理…"
            : state
              ? participating
                ? "停止我的转录"
                : "加入转录"
              : "开始转录"}
        </button>
      </div>
      <div className="chronicle-source-status">
        <span>{state ? "房间转录中" : "转录未开启"}</span>
        <span
          className="chronicle-source-help"
          data-dismissed={helpDismissed}
          onPointerEnter={() => setHelpDismissed(false)}
        >
          <button
            type="button"
            className="chronicle-source-info"
            aria-label="转录说明"
            aria-describedby={helpId}
            onFocus={() => setHelpDismissed(false)}
            onBlur={() => setHelpDismissed(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setHelpDismissed(true);
              }
            }}
          >
            <Info size={14} aria-hidden="true" />
          </button>
          <span id={helpId} className="chronicle-source-tooltip" role="tooltip">
            <span className="chronicle-source-tooltip-line">
              {message?.day
                ? "云端转录，可退出。全员可看，北京时间零点清空。"
                : "一人开启，语音发送至云端转录，可随时退出。"}
            </span>
            {heard.length ? (
              <span>
                参与：
                {heard
                  .map(({ nickname }) => names.get(nickname.toLowerCase()) ?? nickname)
                  .join("、")}
              </span>
            ) : null}
          </span>
        </span>
        {state ? (
          <span className="chronicle-source-count">
            {heard.length}/{members.length} 人参与转录
          </span>
        ) : null}
      </div>
      {archive.error ? (
        <p className="room-chronicle-hint" role="status">
          {archive.error}
        </p>
      ) : null}
      {error || message?.error || state?.notice ? (
        <p role="status" className="room-chronicle-hint">
          {error ||
            (message?.error === "chronicle_speech_quota"
              ? "语音服务额度不足，暂时无法听取新语音；已有纪事仍保留。"
              : state?.notice === "retrying" || message?.error === "chronicle_busy"
                ? "云端繁忙，后台会自动继续"
                : "纪事服务暂不可用，已有纪事仍保留")}
        </p>
      ) : null}
      <div className="room-list-viewport" data-room-list-edge={archive.entries.length > 0}>
        <div
          ref={listRef}
          className="room-chronicle-entries"
          aria-live="polite"
          aria-relevant="additions"
        >
          {archive.entries.length ? (
            <>
              {archive.entries.length > shown ? (
                <button
                  type="button"
                  className="chronicle-earlier"
                  onClick={() => setShown((count) => count + 60)}
                >
                  查看更早的纪事（共{archive.entries.length}条）
                </button>
              ) : null}
              {stories}
            </>
          ) : (
            <div className="room-chronicle-empty">
              <BookOpen size={26} />
              <p>
                {state
                  ? "收到语音后，纪事会分段出现。"
                  : message?.day
                    ? "今天还没有纪事。"
                    : "开始转录后，可以在这里查看房间纪事。"}
              </p>
            </div>
          )}
        </div>
      </div>
      {status && state ? (
        <p className="room-chronicle-hint" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
