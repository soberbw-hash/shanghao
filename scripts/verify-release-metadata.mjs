import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const rootPackage = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  await readFile(path.join(workspaceRoot, "apps", "desktop", "package.json"), "utf8"),
);
const constants = await readFile(
  path.join(workspaceRoot, "packages", "shared", "src", "constants", "app.ts"),
  "utf8",
);
const readme = await readFile(path.join(workspaceRoot, "README.md"), "utf8");
const currentRound = await readFile(path.join(workspaceRoot, "docs", "CURRENT_ROUND.md"), "utf8");
const changelog = await readFile(path.join(workspaceRoot, "CHANGELOG.md"), "utf8");
const cliVersion = process.argv.slice(2).find((argument) => argument !== "--");
const expectedVersion =
  cliVersion?.replace(/^v/, "") ?? process.env.GITHUB_REF_NAME?.replace(/^v/, "");

if (!expectedVersion) {
  throw new Error("Pass the expected version, for example: pnpm release:verify -- 1.0.0");
}
if (rootPackage.version !== expectedVersion || desktopPackage.version !== expectedVersion) {
  throw new Error(
    `Version mismatch: tag=${expectedVersion}, root=${rootPackage.version}, desktop=${desktopPackage.version}`,
  );
}
if (!/APP_BUILD_NUMBER\s*=\s*"\d{4}\.\d{2}\.\d{2}\.\d+"/.test(constants)) {
  throw new Error("APP_BUILD_NUMBER is missing or invalid");
}
if (!/APP_PROTOCOL_VERSION\s*=\s*"\d+"/.test(constants)) {
  throw new Error("APP_PROTOCOL_VERSION is missing or invalid");
}

const releaseNotesPath = path.join(
  workspaceRoot,
  "docs",
  "release-notes",
  `v${expectedVersion}.md`,
);
const releaseNotes = await readFile(releaseNotesPath, "utf8");
if (releaseNotes.trim().length < 200) {
  throw new Error(`Release notes are missing or incomplete: ${releaseNotesPath}`);
}
if (!readme.includes(`当前仓库版本为 **${expectedVersion}**`)) {
  throw new Error(`README current version is not ${expectedVersion}`);
}
if (!readme.includes(`v${expectedVersion} 更新公告`)) {
  throw new Error(`README does not link the v${expectedVersion} release notes`);
}
if (!currentRound.startsWith(`# ShangHao ${expectedVersion} `)) {
  throw new Error(`docs/CURRENT_ROUND.md is not aligned with ${expectedVersion}`);
}
if (!changelog.includes(`## ${expectedVersion} -`)) {
  throw new Error(`CHANGELOG.md has no ${expectedVersion} entry`);
}
if (!readme.includes("约 -16 LUFS") || !readme.includes("CloudBase 手机号验证注册")) {
  throw new Error("README audio target or primary account provider is stale");
}
if (currentRound.includes("UI 音效开关/音量")) {
  throw new Error("CURRENT_ROUND still documents removed UI sound controls");
}

console.log(`Release metadata verified for v${expectedVersion}`);
