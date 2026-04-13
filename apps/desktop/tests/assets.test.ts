import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");

test("desktop branding assets exist for app, tray, and github", () => {
  const files = [
    path.join(root, "apps/desktop/build/icon-master.png"),
    path.join(root, "apps/desktop/build/icon.ico"),
    path.join(root, "apps/desktop/build/shortcut.ico"),
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
