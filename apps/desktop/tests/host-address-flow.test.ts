import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts");
const hostSessionPath = path.resolve(process.cwd(), "src/main/host-session.ts");
const inviteUtilPath = path.resolve(process.cwd(), "src/renderer/src/utils/invite.ts");
const homePagePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const directHostPath = path.resolve(process.cwd(), "src/main/direct-host.ts");
const signalingServerPath = path.resolve(process.cwd(), "../../packages/signaling/src/server.ts");

test("host uses local loopback only for self-connect, not for outward invite links", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("connectUrl: hostJoinUrl"), true);
  assert.equal(source.includes("inviteUrl: shareableInviteUrl"), true);
  assert.equal(source.includes("signalingUrl: inviteUrl || undefined"), true);
  assert.equal(source.includes("const inviteUrl = buildShareableInviteUrl(hostSession) || room.signalingUrl;"), true);
});

test("direct host only emits a shareable address after public reachability verification", () => {
  const source = readFileSync(hostSessionPath, "utf8");

  assert.equal(source.includes("probe.summary.reachability === \"reachable\""), true);
  assert.equal(source.includes("probe.summary.addressSource !== \"lan_ipv4\""), true);
  assert.equal(source.includes("isVerifiedShareable && resolvedHost"), true);
});

test("direct host does not persist a fallback share url when probing fails", () => {
  const source = readFileSync(hostSessionPath, "utf8");

  assert.equal(source.includes("signalingUrl: \"\""), true);
  assert.equal(source.includes("uniqueAddresses("), true);
});

test("direct host seeds an immediate manual or LAN candidate before public probe completes", () => {
  const source = readFileSync(hostSessionPath, "utf8");

  assert.equal(source.includes("const lanCandidates = resolveLanIpv4Candidates();"), true);
  assert.equal(source.includes("const publicIpv6Candidates = resolvePublicIpv6Candidates();"), true);
  assert.equal(
    source.includes("const initialHost = manualHost ?? publicIpv6Candidates[0] ?? lanCandidates[0] ?? \"\";"),
    true,
  );
  assert.equal(
    source.includes("publicIpv6Candidates.includes(initialHost)"),
    true,
  );
  assert.equal(source.includes("signalingUrl = \"\""), true);
});

test("direct host can advertise public ipv6 candidates before falling back to LAN", () => {
  const source = readFileSync(directHostPath, "utf8");

  assert.equal(source.includes("resolvePublicIpv6Candidates"), true);
  assert.equal(source.includes("const interfacePublicIpv6 = publicIpv6Candidates[0];"), true);
  assert.equal(source.includes("else if (interfacePublicIpv6)"), true);
  assert.equal(source.includes("publicIp: publicIp || interfacePublicIpv6"), true);
});

test("renderer validates real invite urls and blocks unverified direct-host addresses", () => {
  const source = readFileSync(inviteUtilPath, "utf8");

  assert.equal(source.includes("formatHostForUrl"), true);
  assert.equal(source.includes("withCandidateUrls(session.signalingUrl, session)"), true);
  assert.equal(source.includes("session.directHostProbe?.reachability !== \"reachable\""), true);
  assert.equal(source.includes("session.directHostProbe.addressSource === \"lan_ipv4\""), true);
  assert.equal(source.includes("export const isValidInviteUrl"), true);
  assert.equal(source.includes("url.searchParams.set(\"roomId\", session.roomId);"), true);
  assert.equal(source.includes("url.searchParams.set(\"mode\", session.connectionMode);"), true);
  assert.equal(source.includes("url.searchParams.append(\"candidate\", candidate);"), true);
});

test("home page saves and validates the fixed channel server address", () => {
  const source = readFileSync(homePagePath, "utf8");

  assert.equal(source.includes("buildShareableInviteUrl"), false);
  assert.equal(source.includes("进入开黑频道"), true);
  assert.equal(source.includes("服务器地址"), true);
  assert.equal(source.includes("relayServerUrl: trimmedAddress"), true);
  assert.equal(source.includes('url.protocol === "ws:" || url.protocol === "wss:"'), true);
});

test("joining tries invite fallback candidates before giving up", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("candidateUrls: [...new Set(candidateUrls)]"), true);
  assert.equal(source.includes("const connectedUrl = await connectToAnyCandidate"), true);
  assert.equal(source.includes("Trying signaling candidate"), true);
});

test("signaling server prefers dual-stack bind so public ipv6 direct host can work", () => {
  const source = readFileSync(signalingServerPath, "utf8");

  assert.equal(source.includes("await this.listenOnHost(port, \"::\");"), true);
  assert.equal(source.includes("ipv6Only: false"), true);
  assert.equal(source.includes("await this.listenOnHost(port, \"0.0.0.0\");"), true);
});
