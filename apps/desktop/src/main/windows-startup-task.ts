import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";

export const STARTUP_TASK_NAME = "ShangHao Auto Start";
const STARTUP_TASK_ARGUMENT = "--shanghao-startup";

export interface WindowsStartupTaskStatus {
  supported: boolean;
  enabled: boolean;
  taskName: string;
  executablePath?: string;
  arguments?: string;
  runLevel?: string;
  message: string;
}

const STARTUP_TASK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$taskName = 'ShangHao Auto Start'
$operation = $env:SHANGHAO_STARTUP_OPERATION
$exePath = $env:SHANGHAO_STARTUP_EXE
$argument = '--shanghao-startup'

if ($operation -eq 'disable') {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false -ErrorAction SilentlyContinue
}

if ($operation -eq 'enable') {
  if (-not $exePath -or -not (Test-Path -LiteralPath $exePath)) {
    throw 'startup_executable_not_found'
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute $exePath -Argument $argument
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $trigger.Delay = 'PT5S'
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  @{ enabled = $false; taskName = $taskName } | ConvertTo-Json -Compress
  exit 0
}
$actionInfo = @($task.Actions)[0]
@{
  enabled = ($task.State -ne 'Disabled')
  taskName = $taskName
  executablePath = $actionInfo.Execute
  arguments = $actionInfo.Arguments
  runLevel = [string]$task.Principal.RunLevel
} | ConvertTo-Json -Compress
`;

const unsupportedStatus = (): WindowsStartupTaskStatus => ({
  supported: false,
  enabled: false,
  taskName: STARTUP_TASK_NAME,
  message: "仅 Windows 正式版使用计划任务开机启动。",
});

const runStartupTaskOperation = async (
  operation: "query" | "enable" | "disable",
  executablePath = process.execPath,
): Promise<WindowsStartupTaskStatus> => {
  if (process.platform !== "win32") return unsupportedStatus();
  const result = await runWindowsPowerShell(STARTUP_TASK_SCRIPT, {
    SHANGHAO_STARTUP_OPERATION: operation,
    SHANGHAO_STARTUP_EXE: executablePath,
  });
  const parsed = parsePowerShellJson<{
    enabled?: boolean;
    taskName?: string;
    executablePath?: string;
    arguments?: string;
    runLevel?: string;
  }>(result.stdout);
  const executableMatches =
    !parsed.enabled || parsed.executablePath?.toLowerCase() === executablePath.toLowerCase();
  const argumentsMatch = !parsed.enabled || parsed.arguments?.trim() === STARTUP_TASK_ARGUMENT;
  const highest = !parsed.enabled || Boolean(parsed.runLevel?.toLowerCase().includes("highest"));

  return {
    supported: true,
    enabled: parsed.enabled === true && executableMatches && argumentsMatch && highest,
    taskName: parsed.taskName ?? STARTUP_TASK_NAME,
    executablePath: parsed.executablePath,
    arguments: parsed.arguments,
    runLevel: parsed.runLevel,
    message:
      parsed.enabled === true && executableMatches && argumentsMatch && highest
        ? "开机启动任务正常（当前用户、最高权限、延迟 5 秒）。"
        : parsed.enabled
          ? "开机启动任务需要修复。"
          : "开机启动未启用。",
  };
};

export const readWindowsStartupTaskStatus = async (): Promise<WindowsStartupTaskStatus> =>
  runStartupTaskOperation("query");

export const configureWindowsStartupTask = async (
  enabled: boolean,
): Promise<WindowsStartupTaskStatus> => runStartupTaskOperation(enabled ? "enable" : "disable");
