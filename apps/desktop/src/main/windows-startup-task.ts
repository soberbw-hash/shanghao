import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";
import { platformService } from "./platform/PlatformService";

const REMOVE_STARTUP_TASK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$taskName = 'ShangHao Auto Start'
Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
  Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
@{ removed = $true; taskName = $taskName } | ConvertTo-Json -Compress
`;

/** Removes the legacy auto-login task left by older ShangHao versions. */
export const removeWindowsStartupTask = async (): Promise<void> => {
  if (!platformService.isWindows) return;
  await runWindowsPowerShell(REMOVE_STARTUP_TASK_SCRIPT, {
    SHANGHAO_REMOVE_LEGACY_STARTUP: "1",
  }).then((result) => parsePowerShellJson(result.stdout));
};
