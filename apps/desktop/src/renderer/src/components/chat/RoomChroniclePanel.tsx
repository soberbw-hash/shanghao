import { useState, type ReactNode } from "react";
import { BookOpen, Mic, MicOff } from "lucide-react";
import { useRoomStore } from "../../store/roomStore";
import type { RoomChronicleClient } from "../../features/room/RoomChronicleClient";

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
  const localId = useRoomStore((state) => state.room.members.find((member) => member.isLocal)?.id);
  const state = message?.state;
  const participating = !!localId && !!state?.participants.includes(localId);
  const [error, setError] = useState("");
  const act = async () => {
    setError("");
    try {
      if (!transport) throw Error();
      await transport.control(state ? "participate" : "start", state?.sessionId, !participating);
    } catch {
      setError("当前连接暂不可用，请稍后再试");
    }
  };
  const available = message?.available === true;
  return (
    <section className="room-chronicle" aria-label="房间纪事">
      <div className="room-chronicle-toolbar">
        {replayControl}
        <button
          type="button"
          aria-label={participating ? "停止提供纪事语音" : "开始提供纪事语音"}
          disabled={!available}
          aria-pressed={participating}
          title={!available ? "服务器尚未启用纪事" : "只处理主动参与者的语音，与录音库独立"}
          onClick={() => void act()}
        >
          {participating ? <MicOff size={14} /> : <Mic size={14} />}
          {state ? (participating ? "停止提供语音" : "提供我的语音") : "开始记录"}
        </button>
      </div>
      {error || message?.error || state?.notice ? (
        <p role="status" className="room-chronicle-hint">
          {error ||
            (state?.notice === "retrying" || message?.error === "chronicle_busy"
              ? "云端繁忙，后台会自动继续"
              : "纪事服务暂不可用，已有纪事仍保留")}
        </p>
      ) : null}
      <div className="room-chronicle-entries" aria-live="polite" aria-relevant="additions">
        {state?.entries.length ? (
          state.entries.map((entry) => (
            <article key={entry.id}>
              <time dateTime={new Date(entry.at).toISOString()}>
                {new Date(entry.at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <p>{entry.text}</p>
            </article>
          ))
        ) : (
          <div className="room-chronicle-empty">
            <BookOpen size={26} />
            <p>{state ? "听着呢，有值得记的一会儿就来。" : "一人开启，全房间同步查看。"}</p>
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
