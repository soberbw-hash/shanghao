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

console.log(`Release metadata verified for v${expectedVersion}`);
