import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.join(root, "apps/desktop/resources/native");
  mkdirSync(output, { recursive: true });
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
      `/out:${path.join(output, "ShangHao.PhoneAudio.exe")}`,
      path.join(root, "native/phone-mode/PhoneAudio.cs"),
    ],
    { stdio: "inherit", windowsHide: true },
  );
}
