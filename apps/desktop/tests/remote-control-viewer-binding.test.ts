import test from "node:test";
import assert from "node:assert/strict";
import { RemoteControlViewerBinding } from "../src/main/remote-control-viewer-binding";
import type { RemoteControlService } from "../src/main/remote-control-service";
import type { RemoteControlServiceSnapshot } from "@private-voice/shared";

function fixture() {
  const owner = {
    peerId: "friend",
    deviceId: "device",
    memberSessionId: "session",
    memberGeneration: 1,
  };
  const state: RemoteControlServiceSnapshot = {
    host: { phase: "idle", requests: [] },
    incomingRequests: [],
    remoteShares: {
      friend: {
        roomId: "room",
        shareSessionId: "share",
        captureHandle: "capture",
        displayId: "display",
        geometryVersion: 1,
        owner,
        kind: "screen",
        width: 1920,
        height: 1080,
        requestable: true,
      },
    },
    outgoingRequests: {},
    remoteGrants: {},
  };
  const calls: string[] = [];
  const binding = new RemoteControlViewerBinding();
  binding.configure({
    snapshot: () => state,
    cancelRequest: (peer: string) => calls.push(`cancel:${peer}`),
    stopControlling: (peer: string) => calls.push(`stop:${peer}`),
  } as unknown as RemoteControlService);
  binding.bind(10, "viewer-session", "friend");
  return { state, calls, binding };
}
test("viewer Main binding accepts only the current contents and projects a single peer without host authority", () => {
  const { binding, state } = fixture();
  assert.equal(binding.peer(10), "friend");
  assert.equal(binding.peer(11), undefined);
  state.host.phase = "active";
  state.incomingRequests = [{ requestId: "secret" } as never];
  assert.deepEqual(binding.snapshot(10).host, { phase: "idle", requests: [] });
  assert.deepEqual(binding.snapshot(10).incomingRequests, []);
  assert.deepEqual(binding.snapshot(11).remoteShares, {});
});
for (const field of [
  "roomId",
  "shareSessionId",
  "captureHandle",
  "displayId",
  "geometryVersion",
  "owner",
] as const) {
  test(`viewer ${field} change invalidates the binding and stops its control`, () => {
    const { binding, state, calls } = fixture();
    const share = state.remoteShares.friend!;
    if (field === "owner") share.owner.memberGeneration++;
    else if (field === "geometryVersion") share.geometryVersion++;
    else share[field] = "changed";
    assert.equal(binding.peer(10), undefined);
    assert.deepEqual(calls, ["cancel:friend", "stop:friend"]);
    assert.equal(binding.peer(10), undefined);
    assert.equal(calls.length, 2);
  });
}
test("replacing viewer stops the old grant; late old-window cleanup cannot stop the new one", () => {
  const { binding, calls } = fixture();
  binding.bind(20, "new-session", "friend");
  assert.deepEqual(calls, ["cancel:friend", "stop:friend"]);
  binding.clear(10);
  binding.stop(10);
  assert.equal(binding.peer(20), "friend");
  assert.equal(calls.length, 2);
  binding.stop(20);
  assert.equal(calls.length, 4);
});
test("share disappearance and local-only viewing give no remote control capability", () => {
  const { binding, state } = fixture();
  delete state.remoteShares.friend;
  assert.equal(binding.peer(10), undefined);
  binding.bind(20, "local-session");
  assert.deepEqual(binding.snapshot(20).remoteShares, {});
});
