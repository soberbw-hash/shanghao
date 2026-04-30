import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts");
const hostSessionPath = path.resolve(process.cwd(), "src/main/host-session.ts");
const inviteUtilPath = path.resolve(process.cwd(), "src/renderer/src/utils/invite.ts");

test("host uses local loopback only for self-connect, not for outward invite links", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("connectUrl: hostJoinUrl"), true);
  assert.equal(source.includes("inviteUrl: shareableInviteUrl"), true);
  assert.equal(source.includes("signalingUrl: inviteUrl || undefined"), true);
  assert.equal(source.includes("const inviteUrl = buildShareableInviteUrl(hostSession) || room.signalingUrl;"), true);
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

test("renderer can derive a shareable invite url even before signalingUrl is explicitly persisted", () => {
  const source = readFileSync(inviteUtilPath, "utf8");

  assert.equal(source.includes("withCandidateUrls(session.signalingUrl, session)"), true);
  assert.equal(source.includes("if (!session.hostAddress?.trim())"), true);
  assert.equal(source.includes("url.searchParams.set(\"roomId\", session.roomId);"), true);
  assert.equal(source.includes("url.searchParams.set(\"mode\", session.connectionMode);"), true);
  assert.equal(source.includes("url.searchParams.append(\"candidate\", candidate);"), true);
});

test("joining tries invite fallback candidates before giving up", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("candidateUrls: [...new Set(candidateUrls)]"), true);
  assert.equal(source.includes("const connectedUrl = await connectToAnyCandidate"), true);
  assert.equal(source.includes("Trying signaling candidate"), true);
});
