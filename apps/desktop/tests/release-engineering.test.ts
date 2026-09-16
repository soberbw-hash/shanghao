import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("current local metadata and safeguards are complete", () => {
  const rootPackage = JSON.parse(read("package.json")) as { version: string };
  const desktopPackage = JSON.parse(read("apps/desktop/package.json")) as { version: string };
  const currentVersion = rootPackage.version;
  const release = read(".github/workflows/release.yml");
  const desktopBuilder = read("apps/desktop/electron-builder.yml");
  const changelog = read("CHANGELOG.md");
  const architecture = read("docs/architecture.md");
  const readme = read("README.md");
  const currentRound = read("docs/CURRENT_ROUND.md");

  assert.equal(desktopPackage.version, currentVersion);
  assert.equal(APP_PROTOCOL_VERSION, "7");
  assert.match(APP_BUILD_NUMBER, /^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  assert.equal(existsSync(path.join(root, `docs/release-notes/v${currentVersion}.md`)), true);
  assert.equal(changelog.includes(`## ${currentVersion} -`), true);
  assert.equal(readme.includes(`当前仓库版本为 **${currentVersion}**`), true);
  assert.equal(readme.includes(`v${currentVersion} 更新公告`), true);
  assert.equal(currentRound.startsWith(`# ShangHao ${currentVersion} `), true);
  assert.equal(readme.includes("约 -16 LUFS"), true);
  assert.equal(readme.includes("CloudBase 手机号验证注册"), true);
  assert.equal(currentRound.includes("UI 音效开关/音量"), false);
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
  assert.equal(changelog.includes("## 3.0.5 - 2026-08-26"), true);
  assert.equal(existsSync(path.join(root, "docs/release-notes/v3.0.5.md")), true);
  assert.equal(
    changelog.includes("ai_runtime_integrity_failed") || changelog.includes("AI runtime"),
    true,
  );
  assert.equal(existsSync(path.join(root, "docs/v2.6.1-release-sequence.md")), true);
  assert.equal(architecture.includes("ScreenShareManager"), true);
  assert.equal(desktopBuilder.includes("mac:"), false);
  assert.equal(desktopBuilder.includes("shanghao-icon.icns"), false);
  assert.equal(release.includes("windows-${{ inputs.release_tag || github.ref_name }}"), true);
  assert.equal(
    release.includes("docs/release-notes/${{ inputs.release_tag || github.ref_name }}.md"),
    true,
  );
  assert.equal(release.includes("VITE_CLOUDBASE_ENV_ID"), true);
  assert.equal(release.includes("VITE_CLOUDBASE_PUBLISHABLE_KEY"), true);
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
  assert.equal(ci.includes("runs-on: windows-latest"), true);
  assert.equal(
    ci.includes(
      "xvfb-run -a pnpm --dir apps/desktop exec electron --no-sandbox tests/electron-audio-worklet-smoke.cjs",
    ),
    true,
  );
  assert.equal(ci.includes("xvfb-run -a pnpm test:five-peer-media"), true);
  const soak = read(".github/workflows/soak.yml");
  assert.equal(soak.includes('cron: "0 18 * * *"'), true);
  assert.equal(soak.includes("runtime-diagnostics.test.ts"), true);
  assert.equal(soak.includes("process-samples.log"), true);
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
