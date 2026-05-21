import assert from "node:assert/strict";
import test from "node:test";

import { HostSessionState, type HostSessionInfo } from "@private-voice/shared";

import { buildShareableInviteUrl } from "../src/renderer/src/utils/invite";

test("shareable direct-host invite wraps ipv6 hosts in url brackets", () => {
  const session: HostSessionInfo = {
    roomId: "ipv6-room",
    roomName: "IPv6 room",
    hostDisplayName: "host",
    signalingPort: 43821,
    signalingUrl: "",
    localSignalingUrl: "ws://127.0.0.1:43821/?roomId=ipv6-room",
    connectionMode: "direct_host",
    hostState: HostSessionState.Active,
    hostAddress: "2409:8a55:3560:9160:a0dd:f240:fc18:78ce",
    addressSource: "public_ip",
    alternativeAddresses: ["192.168.1.2"],
    protocolVersion: "1",
    appVersion: "0.1.20",
    buildNumber: "test",
  };

  const inviteUrl = buildShareableInviteUrl(session);

  assert.equal(
    inviteUrl.startsWith("ws://[2409:8a55:3560:9160:a0dd:f240:fc18:78ce]:43821/"),
    true,
  );
  assert.equal(inviteUrl.includes("candidate=ws%3A%2F%2F192.168.1.2%3A43821"), true);
});
