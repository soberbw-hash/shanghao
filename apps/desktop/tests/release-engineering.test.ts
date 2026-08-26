import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("v3.0.4 release metadata and safeguards are complete", () => {
  const rootPackage = JSON.parse(read("package.json")) as { version: string };
  const desktopPackage = JSON.parse(read("apps/desktop/package.json")) as { version: string };
  const release = read(".github/workflows/release.yml");
  const desktopBuilder = read("apps/desktop/electron-builder.yml");
  const changelog = read("CHANGELOG.md");
  const architecture = read("docs/architecture.md");

  assert.equal(rootPackage.version, "3.0.4");
  assert.equal(desktopPackage.version, "3.0.4");
  assert.equal(APP_PROTOCOL_VERSION, "7");
  assert.equal(APP_BUILD_NUMBER, "2026.08.26.1");
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.6.0.md")), true);
  assert.equal(changelog.includes("## 2.6.0"), true);
  assert.equal(changelog.includes("## 2.6.1 - 2026-08-12（已合并到 2.8.0，未单独发布）"), true);
  assert.equal(changelog.includes("## 2.7.0 - 2026-08-13（已合并到 2.8.0，未单独发布）"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.7.0.md")), true);
  assert.equal(changelog.includes("## 2.8.0 - 2026-08-13"), true);
  assert.equal(changelog.includes("合并本地 2.6.1、2.7.0 与 2.8.0"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.8.0.md")), true);
  assert.equal(changelog.includes("## 2.9.0 - 2026-08-15"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.9.0.md")), true);
  assert.equal(changelog.includes("## 2.9.1 - 2026-08-15"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.9.1.md")), true);
  assert.equal(changelog.includes("## 2.9.2 - 2026-08-15"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.9.2.md")), true);
  assert.equal(changelog.includes("## 3.0.0 - 2026-08-20"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v3.0.0.md")), true);
  assert.equal(changelog.includes("## 3.0.2 - 2026-08-22"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v3.0.2.md")), true);
  assert.equal(existsSync(path.join(root, "docs/stabilization-reference-3.0.2.md")), true);
  assert.equal(changelog.includes("## 3.0.3 - 2026-08-24"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v3.0.3.md")), true);
  assert.equal(changelog.includes("## 3.0.4 - 2026-08-26"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v3.0.4.md")), true);
  assert.equal(
    changelog.includes("ai_runtime_integrity_failed") || changelog.includes("AI runtime"),
    true,
  );
  assert.equal(existsSync(path.join(root, "docs/v2.6.1-release-sequence.md")), true);
  assert.equal(architecture.includes("ScreenShareManager"), true);
  assert.equal(desktopBuilder.includes("mac:"), false);
  assert.equal(desktopBuilder.includes("shanghao-icon.icns"), false);
  assert.equal(release.includes("windows-${{ github.ref_name }}"), true);
  assert.equal(release.includes("docs/release-notes/${{ github.ref_name }}.md"), true);
  assert.equal(release.includes("pnpm lint"), true);
  assert.equal(release.includes("pnpm test:audio-worklet"), true);
  assert.equal(release.includes("pnpm test:five-peer-audio"), true);
  assert.equal(release.includes("pnpm test:five-peer-media"), true);
  assert.equal(release.includes("pnpm release:verify-package"), true);
  assert.equal(release.includes("SHA256SUMS.txt"), true);
});

test("main CI, CodeQL, and Dependabot guard the repository", () => {
  const ci = read(".github/workflows/ci.yml");
  const codeql = read(".github/workflows/codeql.yml");
  const dependabot = read(".github/dependabot.yml");

  assert.equal(ci.includes("branches: [main]"), true);
  assert.equal(ci.includes("pnpm install --frozen-lockfile"), true);
  assert.equal(ci.includes("pnpm build"), true);
  assert.equal(
    ci.includes(
      "xvfb-run -a pnpm --dir apps/desktop exec electron --no-sandbox tests/electron-audio-worklet-smoke.cjs",
    ),
    true,
  );
  assert.equal(ci.includes("xvfb-run -a pnpm test:five-peer-media"), true);
  assert.equal(codeql.includes("javascript-typescript"), true);
  assert.equal(dependabot.includes("package-ecosystem: npm"), true);
  assert.equal(dependabot.includes("package-ecosystem: github-actions"), true);
});

test("motion source has no forbidden blanket or zero-scale transitions", () => {
  const sourcePaths = [
    "apps/desktop/src/renderer/src/styles/index.css",
    "apps/desktop/src/renderer/src/features/motion/motionSystem.ts",
    "packages/ui/src/motion/presets.ts",
  ];
  const source = sourcePaths.map(read).join("\n");

  assert.equal(/transition\s*:\s*all|transition-all/.test(source), false);
  assert.equal(/scale\(0\)/.test(source), false);
  assert.equal(/back\.out/.test(source), false);
});
