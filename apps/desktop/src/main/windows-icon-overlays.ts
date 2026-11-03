import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";
import { platformService } from "./platform/PlatformService";
import { runWindowsSystemOperation } from "./windows-system-operation";

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
  $reg = Get-Item -LiteralPath $shellKey
  $arrow = $reg.GetValue('29', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $shield = $reg.GetValue('77', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}
$blank = Join-Path $env:ProgramData 'ShangHao\transparent-overlay.ico'
$legacyBlank = '%SystemRoot%\System32\imageres.dll,197'
@{
  arrowHidden = [string]::Equals([string]$arrow, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$arrow, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
  shieldHidden = [string]::Equals([string]$shield, $blank, [System.StringComparison]::OrdinalIgnoreCase) -or [string]::Equals([string]$shield, $legacyBlank, [System.StringComparison]::OrdinalIgnoreCase)
  configured = (Test-Path -LiteralPath $blank) -and [string]::Equals([string]$arrow, $blank, [System.StringComparison]::OrdinalIgnoreCase) -and [string]::Equals([string]$shield, $blank, [System.StringComparison]::OrdinalIgnoreCase)
} | ConvertTo-Json -Compress
`;

const unsupported = (): WindowsIconOverlayStatus => ({
  supported: false,
  hidden: false,
  arrowHidden: false,
  shieldHidden: false,
  message: "此功能仅支持 Windows。",
});

export const readWindowsIconOverlayStatus = async (): Promise<WindowsIconOverlayStatus> => {
  if (!platformService.isWindows) return unsupported();
  try {
    const parsed = parsePowerShellJson<{
      arrowHidden?: boolean;
      shieldHidden?: boolean;
      configured?: boolean;
    }>((await runWindowsPowerShell(READ_SCRIPT)).stdout);
    const arrowHidden = parsed.arrowHidden === true;
    const shieldHidden = parsed.shieldHidden === true;
    return {
      supported: true,
      hidden: parsed.configured === true,
      arrowHidden,
      shieldHidden,
      message:
        arrowHidden && shieldHidden ? "已设置隐藏快捷方式标记。" : "快捷方式标记未全部隐藏。",
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
  if (!platformService.isWindows) return unsupported();
  await runWindowsSystemOperation(hidden ? "icon-hide" : "icon-restore");
  return readWindowsIconOverlayStatus();
};
