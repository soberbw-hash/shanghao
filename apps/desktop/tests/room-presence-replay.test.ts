import assert from "node:assert/strict";
import test from "node:test";

import type { SignalEnvelope } from "@private-voice/signaling";

test("presence detected before join is replayed once signaling is ready", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        app: { writeLog: async () => undefined },
      },
    },
  });

  const { RoomClient } = await import("../src/renderer/src/features/room/roomClient");
  const client = new RoomClient({
    signalingUrl: "ws://127.0.0.1:43821/",
    roomId: "main",
    peerId: "peer-local",
    profileId: "profile-local",
    nickname: "Sober",
    localStream: {
      getAudioTracks: () => [],
    } as unknown as MediaStream,
    appVersion: "test",
    protocolVersion: "5",
    buildNumber: "test",
    onMembers: () => undefined,
    onRoomName: () => undefined,
    onConnectionState: () => undefined,
    onRemoteStream: () => undefined,
    onChatMessage: () => undefined,
    onChatHistory: () => undefined,
    onRoomCollection: () => undefined,
    onKnock: () => undefined,
    onRemoteScreenFrame: () => undefined,
    onSceneReaction: () => undefined,
  });
  const sent: SignalEnvelope[] = [];
  const internals = client as unknown as {
    isSignalingConnected: boolean;
    joinAckReceived: boolean;
    safeSend: (payload: SignalEnvelope) => Promise<boolean>;
    publishDesiredPresence: () => Promise<void>;
  };
  internals.safeSend = async (payload) => {
    sent.push(payload);
    return true;
  };

  client.updatePresenceState(false, "idle", "gameDesk1", undefined, {
    provider: "netease",
    providerName: "网易云音乐",
    trackTitle: "一路向北",
    artist: "周杰伦",
  });
  await Promise.resolve();
  assert.equal(sent.length, 0);

  internals.isSignalingConnected = true;
  internals.joinAckReceived = true;
  await internals.publishDesiredPresence();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, "member_state");
  assert.deepEqual(sent[0]?.type === "member_state" ? sent[0].musicActivity : undefined, {
    provider: "netease",
    providerName: "网易云音乐",
    trackTitle: "一路向北",
    artist: "周杰伦",
  });

  client.updatePresenceState(false, "idle", "gameDesk1", undefined, {
    provider: "netease",
    providerName: "网易云音乐",
    trackTitle: "一路向北",
    artist: "周杰伦",
  });
  await Promise.resolve();
  assert.equal(sent.length, 1);
});
