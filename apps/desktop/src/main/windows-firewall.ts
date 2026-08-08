import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";

export const SHANGHAO_FIREWALL_GROUP = "ShangHao Network";

export interface WindowsFirewallStatus {
  supported: boolean;
  healthy: boolean;
  ruleCount: number;
  expectedRuleCount: number;
  executablePath?: string;
  message: string;
}

const FIREWALL_SCRIPT = String.raw`
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

if ($operation -eq 'remove' -or $operation -eq 'repair') {
  Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

if ($operation -eq 'repair') {
  if (-not $exePath -or -not (Test-Path -LiteralPath $exePath)) {
    throw 'firewall_executable_not_found'
  }
  New-NetFirewallRule -DisplayName $expectedNames[0] -Group $group -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol UDP -EdgeTraversalPolicy Allow | Out-Null
  New-NetFirewallRule -DisplayName $expectedNames[1] -Group $group -Direction Outbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol UDP | Out-Null
  New-NetFirewallRule -DisplayName $expectedNames[2] -Group $group -Direction Inbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol TCP -EdgeTraversalPolicy Allow | Out-Null
  New-NetFirewallRule -DisplayName $expectedNames[3] -Group $group -Direction Outbound -Action Allow -Enabled True -Profile Any -Program $exePath -Protocol TCP | Out-Null
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

const unsupportedStatus = (): WindowsFirewallStatus => ({
  supported: false,
  healthy: false,
  ruleCount: 0,
  expectedRuleCount: 4,
  message: "仅 Windows 正式版需要程序级防火墙规则。",
});

const runFirewallOperation = async (
  operation: "inspect" | "repair" | "remove",
): Promise<WindowsFirewallStatus> => {
  if (process.platform !== "win32") return unsupportedStatus();
  const executablePath = process.execPath;
  const result = await runWindowsPowerShell(FIREWALL_SCRIPT, {
    SHANGHAO_FIREWALL_OPERATION: operation,
    SHANGHAO_FIREWALL_EXE: executablePath,
  });
  const parsed = parsePowerShellJson<{
    count?: number;
    items?: Array<{ name?: string; enabled?: string; program?: string }>;
  }>(result.stdout);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const expectedNames = new Set([
    "ShangHao UDP Inbound",
    "ShangHao UDP Outbound",
    "ShangHao TCP Inbound",
    "ShangHao TCP Outbound",
  ]);
  const healthy =
    items.length === expectedNames.size &&
    items.every(
      (item) =>
        item.name &&
        expectedNames.has(item.name) &&
        item.enabled?.toLowerCase() === "true" &&
        item.program?.toLowerCase() === executablePath.toLowerCase(),
    );
  return {
    supported: true,
    healthy,
    ruleCount: Number(parsed.count) || items.length,
    expectedRuleCount: expectedNames.size,
    executablePath,
    message: healthy
      ? "防火墙规则正常（TCP/UDP 双向、全部网络配置文件）。"
      : operation === "remove"
        ? "上号专属防火墙规则已移除。"
        : "防火墙规则缺失或程序路径已变化。",
  };
};

export const readWindowsFirewallStatus = async (): Promise<WindowsFirewallStatus> =>
  runFirewallOperation("inspect");

export const repairWindowsFirewallRules = async (): Promise<WindowsFirewallStatus> =>
  runFirewallOperation("repair");

export const removeWindowsFirewallRules = async (): Promise<WindowsFirewallStatus> =>
  runFirewallOperation("remove");
