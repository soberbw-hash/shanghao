import { createRoot } from "react-dom/client";
import { useEffect, useRef } from "react";
import type {
  DesktopApi,
  RemoteControlApi,
  RemoteControlServiceSnapshot,
  RemoteControlBinding,
} from "@private-voice/shared";
import { RemoteControlStatus } from "../../src/renderer/src/components/room/RemoteControlStatus";
import { RemoteControlViewer } from "../../src/renderer/src/components/room/RemoteControlViewer";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import "../../src/renderer/src/styles/index.css";

const local = {
  peerId: "local",
  deviceId: "device-local",
  memberSessionId: "session-local",
  memberGeneration: 1,
};
const friend = {
  ...local,
  peerId: "friend",
  deviceId: "device-friend",
  memberSessionId: "session-friend",
};
const binding: RemoteControlBinding = {
  roomId: "fixture-room",
  shareSessionId: "share",
  captureHandle: "handle",
  displayId: "display",
  geometryVersion: 1,
  target: local,
  controller: friend,
};
const share = {
  roomId: "fixture-room",
  shareSessionId: "remote-share",
  captureHandle: "remote-handle",
  displayId: "remote-display",
  geometryVersion: 1,
  owner: friend,
  kind: "screen" as const,
  width: 640,
  height: 360,
  requestable: true,
};
let snapshot: RemoteControlServiceSnapshot = {
  host: { phase: "idle", requests: [] },
  incomingRequests: [],
  remoteShares: { friend: share },
  outgoingRequests: {},
  remoteGrants: {},
};
const listeners = new Set<(value: RemoteControlServiceSnapshot) => void>();
const evidence = {
  approved: 0,
  revoked: 0,
  requested: 0,
  frames: 0,
  inputs: [] as unknown[],
  nativeStarted: 0,
};
const publish = () => {
  snapshot = structuredClone(snapshot);
  for (const listener of listeners) listener(snapshot);
};
const api: RemoteControlApi = {
  get: async () => structuredClone(snapshot),
  getCapture: async () => undefined,
  captureFrame: () => {},
  endCapture: async () => {},
  peerCapability: () => {},
  receive: () => {},
  onOutgoing: () => () => {},
  approve: async (requestId) => {
    evidence.approved++;
    snapshot.host = {
      phase: "active",
      requests: [],
      grant: {
        grantId: "local-grant",
        generation: 1,
        binding,
        permissions: ["pointer", "keyboard", "text"],
        issuedAtMs: performance.now(),
        expiresAtMs: null,
      },
    };
    snapshot.incomingRequests = snapshot.incomingRequests.filter((r) => r.requestId !== requestId);
    publish();
    return { ok: true, value: undefined };
  },
  deny: async () => {
    snapshot.incomingRequests = [];
    publish();
    return { ok: true, value: undefined };
  },
  pause: async () => {
    snapshot.host.phase = "paused";
    publish();
    return { ok: true, value: undefined };
  },
  resume: async () => {
    snapshot.host.phase = "active";
    publish();
    return { ok: true, value: undefined };
  },
  revoke: async () => {
    evidence.revoked++;
    snapshot.host = { phase: "revoked", requests: [] };
    publish();
  },
  request: async () => {
    evidence.requested++;
    snapshot.remoteGrants.friend = {
      paused: false,
      grant: {
        grantId: "remote-grant",
        generation: 1,
        binding: {
          ...binding,
          shareSessionId: share.shareSessionId,
          captureHandle: share.captureHandle,
          target: friend,
          controller: local,
        },
        permissions: ["pointer", "keyboard", "text"],
        issuedAtMs: performance.now(),
        expiresAtMs: null,
      },
    };
    publish();
    return { ok: true, value: undefined };
  },
  cancel: async () => {},
  stopControlling: async () => {
    delete snapshot.remoteGrants.friend;
    publish();
  },
  remoteFrame: () => {
    evidence.frames++;
  },
  input: (_peer, event, lane) => evidence.inputs.push({ event, lane }),
  onState: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
window.desktopApi = { remoteControl: api } as DesktopApi;
Object.assign(window, {
  remoteEvidence: evidence,
  incomingControl: () => {
    snapshot.incomingRequests = [
      {
        requestId: "request",
        binding,
        requestedAtMs: performance.now(),
        expiresAtMs: performance.now() + 30_000,
      },
    ];
    publish();
  },
});
useRoomStore.setState({
  room: {
    ...useRoomStore.getState().room,
    members: [{ id: "friend", nickname: "测试朋友" }] as never,
  },
});

function Fixture() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext("2d")!;
    let n = 0;
    const stream = canvas.captureStream(10);
    const video = ref.current!;
    video.srcObject = stream;
    void video.play();
    const timer = setInterval(() => {
      context.fillStyle = n++ % 2 ? "#cce1f5" : "#d6e8f8";
      context.fillRect(0, 0, 640, 360);
    }, 100);
    return () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return (
    <main style={{ padding: 32, background: "#edf5ff", minHeight: "100vh" }}>
      <h1 style={{ marginBottom: 20 }}>远程协助</h1>
      <RemoteControlStatus />
      <div
        className="screen-share-video-shell"
        style={{
          width: 700,
          height: 450,
          marginTop: 24,
          background: "#17314d",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <video
          ref={ref}
          muted
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
        <RemoteControlViewer peerId="friend" />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
