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
if (Test-Path -LiteralPath $shellKey) {
  $arrow = Get-ItemPropertyValue -LiteralPath $shellKey -Name '29' -ErrorAction SilentlyContinue
}
$blank = '%SystemRoot%\System32\imageres.dll,197'
@{
  arrowHidden = [string]::Equals([string]$arrow, $blank, [System.StringComparison]::OrdinalIgnoreCase)
  shieldHidden = $false
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
    const parsed = parsePowerShellJson<{ arrowHidden?: boolean; shieldHidden?: boolean }>(
      (await runWindowsPowerShell(READ_SCRIPT)).stdout,
    );
    const arrowHidden = parsed.arrowHidden === true;
    const shieldHidden = parsed.shieldHidden === true;
    return {
      supported: true,
      hidden: arrowHidden,
      arrowHidden,
      shieldHidden,
      message: arrowHidden ? "快捷方式小箭头已隐藏。" : "当前使用 Windows 默认图标标记。",
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
