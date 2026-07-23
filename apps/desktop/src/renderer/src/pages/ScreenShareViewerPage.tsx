import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  type ScreenShareViewerSignal,
} from "@private-voice/shared";

export const ScreenShareViewerPage = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream>();
  const [fallbackFrame, setFallbackFrame] = useState<string>();
  const sessionId = new URLSearchParams(window.location.search).get("screenViewerSession") ?? "";
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!sessionId) return;
    const peer = new RTCPeerConnection({ iceServers: [] });
    const pendingCandidates: RTCIceCandidateInit[] = [];
    let disposed = false;
    const send = (signal: Omit<ScreenShareViewerSignal, "sessionId" | "sender">) =>
      window.desktopApi.screenShareViewer
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
    const unsubscribe = window.desktopApi.screenShareViewer.onSignal((signal) => {
      if (signal.sessionId !== sessionId || signal.sender !== "host") return;
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
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <motion.main
      className="screen-share-viewer-page"
      initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.992 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : APPLE_MOTION_DURATION.panel,
        ease: APPLE_MOTION_EASE,
      }}
    >
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
          <strong>正在接收共享画面...</strong>
        </div>
      )}
    </motion.main>
  );
};
