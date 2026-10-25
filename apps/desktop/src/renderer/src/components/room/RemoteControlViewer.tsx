import { useEffect, useRef, useState } from "react";
import type {
  RemoteControlInputEvent,
  RemoteControlLane,
  RemoteControlMouseButton,
  RemoteControlViewerClient,
} from "@private-voice/shared";
import {
  useRemoteControlState,
  remoteControlMessage,
} from "../../features/screen-share/useRemoteControlState";

export function RemoteControlViewer({
  peerId,
  client,
  enabled = true,
}: {
  peerId: string;
  client?: RemoteControlViewerClient;
  enabled?: boolean;
}) {
  const state = useRemoteControlState(client);
  const api = client ?? window.desktopApi?.remoteControl;
  const share = state.remoteShares[peerId],
    pending = state.outgoingRequests[peerId],
    granted = state.remoteGrants[peerId];
  const ref = useRef<HTMLDivElement>(null);
  const heldKeys = useRef(new Set<string>());
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const active = Boolean(enabled && granted && !granted.paused);
  const shareSessionId = share?.shareSessionId;
  useEffect(() => {
    if (!active) heldKeys.current.clear();
  }, [active]);
  useEffect(() => {
    const stop = () => {
      void api?.stopControlling(peerId).catch(() => undefined);
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    if (!enabled) stop();
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [api, peerId, enabled]);
  useEffect(
    () => () => {
      if (api) {
        void api.cancel(peerId).catch(() => undefined);
        void api.stopControlling(peerId).catch(() => undefined);
      }
    },
    [api, peerId],
  );
  useEffect(() => {
    if (!api || !shareSessionId || !active) return;
    const surface = ref.current,
      video = surface?.parentElement?.querySelector("video");
    if (!video?.requestVideoFrameCallback) return;
    let frameId: number;
    const frame = () => {
      api.remoteFrame(peerId, shareSessionId);
      frameId = video.requestVideoFrameCallback(frame);
    };
    frameId = video.requestVideoFrameCallback(frame);
    surface?.focus();
    return () => video.cancelVideoFrameCallback(frameId);
  }, [api, peerId, shareSessionId, active]);
  const send = (event: RemoteControlInputEvent, lane: RemoteControlLane = "reliable") => {
    if (active) {
      if (event.kind === "key") {
        if (event.pressed) heldKeys.current.add(event.code);
        else heldKeys.current.delete(event.code);
      }
      api?.input(peerId, event, lane);
    }
  };
  const point = (clientX: number, clientY: number) => {
    const bounds = ref.current?.getBoundingClientRect(),
      video = ref.current?.parentElement?.querySelector("video");
    if (!bounds || !video?.videoWidth || !video.videoHeight) return;
    const scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight);
    const width = scale * video.videoWidth,
      height = scale * video.videoHeight;
    const x = (clientX - bounds.x - (bounds.width - width) / 2) / width,
      y = (clientY - bounds.y - (bounds.height - height) / 2) / height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
  };
  const isAction = (target: EventTarget) => (target as Element).closest("button,input");
  const buttonFor = (button: number) =>
    ["left", "middle", "right"][button] as RemoteControlMouseButton | undefined;
  if (!api) return null;
  return (
    <div
      ref={ref}
      className={`remote-control-viewer ${active ? "is-active" : ""}`}
      tabIndex={active ? 0 : -1}
      role="group"
      aria-label="远程屏幕操作"
      onBlur={(event) => {
        if (active && !event.currentTarget.contains(event.relatedTarget as Node))
          void api.stopControlling(peerId).catch(() => undefined);
        else if (active && event.relatedTarget !== event.currentTarget) {
          for (const code of [...heldKeys.current]) send({ kind: "key", code, pressed: false });
        }
      }}
      onPointerMove={(event) => {
        if (!isAction(event.target)) {
          const p = point(event.clientX, event.clientY);
          if (p) send({ kind: "pointer", ...p }, "pointer");
        }
      }}
      onPointerDown={(event) => {
        if (isAction(event.target) || !active) return;
        const p = point(event.clientX, event.clientY),
          button = buttonFor(event.button);
        if (!p || !button) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        send({ kind: "button", button, pressed: true, ...p });
      }}
      onPointerUp={(event) => {
        if (!active || isAction(event.target)) return;
        const p = point(event.clientX, event.clientY),
          button = buttonFor(event.button);
        if (!p) {
          void api.stopControlling(peerId).catch(() => undefined);
          return;
        }
        if (button) send({ kind: "button", button, pressed: false, ...p });
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (active) void api.stopControlling(peerId).catch(() => undefined);
      }}
      onContextMenu={(event) => {
        if (active) event.preventDefault();
      }}
      onWheel={(event) => {
        const p = point(event.clientX, event.clientY);
        if (active && p) {
          event.preventDefault();
          send({
            kind: "wheel",
            ...p,
            deltaX: Math.max(-1200, Math.min(1200, event.deltaX)),
            deltaY: Math.max(-1200, Math.min(1200, event.deltaY)),
          });
        }
      }}
      onKeyDown={(event) => {
        if (!active || isAction(event.target)) return;
        event.preventDefault();
        if (event.code === "Escape" && event.ctrlKey && event.altKey) {
          void api.stopControlling(peerId).catch(() => undefined);
          return;
        }
        if (!event.nativeEvent.isComposing)
          send({ kind: "key", code: event.code, pressed: true, repeat: event.repeat });
      }}
      onKeyUp={(event) => {
        if (active && !isAction(event.target)) {
          event.preventDefault();
          send({ kind: "key", code: event.code, pressed: false });
        }
      }}
    >
      <div className="remote-control-viewer-actions">
        {granted ? (
          <>
            <span>{granted.paused ? "对方已暂停操作" : "正在远程操作 · 失去焦点即停止"}</span>
            <button
              type="button"
              onClick={() => void api.stopControlling(peerId).catch(() => undefined)}
            >
              结束操作
            </button>
          </>
        ) : pending ? (
          <>
            <span>等待对方允许</span>
            <button type="button" onClick={() => void api.cancel(peerId).catch(() => undefined)}>
              取消申请
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!enabled || !share?.requestable}
            title={
              share?.requestable ? "需对方明确允许" : "整个显示器分享与双方新版客户端才支持操作"
            }
            onClick={() => {
              setError("");
              void api
                .request(peerId)
                .then((result) => {
                  if (!result.ok) setError(remoteControlMessage(result.reason));
                })
                .catch(() => setError("申请未发送，请重试。"));
            }}
          >
            申请操作
          </button>
        )}
        {active && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (text) {
                send({ kind: "text", text });
                setText("");
                ref.current?.focus();
              }
            }}
          >
            <input
              aria-label="发送文字到远程电脑"
              placeholder="输入文字后回车"
              maxLength={128}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </form>
        )}
        {error && <span role="alert">{error}</span>}
      </div>
    </div>
  );
}
