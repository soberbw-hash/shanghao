import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourcePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const sceneZonesPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/voice-scene/sceneZones.ts",
);

test("home page is a full-screen fixed-channel entry page", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("entry-page"), true);
  assert.equal(source.includes("固定好友语音"), true);
  assert.equal(source.includes("更换服务器"), false);
  assert.equal(source.includes("重新检测"), false);
  assert.equal(source.includes("频道服务器"), false);
  assert.equal(source.includes("固定好友频道已准备好"), false);
  assert.equal(source.includes("AvatarPicker"), false);
  assert.equal(source.includes("选择角色"), false);
  assert.equal(source.includes("BUILT_IN_AVATAR_IDS.find"), true);
  assert.equal(source.includes("选一个头像"), false);
  assert.equal(source.includes("TemporaryChatPanel"), false);
  assert.equal(source.includes("entry-server-status-slot"), true);
  assert.equal(source.includes("automaticEntryIdentity"), false);
  assert.equal(source.includes('message="正在进入频道..."'), false);
  assert.equal(source.includes('useState<ChannelId>("main")'), true);
  assert.equal(source.includes('aria-label="选择进入的房间"'), true);
  assert.equal(source.includes('"一号房" : "二号房"'), true);
  assert.equal(source.includes("joinChannel(normalizedAddress, selectedChannelId)"), true);
  assert.equal(source.includes("diagnostics.testServer"), true);
  assert.equal(source.includes("setServerTestResult(undefined);\n    try"), false);
});

test("room shell is shown only after microphone and signaling join succeed", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );
  const connectIndex = source.indexOf("await connectToFixedChannel(serverUrl, channelId");
  const navigateIndex = source.indexOf('useAppStore.getState().navigate("room")', connectIndex);

  assert.notEqual(connectIndex, -1);
  assert.notEqual(navigateIndex, -1);
  assert.equal(navigateIndex > connectIndex, true);
  assert.equal(
    source.slice(source.indexOf("const joinChannel ="), connectIndex).includes('navigate("room")'),
    false,
  );
});

test("home page hides legacy connection mode tabs from the primary flow", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("SegmentedControl"), false);
  assert.equal(source.includes("房主直连"), false);
  assert.equal(source.includes("Tailscale"), false);
  assert.equal(source.includes("joinChannel"), true);
});

test("home page summarizes both sound devices without a mic-test panel", () => {
  const source = readFileSync(sourcePath, "utf8");

  assert.equal(source.includes("试音"), false);
  assert.equal(source.includes("声音正常"), true);
  assert.equal(source.includes('aria-label="扬声器设备"'), true);
});

test("room scene keeps exactly five stable workstation slots", () => {
  const source = readFileSync(sceneZonesPath, "utf8");

  assert.equal((source.match(/id: "gameDesk/g) ?? []).length, 5);
  assert.equal(source.includes("defaultMemberZones"), true);
});
