import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  type ScreenShareViewerSignal,
  type RemoteControlViewerClient,
} from "@private-voice/shared";

import { usePrefersReducedMotion as useReducedMotion } from "../hooks/usePrefersReducedMotion";
import { RemoteControlViewer } from "../components/room/RemoteControlViewer";
import { useRemoteControlState } from "../features/screen-share/useRemoteControlState";

export const ScreenShareViewerPage = () => {
  const client = useMemo<RemoteControlViewerClient | undefined>(() => {
    const control = window.screenShareViewerApi.control;
    if (!control) return;
    return {
      get: control.get,
      onState: control.onState,
      request: () => control.request(),
      cancel: () => control.cancel(),
      stopControlling: () => control.stop(),
      remoteFrame: () => control.frame(),
      input: (_peer, event, lane) => control.input(event, lane),
    };
  }, []);
  const controlState = useRemoteControlState(client);
  const controlPeer = Object.keys(controlState.remoteShares)[0];
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream>();
  const [fallbackFrame, setFallbackFrame] = useState<string>();
  const [waitingSeconds, setWaitingSeconds] = useState(0);
  const [title, setTitle] = useState("屏幕分享");
  const [isImmersive, setIsImmersive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<number | undefined>(undefined);
  const sessionId = new URLSearchParams(window.location.search).get("screenViewerSession") ?? "";
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!sessionId) return;
    let peer: RTCPeerConnection;
    let hasOffer = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];
    let disposed = false;
    const send = (signal: Omit<ScreenShareViewerSignal, "sessionId" | "sender">) =>
      window.screenShareViewerApi
        .sendSignal({
          ...signal,
          sessionId,
          sender: "viewer",
        })
        .catch(() => false);
    const flushCandidates = async (target: RTCPeerConnection) => {
      while (pendingCandidates.length > 0 && target === peer && !disposed) {
        const candidate = pendingCandidates.shift();
        if (candidate) await target.addIceCandidate(candidate);
      }
    };
    const createPeer = () => {
      const next = new RTCPeerConnection({ iceServers: [] });
      next.onconnectionstatechange = () => {
        if (disposed || peer !== next) return;
        if (["disconnected", "failed", "closed"].includes(next.connectionState)) {
          void client?.stopControlling("").catch(() => undefined);
          setStream(undefined);
        }
      };
      next.ontrack = ({ streams }) => {
        if (disposed || peer !== next) return;
        const nextStream = streams[0];
        if (nextStream) {
          setFallbackFrame(undefined);
          setStream(nextStream);
        }
      };
      next.onicecandidate = ({ candidate }) => {
        if (!candidate || disposed || peer !== next) return;
        const json = candidate.toJSON();
        void send({
          type: "ice",
          candidate: json.candidate,
          sdpMid: json.sdpMid,
          sdpMLineIndex: json.sdpMLineIndex,
        });
      };
      return next;
    };
    peer = createPeer();
    const unsubscribe = window.screenShareViewerApi.onSignal((signal) => {
      if (signal.sessionId !== sessionId || signal.sender !== "host") return;
      if (signal.title) setTitle(signal.title.replace(/^上号\s*·\s*/, ""));
      void (async () => {
        if (signal.type === "ready") {
          void client?.stopControlling("").catch(() => undefined);
          // A new publisher has a new DTLS identity. Its ready handshake must
          // replace the previous receiver rather than renegotiate that identity
          // into an already established connection and leave the viewer loading.
          if (hasOffer) {
            peer.ontrack = peer.onicecandidate = null;
            peer.close();
            pendingCandidates.length = 0;
            peer = createPeer();
            hasOffer = false;
          }
          await send({ type: "ready" });
        } else if (signal.type === "offer" && signal.sdp) {
          hasOffer = true;
          const current = peer;
          await current.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          if (disposed || current !== peer) return;
          await flushCandidates(current);
          if (disposed || current !== peer) return;
          const answer = await current.createAnswer();
          if (disposed || current !== peer) return;
          await current.setLocalDescription(answer);
          if (disposed || current !== peer) return;
          await send({ type: "answer", sdp: answer.sdp });
        } else if (signal.type === "ice" && signal.candidate) {
          const candidate: RTCIceCandidateInit = {
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          };
          if (peer.remoteDescription) await peer.addIceCandidate(candidate);
          else {
            if (pendingCandidates.length >= 64) pendingCandidates.shift();
            pendingCandidates.push(candidate);
          }
        } else if (signal.type === "fallback-frame" && signal.frameDataUrl) {
          void client?.stopControlling("").catch(() => undefined);
          setStream(undefined);
          setFallbackFrame(signal.frameDataUrl);
        } else if (signal.type === "closed") {
          window.close();
        }
      })().catch(() => undefined);
    });
    void send({ type: "ready" });
    return () => {
      disposed = true;
      unsubscribe();
      peer.close();
      void client?.stopControlling("").catch(() => undefined);
      void send({ type: "closed" });
    };
  }, [sessionId, client]);

  useEffect(() => {
    if (stream || fallbackFrame) {
      setWaitingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setWaitingSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [fallbackFrame, stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsImmersive(active);
      setControlsVisible(true);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(
    () => () => {
      if (controlsTimerRef.current !== undefined) {
        window.clearTimeout(controlsTimerRef.current);
      }
    },
    [],
  );

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current !== undefined) {
      window.clearTimeout(controlsTimerRef.current);
    }
    if (isImmersive && (stream || fallbackFrame)) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2_600);
    }
  }, [fallbackFrame, isImmersive, stream]);

  useEffect(() => {
    revealControls();
  }, [revealControls]);

  const toggleImmersive = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setIsImmersive(false);
      setControlsVisible(true);
    }
  };

  return (
    <motion.main
      className={`screen-share-viewer-page ${isImmersive ? "is-immersive" : ""} ${
        controlsVisible ? "has-visible-controls" : "has-hidden-controls"
      }`}
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onDoubleClick={() => {
        if (!controlPeer || !controlState.remoteGrants[controlPeer]) void toggleImmersive();
      }}
      initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.992 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
        ease: APPLE_MOTION_EASE,
      }}
    >
      <AnimatePresence>
        {controlsVisible ? (
          <motion.header
            className="screen-share-viewer-toolbar"
            initial={shouldReduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div>
              <span>屏幕分享</span>
              <strong>{title}</strong>
            </div>
            <div className="screen-share-viewer-actions">
              <button
                type="button"
                onClick={() => void toggleImmersive()}
                title={isImmersive ? "退出沉浸模式" : "进入沉浸模式"}
              >
                {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                <span>{isImmersive ? "退出沉浸" : "沉浸模式"}</span>
              </button>
              <button type="button" onClick={() => window.close()} title="关闭观看窗口">
                <X aria-hidden="true" />
                <span>关闭</span>
              </button>
            </div>
          </motion.header>
        ) : null}
      </AnimatePresence>
      {client && controlPeer && (
        <RemoteControlViewer
          peerId={controlPeer}
          client={client}
          enabled={Boolean(stream && !fallbackFrame)}
        />
      )}
      {stream ? (
        <motion.video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.986 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
            ease: APPLE_MOTION_EASE,
          }}
        />
      ) : fallbackFrame ? (
        <motion.img
          src={fallbackFrame}
          alt="服务器兜底共享画面"
          draggable={false}
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.986 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
            ease: APPLE_MOTION_EASE,
          }}
        />
      ) : (
        <div className="screen-share-viewer-loading">
          <span />
          <strong>{waitingSeconds < 8 ? "正在接收共享画面..." : "画面仍未到达"}</strong>
          {waitingSeconds >= 8 ? (
            <>
              <small>房间连接仍然保留，可以重新请求画面或关闭窗口。</small>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWaitingSeconds(0);
                    void window.screenShareViewerApi.sendSignal({
                      type: "ready",
                      sessionId,
                      sender: "viewer",
                    });
                  }}
                >
                  重新连接
                </button>
                <button type="button" onClick={() => window.close()}>
                  关闭窗口
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </motion.main>
  );
};
