import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");

test("desktop branding assets exist for app, tray, and github", () => {
  const files = [
    path.join(root, "apps/desktop/build/icon-master.png"),
    path.join(root, "apps/desktop/build/shanghao-icon-xl.ico"),
    path.join(root, "apps/desktop/build/shanghao-shortcut-xl.ico"),
    path.join(root, "apps/desktop/build/shanghao-icon-v3.ico"),
    path.join(root, "apps/desktop/build/shanghao-shortcut-v3.ico"),
    path.join(root, "apps/desktop/build/installer.nsh"),
    path.join(root, "apps/desktop/build/logo-ui.svg"),
    path.join(root, "apps/desktop/build/tray-dark.png"),
    path.join(root, "apps/desktop/build/tray-light.png"),
    path.join(root, "apps/desktop/src/renderer/src/assets/brand-mark.svg"),
    path.join(root, "docs/branding/github-avatar.png"),
  ];

  files.forEach((filePath) => {
    assert.equal(existsSync(filePath), true, `missing asset: ${filePath}`);
  });
});

test("desktop release configuration publishes automatic update metadata", () => {
  const builder = readFileSync(path.join(root, "apps/desktop/electron-builder.yml"), "utf8");
  const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");

  assert.equal(builder.includes("provider: github"), true);
  assert.equal(builder.includes("generateUpdatesFilesForAllChannels: true"), true);
  assert.equal(workflow.includes("latest*.yml"), true);
  assert.equal(workflow.includes("*.blockmap"), true);
  assert.equal(workflow.includes("pnpm test:three-peer-audio"), true);
});

test("room scene and feedback sound assets are bundled", () => {
  assert.equal(
    existsSync(
      path.join(root, "apps/desktop/src/renderer/src/assets/scenes/workstation-chibi.webp"),
    ),
    true,
    "missing premium workstation asset",
  );
  assert.equal(
    existsSync(path.join(root, "apps/desktop/src/renderer/src/assets/scenes/chair-chibi.webp")),
    true,
    "missing chibi chair asset",
  );

  for (const avatar of ["fox", "cat", "duck", "panda", "corgi"]) {
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/${avatar}-scene.png`),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/motion/${avatar}-motion.png`),
      ),
      true,
      `missing motion spritesheet: ${avatar}`,
    );
    assert.equal(
      existsSync(
        path.join(root, `apps/desktop/src/renderer/src/assets/avatars/rear/${avatar}-rear.png`),
      ),
      true,
      `missing rear workstation avatar: ${avatar}`,
    );
    for (const part of ["tail", "body", "feet", "head"]) {
      assert.equal(
        existsSync(
          path.join(
            root,
            `apps/desktop/src/renderer/src/assets/avatars/layers/${avatar}-${part}.png`,
          ),
        ),
        true,
        `missing layered avatar part: ${avatar}-${part}`,
      );
    }
  }

  for (const sound of [
    "button-click",
    "enter-room",
    "leave-room",
    "knock-bell",
    "popup-open",
    "copy-success",
    "device-switch",
    "send-message",
    "receive-message",
    "connection-restored",
    "connection-failed",
    "mic-error",
    "record-start",
    "record-stop",
    "speaker-muted",
    "speaker-unmuted",
  ]) {
    assert.equal(
      existsSync(path.join(root, `apps/desktop/src/renderer/src/assets/sounds/${sound}.wav`)),
      true,
      `missing sound: ${sound}`,
    );
  }
});
