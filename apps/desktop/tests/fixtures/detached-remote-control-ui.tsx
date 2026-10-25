import { createRoot } from "react-dom/client";
import type {
  RemoteControlServiceSnapshot,
  ScreenShareViewerApi,
  ScreenShareViewerSignal,
} from "@private-voice/shared";
import { ScreenShareViewerPage } from "../../src/renderer/src/pages/ScreenShareViewerPage";
import "../../src/renderer/src/styles/index.css";

const owner = {
  peerId: "friend",
  deviceId: "friend-device",
  memberSessionId: "friend-session",
  memberGeneration: 1,
};
const share = {
  roomId: "fixture",
  shareSessionId: "share",
  captureHandle: "capture",
  displayId: "display",
  geometryVersion: 1,
  owner,
  kind: "screen" as const,
  width: 640,
  height: 360,
  requestable: true,
};
let state: RemoteControlServiceSnapshot = {
  host: { phase: "idle", requests: [] },
  incomingRequests: [],
  remoteShares: { friend: share },
  outgoingRequests: {},
  remoteGrants: {},
};
const listeners = new Set<(value: RemoteControlServiceSnapshot) => void>();
const signals = new Set<(value: ScreenShareViewerSignal) => void>();
const evidence = { requests: 0, frames: 0, stops: 0, inputs: [] as unknown[] };
const publish = () => {
  state = structuredClone(state);
  listeners.forEach((fn) => fn(state));
};
const grant = () => {
  state.remoteGrants.friend = {
    paused: false,
    grant: {
      grantId: "mock-grant",
      generation: 1,
      binding: {
        roomId: share.roomId,
        shareSessionId: share.shareSessionId,
        captureHandle: share.captureHandle,
        displayId: share.displayId,
        geometryVersion: 1,
        target: owner,
        controller: { ...owner, peerId: "local" },
      },
      permissions: ["pointer", "keyboard", "text"],
      issuedAtMs: 0,
      expiresAtMs: null,
    },
  };
  publish();
};
const canvas = document.createElement("canvas");
canvas.width = 640;
canvas.height = 360;
const stream = canvas.captureStream(10),
  peer = new RTCPeerConnection({ iceServers: [] });
peer.addTrack(stream.getVideoTracks()[0]!, stream);
let n = 0;
setInterval(() => {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = n++ % 2 ? "#cce1f5" : "#d6e8f8";
  ctx.fillRect(0, 0, 640, 360);
}, 100);
const emit = (message: Omit<ScreenShareViewerSignal, "sessionId" | "sender">) =>
  signals.forEach((fn) => fn({ ...message, sessionId: "fixture-viewer", sender: "host" }));
peer.onicecandidate = ({ candidate }) => {
  if (candidate) emit({ type: "ice", ...candidate.toJSON() });
};
const api: ScreenShareViewerApi = {
  control: {
    get: async () => state,
    onState: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    request: async () => {
      evidence.requests++;
      return { ok: true, value: undefined };
    },
    cancel: async () => {},
    stop: async () => {
      evidence.stops++;
      delete state.remoteGrants.friend;
      publish();
    },
    frame: () => {
      evidence.frames++;
    },
    input: (event, lane) => {
      evidence.inputs.push({ event, lane });
    },
  },
  close: async () => {},
  onSignal: (fn) => {
    signals.add(fn);
    return () => {
      signals.delete(fn);
    };
  },
  sendSignal: async (message) => {
    if (message.type === "ready") {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      emit({ type: "offer", sdp: offer.sdp });
    }
    if (message.type === "answer")
      await peer.setRemoteDescription({ type: "answer", sdp: message.sdp });
    if (message.type === "ice")
      await peer.addIceCandidate({
        candidate: message.candidate,
        sdpMid: message.sdpMid,
        sdpMLineIndex: message.sdpMLineIndex,
      });
    return true;
  },
};
window.screenShareViewerApi = api;
Object.assign(window, {
  detachedEvidence: evidence,
  allowDetached: grant,
  pauseDetached: () => {
    state.remoteGrants.friend!.paused = true;
    publish();
  },
  resumeDetached: () => {
    state.remoteGrants.friend!.paused = false;
    publish();
  },
  fallbackDetached: () => emit({ type: "fallback-frame", frameDataUrl: canvas.toDataURL() }),
});
createRoot(document.getElementById("root")!).render(<ScreenShareViewerPage />);
