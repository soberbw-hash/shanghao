import { useState } from "react";
import type { RemoteControlDuration, RemoteControlResult } from "@private-voice/shared";
import {
  useRemoteControlState,
  remoteControlMessage,
} from "../../features/screen-share/useRemoteControlState";
import { useRoomStore } from "../../store/roomStore";

/** Consent is an explicit local action, scoped to the current screen share. */
export function RemoteControlStatus() {
  const state = useRemoteControlState();
  const members = useRoomStore((store) => store.room.members);
  const [duration, setDuration] = useState<RemoteControlDuration>("ten-minutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const api = window.desktopApi.remoteControl;
  const request = state.incomingRequests[0],
    grant = state.host.grant;
  const active = grant && ["active", "paused"].includes(state.host.phase);
  const name = (peer: string) => members.find((member) => member.id === peer)?.nickname ?? "朋友";
  const run = async (operation: () => Promise<RemoteControlResult<unknown>>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await operation();
      if (!result.ok) setError(remoteControlMessage(result.reason));
    } catch {
      setError("操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  if (!api || (!request && !active && !error)) return null;
  return (
    <section className="remote-control-status" aria-label="远程协助">
      {request && !active ? (
        <>
          <div>
            <strong>{name(request.binding.controller.peerId)} 申请操作你的屏幕</strong>
            <p>允许后，对方可以使用鼠标和键盘；仅本次屏幕分享有效。</p>
          </div>
          <label>
            授权时长
            <select
              value={duration}
              disabled={busy}
              onChange={(event) => setDuration(event.target.value as RemoteControlDuration)}
            >
              <option value="ten-minutes">10 分钟</option>
              <option value="share-lifetime">本次分享期间</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.deny(request.requestId))}
          >
            拒绝
          </button>
          <button
            type="button"
            disabled={busy}
            className="is-primary"
            onClick={() => void run(() => api.approve(request.requestId, duration))}
          >
            {busy ? "准备中…" : "允许操作"}
          </button>
        </>
      ) : active ? (
        <>
          <div>
            <strong>
              {name(grant.binding.controller.peerId)} ·{" "}
              {state.host.phase === "paused" ? "操作已暂停" : "正在操作你的屏幕"}
            </strong>
            <p>随时移动本机鼠标或按 Ctrl + Alt + Esc 立即收回。</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => (state.host.phase === "paused" ? api.resume() : api.pause()))
            }
          >
            {state.host.phase === "paused" ? "恢复操作" : "暂停"}
          </button>
          <button
            type="button"
            onClick={() =>
              void api.revoke().catch(() => setError("收回失败，请按 Ctrl + Alt + Esc。"))
            }
          >
            收回控制
          </button>
        </>
      ) : null}
      {error && (
        <p role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            知道了
          </button>
        </p>
      )}
    </section>
  );
}
