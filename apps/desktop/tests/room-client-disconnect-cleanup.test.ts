import assert from "node:assert/strict";
import test from "node:test";

test("room exit releases screen audio resources even if microphone restoration fails", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let signalingClosed = 0;
  let mixerDisposed = 0;
  let screenTracksStopped = 0;
  let disconnected = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        app: { writeLog: async () => undefined },
        signaling: {
          close: async () => {
            signalingClosed += 1;
          },
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { RoomClient } = await import("../src/renderer/src/features/room/roomClient");
  const client = new RoomClient({
    signalingUrl: "ws://127.0.0.1:1/",
    roomId: "room-a",
    peerId: "local",
    profileId: "local",
    nickname: "Local",
    localStream: {
      getAudioTracks: () => [{ readyState: "live" }],
    } as unknown as MediaStream,
    appVersion: "test",
    protocolVersion: "5",
    buildNumber: "test",
    onMembers: () => undefined,
    onRoomName: () => undefined,
    onConnectionState: () => {
      disconnected += 1;
    },
    onRemoteStream: () => undefined,
    onChatMessage: () => undefined,
    onChatHistory: () => undefined,
    onRoomCollection: () => undefined,
    onKnock: () => undefined,
    onRemoteScreenFrame: () => undefined,
    onSceneReaction: () => undefined,
  });
  const internals = client as unknown as {
    screenAudioMixer: {
      hasActiveMix: () => boolean;
      dispose: () => void;
    };
    screenShareCoordinator: {
      activeStream: MediaStream;
      stopTracks: () => void;
      clear: () => void;
    };
    applyOutgoingAudioTrack: () => Promise<void>;
  };
  internals.screenAudioMixer = {
    hasActiveMix: () => true,
    dispose: () => {
      mixerDisposed += 1;
    },
  };
  internals.screenShareCoordinator = {
    activeStream: {} as MediaStream,
    stopTracks: () => {
      screenTracksStopped += 1;
    },
    clear: () => undefined,
  };
  internals.applyOutgoingAudioTrack = async () => {
    throw new Error("replace_track_failed");
  };

  await client.disconnect();
  assert.equal(mixerDisposed, 1);
  assert.equal(screenTracksStopped, 1);
  assert.equal(signalingClosed, 1);
  assert.equal(disconnected, 1);
});

test("concurrent room exits await the same cleanup operation", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let finishClose: (() => void) | undefined;
  let closeCalls = 0;
  let disconnected = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: {
        app: { writeLog: async () => undefined },
        signaling: {
          close: () => {
            closeCalls += 1;
            return new Promise<void>((resolve) => {
              finishClose = resolve;
            });
          },
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { RoomClient } = await import("../src/renderer/src/features/room/roomClient");
  const client = new RoomClient({
    signalingUrl: "ws://127.0.0.1:1/",
    roomId: "room-a",
    peerId: "local",
    profileId: "local",
    nickname: "Local",
    localStream: { getAudioTracks: () => [] } as unknown as MediaStream,
    appVersion: "test",
    protocolVersion: "5",
    buildNumber: "test",
    onMembers: () => undefined,
    onRoomName: () => undefined,
    onConnectionState: () => {
      disconnected += 1;
    },
    onRemoteStream: () => undefined,
    onChatMessage: () => undefined,
    onChatHistory: () => undefined,
    onRoomCollection: () => undefined,
    onKnock: () => undefined,
    onRemoteScreenFrame: () => undefined,
    onSceneReaction: () => undefined,
  });

  const first = client.disconnect();
  const second = client.disconnect();
  assert.strictEqual(second, first);
  assert.equal(closeCalls, 1);
  assert.equal(disconnected, 0);
  assert.ok(finishClose);
  finishClose();
  await Promise.all([first, second]);
  assert.equal(disconnected, 1);
});

test("a replacement room connection settles the old attempt and ignores its late failure", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const connectAttempts: Array<{ reject: (error: Error) => void }> = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      setTimeout,
      clearTimeout,
      desktopApi: {
        app: { writeLog: async () => undefined },
        signaling: {
          onEvent: () => () => undefined,
          connect: () =>
            new Promise<void>((_resolve, reject) => {
              connectAttempts.push({ reject });
            }),
          close: async () => undefined,
        },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { RoomClient } = await import("../src/renderer/src/features/room/roomClient");
  const client = new RoomClient({
    signalingUrl: "ws://127.0.0.1:1/",
    roomId: "room-a",
    peerId: "local",
    profileId: "local",
    nickname: "Local",
    localStream: { getAudioTracks: () => [] } as unknown as MediaStream,
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

  const oldAttempt = client.connect();
  const oldSettled = assert.rejects(oldAttempt, /signaling_session_superseded/);
  const currentAttempt = client.connect();
  const currentSettled = assert.rejects(currentAttempt, /room_client_disconnected/);
  await oldSettled;
  assert.equal(connectAttempts.length, 2);

  connectAttempts[0]!.reject(new Error("old_socket_failed"));
  await Promise.resolve();
  await client.disconnect();
  await currentSettled;
});
