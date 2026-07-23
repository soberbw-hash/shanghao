import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("v2.0.0 release metadata and safeguards are complete", () => {
  const rootPackage = JSON.parse(read("package.json")) as { version: string };
  const desktopPackage = JSON.parse(read("apps/desktop/package.json")) as { version: string };
  const release = read(".github/workflows/release.yml");

  assert.equal(rootPackage.version, "2.0.0");
  assert.equal(desktopPackage.version, "2.0.0");
  assert.equal(APP_PROTOCOL_VERSION, "5");
  assert.equal(APP_BUILD_NUMBER, "2026.07.23.1");
  assert.equal(existsSync(path.join(root, "docs/release-notes/v2.0.0.md")), true);
  assert.equal(release.includes("windows-${{ github.ref_name }}"), true);
  assert.equal(release.includes("docs/release-notes/${{ github.ref_name }}.md"), true);
  assert.equal(release.includes("pnpm lint"), true);
  assert.equal(release.includes("pnpm test:five-peer-audio"), true);
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
