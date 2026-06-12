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
    appVersion: "0.1.21",
    buildNumber: "test",
    directHostProbe: {
      selectedHost: "2409:8a55:3560:9160:a0dd:f240:fc18:78ce",
      selectedPort: 43821,
      addressSource: "public_ip",
      upnpAttempted: false,
      upnpMapped: false,
      natPmpAttempted: false,
      natPmpMapped: false,
      reachability: "reachable",
      natTendency: "direct_friendly",
      message: "verified",
    },
  };

  const inviteUrl = buildShareableInviteUrl(session);

  assert.equal(
    inviteUrl.startsWith("ws://[2409:8a55:3560:9160:a0dd:f240:fc18:78ce]:43821/"),
    true,
  );
  assert.equal(inviteUrl.includes("candidate="), false);
});

test("direct-host invite remains unavailable while public reachability is unverified", () => {
  const session: HostSessionInfo = {
    roomId: "pending-room",
    roomName: "Pending room",
    hostDisplayName: "host",
    signalingPort: 43821,
    signalingUrl: "ws://203.0.113.1:43821/?roomId=pending-room&mode=direct_host",
    connectionMode: "direct_host",
    hostState: HostSessionState.Active,
    hostAddress: "203.0.113.1",
    addressSource: "public_ip",
    protocolVersion: "1",
    appVersion: "0.1.21",
    buildNumber: "test",
    directHostProbe: {
      selectedHost: "203.0.113.1",
      selectedPort: 43821,
      addressSource: "public_ip",
      upnpAttempted: false,
      upnpMapped: false,
      natPmpAttempted: false,
      natPmpMapped: false,
      reachability: "unverified",
      natTendency: "restricted",
      message: "unverified",
    },
  };

  assert.equal(buildShareableInviteUrl(session), "");
});

test("cloudflare invite requires wss and complete metadata", () => {
  const base = "trycloudflare-room.example";
  assert.equal(
    buildShareableInviteUrl({
      roomId: "cloudflare-room",
      roomName: "Cloudflare room",
      hostDisplayName: "host",
      signalingUrl: `wss://${base}/?roomId=cloudflare-room&mode=cloudflare_tunnel&protocolVersion=1&buildNumber=test`,
      connectionMode: "cloudflare_tunnel",
      hostState: HostSessionState.Active,
      hostAddress: `wss://${base}`,
      addressSource: "cloudflare_tunnel",
      protocolVersion: "1",
      appVersion: "0.1.21",
      buildNumber: "test",
      cloudflareTunnel: {
        isInstalled: true,
        processState: "active",
        tunnelUrl: `https://${base}`,
        message: "active",
      },
    }),
    `wss://${base}/?roomId=cloudflare-room&mode=cloudflare_tunnel&protocolVersion=1&buildNumber=test`,
  );
  assert.equal(
    buildShareableInviteUrl({
      roomId: "cloudflare-room",
      roomName: "Cloudflare room",
      hostDisplayName: "host",
      signalingUrl: `ws://${base}/?roomId=cloudflare-room&mode=cloudflare_tunnel&protocolVersion=1&buildNumber=test`,
      connectionMode: "cloudflare_tunnel",
      hostState: HostSessionState.Active,
      hostAddress: `ws://${base}`,
      addressSource: "cloudflare_tunnel",
      protocolVersion: "1",
      appVersion: "0.1.21",
      buildNumber: "test",
      cloudflareTunnel: {
        isInstalled: true,
        processState: "active",
        tunnelUrl: `https://${base}`,
        message: "active",
      },
    }),
    "",
  );
});
