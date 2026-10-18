import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeManifest = path.join(workspaceRoot, "native", "Cargo.toml");
const executableName = process.platform === "win32" ? "shanghao-core.exe" : "shanghao-core";
const builtExecutable = path.join(workspaceRoot, "native", "target", "release", executableName);
const resourceDirectory = path.join(workspaceRoot, "apps", "desktop", "resources", "native");

execFileSync(
  "cargo",
  ["build", "--manifest-path", nativeManifest, "--workspace", "--release", "--locked"],
  { cwd: workspaceRoot, stdio: "inherit", windowsHide: true },
);
mkdirSync(resourceDirectory, { recursive: true });
const target = path.join(resourceDirectory, executableName);
// A live developer client can own this EXE; identical builds need no replacement.
if (!existsSync(target) || !readFileSync(target).equals(readFileSync(builtExecutable))) {
  copyFileSync(builtExecutable, target);
}
