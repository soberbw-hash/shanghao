import path from "node:path";
import { runWindowsPowerShell, parsePowerShellJson } from "./windows-command";
import { windowsSystemScript, type WindowsSystemOperation } from "./windows-system-scripts";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Fixed operation vocabulary only. The executable is supplied by Main, never Renderer. */
export const encodeWindowsSystemOperation = (
  operation: WindowsSystemOperation,
  executablePath: string,
  expiresAt: number,
): string => {
  const script = windowsSystemScript(operation); // Reject unknown operations even from JS callers.
  if (
    !/^[a-z]:\\/iu.test(executablePath) ||
    !path.win32.isAbsolute(executablePath) ||
    !executablePath.toLowerCase().endsWith(".exe") ||
    executablePath.length > 32_000 ||
    /[\r\n]/u.test(executablePath) ||
    executablePath.includes("\0") ||
    !Number.isSafeInteger(expiresAt)
  )
    throw new Error("invalid_windows_system_target");
  const command = `
$ErrorActionPreference = 'Stop'
# A prompt accepted after the caller's deadline must not make delayed system changes.
if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt ${expiresAt}) { exit 124 }
$job = Start-Job -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  $env:SHANGHAO_FIREWALL_OPERATION = ${literal(operation === "firewall-repair" ? "repair" : "remove")}
  $env:SHANGHAO_FIREWALL_EXE = ${literal(executablePath)}
  ${script}
}
try {
  if (-not (Wait-Job -Job $job -Timeout 60)) { Stop-Job -Job $job; exit 124 }
  if ($job.State -ne 'Completed') { exit 1 }
  Receive-Job -Job $job -ErrorAction Stop | Out-Null
} catch { exit 1 } finally { Remove-Job -Job $job -Force -ErrorAction SilentlyContinue }
exit 0
`;
  return Buffer.from(command, "utf16le").toString("base64");
};

export const privilegedOperationError = (code: number): Error =>
  new Error(
    code === 1223
      ? "windows_uac_cancelled"
      : code === 124
        ? "windows_system_timeout"
        : "windows_system_operation_failed",
  );

/** UAC applies to this short-lived fixed helper, never the running chat/AI application. */
export const runWindowsSystemOperation = async (
  operation: WindowsSystemOperation,
  execute: typeof runWindowsPowerShell = runWindowsPowerShell,
  executablePath = process.execPath,
): Promise<void> => {
  const encoded = encodeWindowsSystemOperation(operation, executablePath, Date.now() + 90_000);
  const launcher = `
$ErrorActionPreference = 'Stop'
try {
  $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -PassThru -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')
  if (-not $helper.WaitForExit(65000)) { @{ code = 124 } | ConvertTo-Json -Compress }
  else { @{ code = $helper.ExitCode } | ConvertTo-Json -Compress }
} catch {
  $exception = $_.Exception
  while ($exception.InnerException) { $exception = $exception.InnerException }
  @{ code = $(if ($exception.NativeErrorCode -eq 1223) { 1223 } else { 1 }) } | ConvertTo-Json -Compress
}
`;
  const result = await execute(launcher, {}, 160_000);
  const parsed = parsePowerShellJson<{ code?: number }>(result.stdout);
  if (parsed.code !== 0) throw privilegedOperationError(parsed.code ?? 1);
};
