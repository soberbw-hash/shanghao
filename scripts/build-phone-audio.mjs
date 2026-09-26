import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.join(root, "apps/desktop/resources/native");
  mkdirSync(output, { recursive: true });
  const source = path.join(root, "native/phone-mode/PhoneAudio.cs");
  const target = path.join(output, "ShangHao.PhoneAudio.exe");
  // The development app may be using this executable. Rebuilding identical
  // source needlessly tries to overwrite a running helper and blocks packaging.
  const currentBinary =
    existsSync(target) &&
    statSync(target).size > 0 &&
    statSync(target).mtimeMs >= statSync(source).mtimeMs;
  if (currentBinary) {
    process.exit(0);
  }
  const framework = path.join(
    process.env.SystemRoot || "C:/Windows",
    "Microsoft.NET/Framework64/v4.0.30319",
  );
  execFileSync(
    path.join(framework, "csc.exe"),
    [
      "/nologo",
      "/optimize+",
      "/platform:x64",
      "/target:exe",
      "/r:System.Web.Extensions.dll",
      `/out:${target}`,
      source,
    ],
    { stdio: "inherit", windowsHide: true },
  );
}
