import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
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
copyFileSync(builtExecutable, path.join(resourceDirectory, executableName));
