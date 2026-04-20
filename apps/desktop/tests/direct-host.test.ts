import assert from "node:assert/strict";
import test from "node:test";

import { resolveDirectHostReachability } from "../src/main/direct-host";

test("direct host keeps a candidate address when self-verification is unavailable", () => {
  const result = resolveDirectHostReachability({
    selectedHost: "203.0.113.8",
    probeSucceeded: false,
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
    publicIp: "203.0.113.8",
    upnpMapped: true,
    natPmpMapped: false,
  });

  assert.equal(result.reachability, "reachable");
  assert.equal(result.message.includes("公网直连可用"), true);
});
