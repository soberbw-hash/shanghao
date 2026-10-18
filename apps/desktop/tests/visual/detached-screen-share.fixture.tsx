import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScreenShareViewerSignal } from "@private-voice/shared";
import { ScreenShareViewerPage } from "../../src/renderer/src/pages/ScreenShareViewerPage";
import { DetachedScreenSharePublisher } from "../../src/renderer/src/features/screen-share/DetachedScreenSharePublisher";
import "../../src/renderer/src/styles/index.css";

const hostListeners = new Set<(signal: ScreenShareViewerSignal) => void>();
const viewerListeners = new Set<(signal: ScreenShareViewerSignal) => void>();
window.desktopApi = {
  screenShareViewer: {
    onSignal: (callback: (signal: ScreenShareViewerSignal) => void) => {
      hostListeners.add(callback);
      return () => hostListeners.delete(callback);
    },
    sendSignal: async (signal: ScreenShareViewerSignal) => {
      queueMicrotask(() => viewerListeners.forEach((callback) => callback(signal)));
      return true;
    },
  },
} as typeof window.desktopApi;
window.screenShareViewerApi = {
  onSignal: (callback: (signal: ScreenShareViewerSignal) => void) => {
    viewerListeners.add(callback);
    return () => viewerListeners.delete(callback);
  },
  sendSignal: async (signal: ScreenShareViewerSignal) => {
    queueMicrotask(() => hostListeners.forEach((callback) => callback(signal)));
    return true;
  },
} as typeof window.screenShareViewerApi;

const gather = (peer: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (peer.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const change = () => {
      if (peer.iceGatheringState === "complete") {
        peer.removeEventListener("icegatheringstatechange", change);
        resolve();
      }
    };
    peer.addEventListener("icegatheringstatechange", change);
  });
const Fixture = () => {
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 270;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const paint = () => {
      context.fillStyle = frame++ % 2 ? "#528fdf" : "#70adf0";
      context.fillRect(0, 0, 480, 270);
      context.fillStyle = "#fff";
      context.font = "24px sans-serif";
      context.fillText("Screen share verification", 50, 140);
    };
    paint();
    const timer = window.setInterval(paint, 33);
    const capture = canvas.captureStream(30);
    const sender = new RTCPeerConnection({ iceServers: [] }),
      receiver = new RTCPeerConnection({ iceServers: [] });
    let disposed = false,
      publisher: DetachedScreenSharePublisher | undefined;
    void (async () => {
      const remote = new Promise<MediaStream>((resolve) => {
        receiver.ontrack = (event) => resolve(event.streams[0]!);
      });
      capture.getTracks().forEach((track) => sender.addTrack(track, capture));
      await sender.setLocalDescription(await sender.createOffer());
      await gather(sender);
      await receiver.setRemoteDescription(sender.localDescription!);
      await receiver.setLocalDescription(await receiver.createAnswer());
      await gather(receiver);
      await sender.setRemoteDescription(receiver.localDescription!);
      const received = await remote;
      if (disposed) return;
      publisher = new DetachedScreenSharePublisher({
        sessionId: "fixture-share",
        title: "远端屏幕测试",
        stream: received,
        onClosed: () => {
          if (!disposed) setError("publisher_closed");
        },
      });
      publisher.start();
    })().catch((cause) => {
      if (!disposed) setError(String(cause));
    });
    return () => {
      disposed = true;
      window.clearInterval(timer);
      publisher?.destroy();
      sender.close();
      receiver.close();
      capture.getTracks().forEach((track) => track.stop());
    };
  }, [generation]);
  return (
    <>
      <ScreenShareViewerPage />
      <button id="fixture-restart" onClick={() => setGeneration((value) => value + 1)}>
        切换测试轨道
      </button>
      <output id="fixture-error">{error}</output>
    </>
  );
};
const runtime = globalThis as typeof globalThis & { detachedFixtureRoot?: Root };
runtime.detachedFixtureRoot ??= createRoot(document.getElementById("root")!);
runtime.detachedFixtureRoot.render(<Fixture />);
