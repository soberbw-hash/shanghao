import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts");
const hostSessionPath = path.resolve(process.cwd(), "src/main/host-session.ts");

test("host uses local loopback only for self-connect, not for outward invite links", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("connectUrl: hostJoinUrl"), true);
  assert.equal(source.includes("inviteUrl: session.signalingUrl"), true);
  assert.equal(source.includes("signalingUrl: inviteUrl || undefined"), true);
  assert.equal(source.includes("const inviteUrl = hostSession?.signalingUrl || room.signalingUrl;"), true);
});

test("direct host keeps a shareable candidate address even before full reachability verification", () => {
  const source = readFileSync(hostSessionPath, "utf8");

  assert.equal(
    source.includes("const hasCandidateAddress = Boolean(resolvedHost);"),
    true,
  );
  assert.equal(source.includes("const isVerifiedShareable = probe.summary.reachability === \"reachable\";"), true);
  assert.equal(source.includes("hasCandidateAddress && resolvedHost"), true);
  assert.equal(
    source.includes("addressSource: hasCandidateAddress ? resolvedAddressSource : \"unknown\""),
    true,
  );
});

test("direct host seeds an immediate manual or LAN candidate before public probe completes", () => {
  const source = readFileSync(hostSessionPath, "utf8");

  assert.equal(source.includes("const lanCandidates = resolveLanIpv4Candidates();"), true);
  assert.equal(source.includes("const initialHost = manualHost ?? lanCandidates[0] ?? \"\";"), true);
  assert.equal(
    source.includes("addressSource = manualHost\n          ? \"manual_public_host\"\n          : initialHost\n            ? \"lan_ipv4\"\n            : \"unknown\";"),
    true,
  );
  assert.equal(source.includes("signalingUrl = initialHost"), true);
});
