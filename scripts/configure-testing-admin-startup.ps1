$ErrorActionPreference = 'Stop'
# User-requested local testing policy. Does not launch, close, or modify audio.
$taskRoot = Join-Path $env:LOCALAPPDATA 'Programs\ShangHaoDev'
$taskLauncher = Join-Path $taskRoot 'launch-dev.ps1'
$taskBackup = Join-Path $taskRoot ('admin-startup-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
Copy-Item -LiteralPath $taskLauncher -Destination (Join-Path $taskBackup 'launch-dev.ps1')
$taskBody = [IO.File]::ReadAllText($taskLauncher)
if (-not $taskBody.Contains('# ShangHao testing administrator startup')) {
    $taskPrefix = @'
# ShangHao testing administrator startup
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskPrincipal = New-Object Security.Principal.WindowsPrincipal($taskIdentity)
if (-not $taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $taskFile = Join-Path $env:LOCALAPPDATA 'Programs\ShangHaoDev\launch-dev.ps1'
    $taskEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([IO.File]::ReadAllText($taskFile)))
    $taskShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    Start-Process -FilePath $taskShell -Verb RunAs -WindowStyle Hidden -ArgumentList ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $taskEncoded)
    exit
}
'@
    [IO.File]::WriteAllText($taskLauncher, $taskPrefix + [Environment]::NewLine + $taskBody, [Text.Encoding]::Unicode)
}
Copy-Item -LiteralPath (Join-Path $taskRoot 'launch-dev.cmd') -Destination (Join-Path $taskBackup 'launch-dev.cmd')
Copy-Item -LiteralPath (Join-Path $taskRoot 'launch-dev-admin.cmd') -Destination (Join-Path $taskRoot 'launch-dev.cmd')
$taskRegistry = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
if (-not (Test-Path -LiteralPath $taskRegistry)) { New-Item -Path $taskRegistry -Force | Out-Null }
$taskExe = Join-Path $env:LOCALAPPDATA 'Programs\ShangHao\ShangHao.exe'
$taskPrevious = $null
try { $taskPrevious = Get-ItemPropertyValue -LiteralPath $taskRegistry -Name $taskExe -ErrorAction Stop } catch [System.Management.Automation.PSArgumentException] { }
@{ executable=$taskExe; previous=$taskPrevious } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskBackup 'formal-compatibility.json') -Encoding utf8
if (Test-Path -LiteralPath $taskExe) {
    $taskFlags = if ($taskPrevious -match 'RUNASADMIN') { $taskPrevious } else { (($taskPrevious + ' RUNASADMIN').Trim()) }
    New-ItemProperty -LiteralPath $taskRegistry -Name $taskExe -Value $taskFlags -PropertyType String -Force | Out-Null
}
$taskShell = New-Object -ComObject WScript.Shell
$taskDesktop = [Environment]::GetFolderPath('Desktop')
$taskLinkPath = Join-Path $taskDesktop '上号开发版.lnk'
if (Test-Path -LiteralPath $taskLinkPath) {
    Copy-Item -LiteralPath $taskLinkPath -Destination (Join-Path $taskBackup 'development.lnk')
    $taskLink = $taskShell.CreateShortcut($taskLinkPath)
    # Keep the existing icon; replace the embedded launcher body with a short stable entry.
    $taskBootstrap = "& ([ScriptBlock]::Create([IO.File]::ReadAllText('" + $taskLauncher.Replace("'", "''") + "')))"
    $taskEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskBootstrap))
    $taskLink.Arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $taskEncoded
    $taskLink.Save()
}
Write-Output 'Administrator startup configured; existing app and audio sessions retained.'
