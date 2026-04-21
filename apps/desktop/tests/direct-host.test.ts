import assert from "node:assert/strict";
import test from "node:test";

import { resolveDirectHostReachability } from "../src/main/direct-host";

test("direct host treats LAN fallback as immediately shareable inside the same local network", () => {
  const result = resolveDirectHostReachability({
    selectedHost: "192.168.31.193",
    probeSucceeded: false,
    addressSource: "lan_ipv4",
    upnpMapped: false,
    natPmpMapped: false,
  });

  assert.equal(result.reachability, "reachable");
  assert.equal(result.message.includes("局域网地址已准备好"), true);
});

test("direct host keeps a candidate address when self-verification is unavailable", () => {
  const result = resolveDirectHostReachability({
    selectedHost: "203.0.113.8",
    probeSucceeded: false,
    addressSource: "public_ip",
    publicIp: "203.0.113.8",
    upnpMapped: false,
    natPmpMapped: false,
  });

  assert.equal(result.reachability, "unverified");
  assert.equal(result.message.includes("候选公网地址"), true);
});

test("direct host marks address as reachable when tcp probe succeeds", () => {
  const result = resolveDirectHostReachability({
    selectedHost: "203.0.113.8",
    probeSucceeded: true,
    addressSource: "public_ip",
    publicIp: "203.0.113.8",
    upnpMapped: true,
    natPmpMapped: false,
  });

  assert.equal(result.reachability, "reachable");
  assert.equal(result.message.includes("公网直连可用"), true);
});
