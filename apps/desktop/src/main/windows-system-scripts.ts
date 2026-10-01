export const FIREWALL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$group = 'ShangHao Network'
$operation = $env:SHANGHAO_FIREWALL_OPERATION
$exePath = $env:SHANGHAO_FIREWALL_EXE
$expectedNames = @(
  'ShangHao UDP Inbound',
  'ShangHao UDP Outbound',
  'ShangHao TCP Inbound',
  'ShangHao TCP Outbound'
)
$expectedRuleNames = @(
  'ShangHao-UDP-Inbound',
  'ShangHao-UDP-Outbound',
  'ShangHao-TCP-Inbound',
  'ShangHao-TCP-Outbound'
)

if ($operation -eq 'remove' -or $operation -eq 'repair') {
  Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

if ($operation -eq 'repair') {
  if (-not $exePath -or -not (Test-Path -LiteralPath $exePath)) {
    throw 'firewall_executable_not_found'
  }
  New-NetFirewallRule -Name $expectedRuleNames[0] -DisplayName $expectedNames[0] -Group $group -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol UDP -EdgeTraversalPolicy Allow | Out-Null
  New-NetFirewallRule -Name $expectedRuleNames[1] -DisplayName $expectedNames[1] -Group $group -Direction Outbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol UDP | Out-Null
  New-NetFirewallRule -Name $expectedRuleNames[2] -DisplayName $expectedNames[2] -Group $group -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol TCP -EdgeTraversalPolicy Allow | Out-Null
  New-NetFirewallRule -Name $expectedRuleNames[3] -DisplayName $expectedNames[3] -Group $group -Direction Outbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol TCP | Out-Null
}

$rules = @(Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue)
$items = @($rules | ForEach-Object {
  $application = $_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
  @{
    name = $_.DisplayName
    enabled = [string]$_.Enabled
    direction = [string]$_.Direction
    program = $application.Program
  }
})
@{ count = $items.Count; items = $items } | ConvertTo-Json -Compress -Depth 4
`;

const APPLY_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
$blank = '%SystemRoot%\System32\imageres.dll,197'
New-Item -Path $shellKey -Force | Out-Null
New-Item -Path $backupKey -Force | Out-Null
$hasBackup = (Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Saved' -ErrorAction SilentlyContinue) -eq 1
if (-not $hasBackup) {
  foreach ($name in @('29')) {
    $value = Get-ItemPropertyValue -LiteralPath $shellKey -Name $name -ErrorAction SilentlyContinue
    $exists = $null -ne $value -and -not [string]::Equals([string]$value, $blank, [System.StringComparison]::OrdinalIgnoreCase)
    New-ItemProperty -LiteralPath $backupKey -Name ("Exists" + $name) -PropertyType DWord -Value ([int]$exists) -Force | Out-Null
    if ($exists) {
      New-ItemProperty -LiteralPath $backupKey -Name ("Value" + $name) -PropertyType String -Value ([string]$value) -Force | Out-Null
    }
  }
  New-ItemProperty -LiteralPath $backupKey -Name 'Saved' -PropertyType DWord -Value 1 -Force | Out-Null
}
New-ItemProperty -LiteralPath $shellKey -Name '29' -PropertyType String -Value $blank -Force | Out-Null
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $true; shieldHidden = $false } | ConvertTo-Json -Compress
`;

const RESTORE_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
$blank = '%SystemRoot%\System32\imageres.dll,197'
New-Item -Path $shellKey -Force | Out-Null
$currentArrow = Get-ItemPropertyValue -LiteralPath $shellKey -Name '29' -ErrorAction SilentlyContinue
if ([string]::Equals([string]$currentArrow, $blank, [System.StringComparison]::OrdinalIgnoreCase)) {
  $existed = (Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Exists29' -ErrorAction SilentlyContinue) -eq 1
  if ($existed) {
    $value = Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Value29' -ErrorAction SilentlyContinue
    New-ItemProperty -LiteralPath $shellKey -Name '29' -PropertyType String -Value ([string]$value) -Force | Out-Null
  } else {
    Remove-ItemProperty -LiteralPath $shellKey -Name '29' -ErrorAction SilentlyContinue
  }
}
# Restore the legacy UAC shield change from older versions only when it is still
# exactly the value ShangHao wrote. Never overwrite a newer user/tool setting.
$currentShield = Get-ItemPropertyValue -LiteralPath $shellKey -Name '77' -ErrorAction SilentlyContinue
if ([string]::Equals([string]$currentShield, $blank, [System.StringComparison]::OrdinalIgnoreCase)) {
  $legacyExisted = (Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Exists77' -ErrorAction SilentlyContinue) -eq 1
  if ($legacyExisted) {
    $legacyValue = Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Value77' -ErrorAction SilentlyContinue
    New-ItemProperty -LiteralPath $shellKey -Name '77' -PropertyType String -Value ([string]$legacyValue) -Force | Out-Null
  } elseif ($null -ne $currentShield) {
    Remove-ItemProperty -LiteralPath $shellKey -Name '77' -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath $backupKey -Recurse -Force -ErrorAction SilentlyContinue
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $false; shieldHidden = $false } | ConvertTo-Json -Compress
`;

export type WindowsSystemOperation =
  "firewall-repair" | "firewall-remove" | "icon-hide" | "icon-restore";
export const windowsSystemScript = (operation: WindowsSystemOperation): string => {
  switch (operation) {
    case "firewall-repair":
    case "firewall-remove":
      return FIREWALL_SCRIPT;
    case "icon-hide":
      return APPLY_SCRIPT;
    case "icon-restore":
      return RESTORE_SCRIPT;
    default:
      throw new Error("invalid_windows_system_operation");
  }
};
