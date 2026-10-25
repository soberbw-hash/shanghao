import { execFile } from "node:child_process";
import path from "node:path";
import { platformService } from "./PlatformService";

export async function unwrapWindowsKey(wrapped: Buffer): Promise<Buffer> {
  if (!platformService.isWindows) throw Error("provider_recovery_unavailable");
  // Secrets pass only through captured process pipes, never arguments, files or diagnostics.
  const script =
    "Add-Type -AssemblyName System.Security; try { $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $k=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($k)) } catch { exit 1 } finally { if($k){[Array]::Clear($k,0,$k.Length)} }";
  const result = await new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "buffer", windowsHide: true, timeout: 10_000, maxBuffer: 4096 },
      (error, stdout) => (error ? reject(Error("provider_recovery_unavailable")) : resolve(stdout)),
    );
    child.stdin?.end(wrapped.toString("base64"));
  });
  try {
    return Buffer.from(result.toString("utf8").trim(), "base64");
  } finally {
    result.fill(0);
  }
}
