import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  type ScreenShareViewerSignal,
} from "@private-voice/shared";

import { usePrefersReducedMotion as useReducedMotion } from "../hooks/usePrefersReducedMotion";

export const ScreenShareViewerPage = () => {
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
    const peer = new RTCPeerConnection({ iceServers: [] });
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
    const flushCandidates = async () => {
      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        if (candidate) await peer.addIceCandidate(candidate);
      }
    };
    peer.ontrack = ({ streams }) => {
      const nextStream = streams[0];
      if (nextStream) {
        setFallbackFrame(undefined);
        setStream(nextStream);
      }
    };
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || disposed) return;
      const json = candidate.toJSON();
      void send({
        type: "ice",
        candidate: json.candidate,
        sdpMid: json.sdpMid,
        sdpMLineIndex: json.sdpMLineIndex,
      });
    };
    const unsubscribe = window.screenShareViewerApi.onSignal((signal) => {
      if (signal.sessionId !== sessionId || signal.sender !== "host") return;
      if (signal.title) setTitle(signal.title.replace(/^上号\s*·\s*/, ""));
      void (async () => {
        if (signal.type === "ready") {
          await send({ type: "ready" });
        } else if (signal.type === "offer" && signal.sdp) {
          await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          await flushCandidates();
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await send({ type: "answer", sdp: answer.sdp });
        } else if (signal.type === "ice" && signal.candidate) {
          const candidate: RTCIceCandidateInit = {
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          };
          if (peer.remoteDescription) await peer.addIceCandidate(candidate);
          else pendingCandidates.push(candidate);
        } else if (signal.type === "fallback-frame" && signal.frameDataUrl) {
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
      void send({ type: "closed" });
    };
  }, [sessionId]);

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
      onDoubleClick={() => void toggleImmersive()}
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
