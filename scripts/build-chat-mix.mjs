import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Separate worker: never alter the verified low-latency phone-mode helper.
if (process.platform === "win32") {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const output = path.join(root, "artifacts/chat-mix-native");
  mkdirSync(output, { recursive: true });
  const source = path.join(root, "native/chat-mix/ChatMixSessions.cs");
  const compiled = path.join(output, "ShangHao.ChatMixInventory.exe");
  const current =
    existsSync(compiled) &&
    statSync(compiled).size > 0 &&
    [source, fileURLToPath(import.meta.url)].every(
      (file) => statSync(compiled).mtimeMs >= statSync(file).mtimeMs,
    );
  if (!current) {
    execFileSync(
      path.join(
        process.env.SystemRoot || "C:/Windows",
        "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
      ),
      [
        "/nologo",
        "/optimize+",
        "/platform:x64",
        "/target:exe",
        "/r:System.Web.Extensions.dll",
        `/out:${compiled}`,
        source,
      ],
      { stdio: "inherit", windowsHide: true },
    );
  }
  const resource = path.join(root, "apps/desktop/resources/native/ShangHao.ChatMix.exe");
  mkdirSync(path.dirname(resource), { recursive: true });
  if (!existsSync(resource) || !readFileSync(resource).equals(readFileSync(compiled)))
    copyFileSync(compiled, resource);
}
