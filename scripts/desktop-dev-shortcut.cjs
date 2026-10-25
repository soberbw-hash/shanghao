const path = require("node:path");

/** Stable hidden entry: no Script Host dependency and no execution-policy override. */
exports.developmentPowerShellScript = (application, repository, destination) => {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const executable = path.join(application, "node_modules", "electron", "dist", "electron.exe");
  return `$ErrorActionPreference = 'Stop'
$taskExecutable = ${literal(executable)}
$taskLauncher = ${literal(path.join(destination, "start-dev.mjs"))}
$taskRepository = ${literal(repository)}
$taskLog = ${literal(path.join(destination, "window-activation.log"))}
$taskPreviousNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $taskChild = Start-Process -FilePath $taskExecutable -ArgumentList @(('"{0}"' -f $taskLauncher), ('"{0}"' -f $taskRepository)) -WindowStyle Hidden -PassThru
    $taskChild.WaitForExit()
    if ($taskChild.ExitCode -ne 0) { throw "Development launcher failed: $($taskChild.ExitCode)" }
  } finally {
    if ($null -eq $taskPreviousNodeMode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $taskPreviousNodeMode }
  }
  $taskShell = New-Object -ComObject WScript.Shell
  $taskActivated = $false
  for ($taskAttempt = 0; $taskAttempt -lt 60; $taskAttempt++) {
    $taskProcesses = Get-CimInstance Win32_Process -Filter "Name='electron.exe'"
    foreach ($taskProcess in $taskProcesses) {
      $taskLine = [string]$taskProcess.CommandLine
      if ($taskLine.IndexOf($taskExecutable, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $taskLine.TrimEnd().EndsWith(' .')) {
        $taskActivated = $taskShell.AppActivate([int]$taskProcess.ProcessId)
        if ($taskActivated) { break }
      }
    }
    if ($taskActivated) { break }
    Start-Sleep -Milliseconds 250
  }
  Add-Content -LiteralPath $taskLog -Value ("{0:o} powershell activated={1}" -f [DateTime]::Now, $taskActivated)
  if (-not $taskActivated) { throw 'The development process started, but no window could be activated.' }
} catch {
  Add-Content -LiteralPath $taskLog -Value ("{0:o} powershell launch_failed" -f [DateTime]::Now)
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('开发版未能启动，请查看启动目录中的 start-dev.log。', '上号开发版') | Out-Null
  exit 1
}
`;
};
