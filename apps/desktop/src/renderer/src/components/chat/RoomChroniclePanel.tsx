import { useRef, useState, type ReactNode } from "react";
import { BookOpen, Download, Mic, MicOff } from "lucide-react";
import { useRoomStore } from "../../store/roomStore";
import type { RoomChronicleClient } from "../../features/room/RoomChronicleClient";
import { useChronicleArchive } from "../../features/room/useChronicleArchive";

const EMPTY_ENTRIES: [] = [];

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
  const pendingRef = useRef(false);
  const [shown, setShown] = useState(60);
  const archive = useChronicleArchive(room.roomId, message?.state?.entries ?? EMPTY_ENTRIES);
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
          title="导出本机纪事，不包含逐字转录稿"
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
      <details className="chronicle-source-status">
        <summary>
          转录状态{" "}
          <span>
            {heard.length}/{members.length} 人参与转录
          </span>
        </summary>
        {heard.length ? <p>参与：{heard.map((member) => member.nickname).join("、")}</p> : null}
        {state ? <p>语音发送至云端转录，不保存原始转录。</p> : null}
        <small>
          {archive.stored
            ? "纪事保存在本机，并同步至房间回顾。"
            : archive.available
              ? "本机纪事加载中"
              : "仅查看本次纪事"}
        </small>
      </details>
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
      <div className="room-chronicle-entries" aria-live="polite" aria-relevant="additions">
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
            {archive.entries.slice(-shown).map((entry) => (
              <article key={entry.id}>
                <time dateTime={new Date(entry.at).toISOString()}>
                  {new Date(entry.at).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <div>
                  <p>{entry.text}</p>
                </div>
              </article>
            ))}
          </>
        ) : (
          <div className="room-chronicle-empty">
            <BookOpen size={26} />
            <p>{state ? "正在整理房间里的趣事。" : "开始转录后，趣事会显示在这里。"}</p>
          </div>
        )}
      </div>
      {status && participating ? (
        <p className="room-chronicle-hint" role="status">
          {status}
        </p>
      ) : null}
    </section>
  );
}
