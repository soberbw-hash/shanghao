import { APPLY_SCRIPT, RESTORE_SCRIPT } from "./windows-icon-overlay-scripts";

export const FIREWALL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$group = 'ShangHao Network'
$operation = $env:SHANGHAO_FIREWALL_OPERATION
$exePath = $env:SHANGHAO_FIREWALL_EXE
$expectedRuleNames = @(
  'ShangHao-UDP-Inbound',
  'ShangHao-UDP-Outbound',
  'ShangHao-TCP-Inbound',
  'ShangHao-TCP-Outbound'
)
$expectedNames = @(
  'ShangHao UDP Inbound',
  'ShangHao UDP Outbound',
  'ShangHao TCP Inbound',
  'ShangHao TCP Outbound'
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

try { $rules = @(Get-NetFirewallRule -Group $group -ErrorAction Stop) }
catch {
  if ($_.CategoryInfo.Category -ne 'ObjectNotFound') { throw }
  $rules = @()
}
$items = @($rules | ForEach-Object {
  $application = $_ | Get-NetFirewallApplicationFilter -ErrorAction Stop
  @{
    name = $_.DisplayName
    enabled = [string]$_.Enabled
    direction = [string]$_.Direction
    program = $application.Program
  }
})
@{ count = $items.Count; items = $items } | ConvertTo-Json -Compress -Depth 4
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
