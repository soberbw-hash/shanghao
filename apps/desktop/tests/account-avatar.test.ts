import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountAvatar } from "../src/renderer/src/components/account/AccountAvatar";

test("account portraits preserve square photo cropping and a loading fallback", () => {
  const html = renderToStaticMarkup(
    createElement(AccountAvatar, { name: "小明", src: "https://example.com/account.png" }),
  );
  assert.ok(html.includes('src="https://example.com/account.png"'));
  assert.ok(html.includes("object-fit:cover"));
  assert.ok(html.includes("小</span>"));
  assert.ok(!html.includes("scale("));
});

test("missing account portraits use initials rather than a room animal", () => {
  const html = renderToStaticMarkup(createElement(AccountAvatar, { name: "小明" }));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("小</span>"));
});

test("chat and overlay prefer account identity over room avatar selection", () => {
  const chat = readFileSync("src/renderer/src/components/chat/ChatAccountAvatar.tsx", "utf8");
  const overlay = readFileSync("src/renderer/src/pages/OverlayPage.tsx", "utf8");
  assert.ok(
    chat.includes(
      "localPortrait || currentAvatar || localPreset || message.avatarUrl || message.avatarDataUrl",
    ),
  );
  assert.ok(chat.includes("message.isLocal === true && member.isLocal"));
  assert.ok(overlay.includes("member.avatarUrl || member.avatarDataUrl"));
  assert.ok(!chat.includes("getAvatarSrc"));
  assert.ok(!overlay.includes("getAvatarFaceStyle"));
});

test("preset avatars are uploaded to the account profile before local selection is saved", () => {
  const card = readFileSync("src/renderer/src/components/settings/AccountSettingsCard.tsx", "utf8");
  const registration = readFileSync("src/renderer/src/pages/AccountPage.tsx", "utf8");
  for (const source of [card, registration]) {
    assert.ok(source.includes("prepareAccountAvatar"));
    assert.ok(source.includes("updateAvatar({ dataUrl })"));
  }
  assert.ok(
    card.indexOf("updateAvatar({ dataUrl })") <
      card.indexOf("saveSettings({ accountAvatarPresetId"),
  );
});

test("room character labels omit portraits while chat keeps account portraits", () => {
  const label = readFileSync("src/renderer/src/components/room/SceneCharacterLabel.tsx", "utf8");
  assert.ok(!label.includes("<img"));
  assert.ok(!label.includes("AccountAvatar"));
  assert.ok(label.includes("member.nickname"));
  const chat = readFileSync("src/renderer/src/components/chat/ChatAccountAvatar.tsx", "utf8");
  assert.ok(chat.includes("<AccountAvatar"));
  assert.ok(chat.includes("message.isLocal ?"));
});
