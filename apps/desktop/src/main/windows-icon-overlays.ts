import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";

export interface WindowsIconOverlayStatus {
  supported: boolean;
  hidden: boolean;
  arrowHidden: boolean;
  shieldHidden: boolean;
  message: string;
}

const READ_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$arrow = $null
$shield = $null
if (Test-Path -LiteralPath $shellKey) {
  $arrow = Get-ItemPropertyValue -LiteralPath $shellKey -Name '29' -ErrorAction SilentlyContinue
  $shield = Get-ItemPropertyValue -LiteralPath $shellKey -Name '77' -ErrorAction SilentlyContinue
}
$blank = '%SystemRoot%\System32\imageres.dll,197'
@{
  arrowHidden = [string]::Equals([string]$arrow, $blank, [System.StringComparison]::OrdinalIgnoreCase)
  shieldHidden = [string]::Equals([string]$shield, $blank, [System.StringComparison]::OrdinalIgnoreCase)
} | ConvertTo-Json -Compress
`;

const APPLY_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
$blank = '%SystemRoot%\System32\imageres.dll,197'
New-Item -Path $shellKey -Force | Out-Null
New-Item -Path $backupKey -Force | Out-Null
$hasBackup = (Get-ItemPropertyValue -LiteralPath $backupKey -Name 'Saved' -ErrorAction SilentlyContinue) -eq 1
if (-not $hasBackup) {
  foreach ($name in @('29', '77')) {
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
New-ItemProperty -LiteralPath $shellKey -Name '77' -PropertyType String -Value $blank -Force | Out-Null
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $true; shieldHidden = $true } | ConvertTo-Json -Compress
`;

const RESTORE_SCRIPT = String.raw`
$shellKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Shell Icons'
$backupKey = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Sober\ShangHao\IconOverlayBackup'
New-Item -Path $shellKey -Force | Out-Null
foreach ($name in @('29', '77')) {
  $existed = (Get-ItemPropertyValue -LiteralPath $backupKey -Name ("Exists" + $name) -ErrorAction SilentlyContinue) -eq 1
  if ($existed) {
    $value = Get-ItemPropertyValue -LiteralPath $backupKey -Name ("Value" + $name) -ErrorAction SilentlyContinue
    New-ItemProperty -LiteralPath $shellKey -Name $name -PropertyType String -Value ([string]$value) -Force | Out-Null
  } else {
    Remove-ItemProperty -LiteralPath $shellKey -Name $name -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath $backupKey -Recurse -Force -ErrorAction SilentlyContinue
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 350
Start-Process explorer.exe
@{ arrowHidden = $false; shieldHidden = $false } | ConvertTo-Json -Compress
`;

const unsupported = (): WindowsIconOverlayStatus => ({
  supported: false,
  hidden: false,
  arrowHidden: false,
  shieldHidden: false,
  message: "此功能仅支持 Windows。",
});

const runElevatedPowerShell = async (script: string): Promise<void> => {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const launcher = String.raw`
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encoded}')
if ($process.ExitCode -ne 0) { throw "elevated_command_failed_$($process.ExitCode)" }
`;
  await runWindowsPowerShell(launcher);
};

export const readWindowsIconOverlayStatus = async (): Promise<WindowsIconOverlayStatus> => {
  if (process.platform !== "win32") return unsupported();
  try {
    const parsed = parsePowerShellJson<{ arrowHidden?: boolean; shieldHidden?: boolean }>(
      (await runWindowsPowerShell(READ_SCRIPT)).stdout,
    );
    const arrowHidden = parsed.arrowHidden === true;
    const shieldHidden = parsed.shieldHidden === true;
    return {
      supported: true,
      hidden: arrowHidden && shieldHidden,
      arrowHidden,
      shieldHidden,
      message:
        arrowHidden && shieldHidden
          ? "快捷方式小箭头和管理员盾牌已隐藏。"
          : "当前使用 Windows 默认图标标记。",
    };
  } catch {
    return {
      supported: true,
      hidden: false,
      arrowHidden: false,
      shieldHidden: false,
      message: "无法读取桌面图标标记状态。",
    };
  }
};

export const setWindowsIconOverlaysHidden = async (
  hidden: boolean,
): Promise<WindowsIconOverlayStatus> => {
  if (process.platform !== "win32") return unsupported();
  const script = hidden ? APPLY_SCRIPT : RESTORE_SCRIPT;
  await runElevatedPowerShell(script);
  return {
    supported: true,
    hidden,
    arrowHidden: hidden,
    shieldHidden: hidden,
    message: hidden ? "已隐藏快捷方式小箭头和管理员盾牌。" : "已恢复 Windows 默认图标标记。",
  };
};
