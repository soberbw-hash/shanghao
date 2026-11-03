export const APPLY_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
$blank = Join-Path $env:ProgramData 'ShangHao\transparent-overlay.ico'
$legacyBlank = '%SystemRoot%\System32\imageres.dll,197'
$iconDir = Split-Path -Parent $blank
New-Item -Path $iconDir -ItemType Directory -Force | Out-Null
$icon = New-Object byte[] 1150
$header = [Convert]::FromBase64String('AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAA=')
[Array]::Copy($header, $icon, $header.Length)
for ($row = 0; $row -lt 16; $row++) { $icon[1086 + 4 * $row] = 255; $icon[1087 + 4 * $row] = 255 }
[IO.File]::WriteAllBytes($blank, $icon)
if (-not (Test-Path -LiteralPath $shellKey)) { New-Item -Path $shellKey -Force | Out-Null }
if (-not (Test-Path -LiteralPath $backupKey)) { New-Item -Path $backupKey -Force | Out-Null }
$backupReg = Get-Item -LiteralPath $backupKey
$hasBackup = $backupReg.GetValue('Saved', 0) -eq 1
if (-not $hasBackup) {
  foreach ($name in @('29','77')) {
    $reg = Get-Item -LiteralPath $shellKey
    $value = $reg.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $exists = $null -ne $value -and -not [string]::Equals([string]$value, $blank, [System.StringComparison]::OrdinalIgnoreCase) -and -not [string]::Equals([string]$value, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
    if ($exists -and [string]$reg.GetValueKind($name) -notin @('String','ExpandString')) { throw 'icon_overlay_unsupported_value_type' }
    New-ItemProperty -LiteralPath $backupKey -Name ("Exists" + $name) -PropertyType DWord -Value ([int]$exists) -Force | Out-Null
    if ($exists) {
      New-ItemProperty -LiteralPath $backupKey -Name ("Value" + $name) -PropertyType String -Value ([string]$value) -Force | Out-Null
      New-ItemProperty -LiteralPath $backupKey -Name ("Kind" + $name) -PropertyType String -Value ([string]$reg.GetValueKind($name)) -Force | Out-Null
    }
  }
  New-ItemProperty -LiteralPath $backupKey -Name 'Saved' -PropertyType DWord -Value 1 -Force | Out-Null
}
# A previous version backed up only the arrow. Preserve its backup and capture
# the shield independently before the first write of the new overlay.
if ($hasBackup -and $null -eq $backupReg.GetValue('Exists77', $null)) {
  $reg = Get-Item -LiteralPath $shellKey
  $shield = $reg.GetValue('77', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $exists77 = $null -ne $shield -and -not [string]::Equals([string]$shield, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
  if ($exists77 -and [string]$reg.GetValueKind('77') -notin @('String','ExpandString')) { throw 'icon_overlay_unsupported_value_type' }
  New-ItemProperty -LiteralPath $backupKey -Name 'Exists77' -PropertyType DWord -Value ([int]$exists77) -Force | Out-Null
  if ($exists77) {
    New-ItemProperty -LiteralPath $backupKey -Name 'Value77' -PropertyType String -Value ([string]$shield) -Force | Out-Null
    New-ItemProperty -LiteralPath $backupKey -Name 'Kind77' -PropertyType String -Value ([string]$reg.GetValueKind('77')) -Force | Out-Null
  }
}
foreach ($name in @('29','77')) { New-ItemProperty -LiteralPath $shellKey -Name $name -PropertyType String -Value $blank -Force | Out-Null }
$verify = Get-Item -LiteralPath $shellKey
foreach ($name in @('29','77')) {
  if (-not [string]::Equals([string]$verify.GetValue($name), $blank, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'icon_overlay_write_failed' }
}
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $true; shieldHidden = $true } | ConvertTo-Json -Compress
`;

export const RESTORE_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
$blank = Join-Path $env:ProgramData 'ShangHao\transparent-overlay.ico'
$legacyBlank = '%SystemRoot%\System32\imageres.dll,197'
if (-not (Test-Path -LiteralPath $shellKey)) { New-Item -Path $shellKey -Force | Out-Null }
if (-not (Test-Path -LiteralPath $backupKey)) { throw 'icon_overlay_backup_missing' }
$backupReg = Get-Item -LiteralPath $backupKey
if ($backupReg.GetValue('Saved', 0) -ne 1) { throw 'icon_overlay_backup_missing' }
$shellReg = Get-Item -LiteralPath $shellKey
$currentArrow = $shellReg.GetValue('29', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
if ([string]::Equals([string]$currentArrow, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$currentArrow, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)) {
  $existed = $backupReg.GetValue('Exists29', 0) -eq 1
  if ($existed) {
    $value = $backupReg.GetValue('Value29', '')
    $kind = $backupReg.GetValue('Kind29', 'String')
    if ($kind -notin @('String','ExpandString')) { $kind = 'String' }
    New-ItemProperty -LiteralPath $shellKey -Name '29' -PropertyType $kind -Value ([string]$value) -Force | Out-Null
  } else {
    Remove-ItemProperty -LiteralPath $shellKey -Name '29' -ErrorAction SilentlyContinue
  }
}
# Restore the legacy UAC shield change from older versions only when it is still
# exactly the value ShangHao wrote. Never overwrite a newer user/tool setting.
$currentShield = $shellReg.GetValue('77', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
if ([string]::Equals([string]$currentShield, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$currentShield, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)) {
  $legacyExisted = $backupReg.GetValue('Exists77', 0) -eq 1
  if ($legacyExisted) {
    $legacyValue = $backupReg.GetValue('Value77', '')
    $kind = $backupReg.GetValue('Kind77', 'String')
    if ($kind -notin @('String','ExpandString')) { $kind = 'String' }
    New-ItemProperty -LiteralPath $shellKey -Name '77' -PropertyType $kind -Value ([string]$legacyValue) -Force | Out-Null
  } elseif ($null -ne $currentShield) {
    Remove-ItemProperty -LiteralPath $shellKey -Name '77' -ErrorAction SilentlyContinue
  }
}
# Keep the backup if another tool changed either value while this feature was active.
$arrowOwned = $null -eq $currentArrow -or [string]::Equals([string]$currentArrow, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$currentArrow, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
$shieldOwned = $null -eq $currentShield -or [string]::Equals([string]$currentShield, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$currentShield, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
if ($arrowOwned -and $shieldOwned) { Remove-Item -LiteralPath $backupKey -Recurse -Force -ErrorAction SilentlyContinue }
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $false; shieldHidden = $false } | ConvertTo-Json -Compress
`;
