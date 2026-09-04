import type { WindowsIntegrationStatus } from "@private-voice/shared";
import { app } from "electron";

import { readWindowsElevationStatus } from "./windows-elevation";
import {
  readWindowsFirewallStatus,
  repairWindowsFirewallRules,
  removeWindowsFirewallRules,
} from "./windows-firewall";
import {
  readWindowsIconOverlayStatus,
  setWindowsIconOverlaysHidden,
} from "./windows-icon-overlays";
import { platformService } from "./platform/PlatformService";

export const readWindowsIntegrationStatus = async (): Promise<WindowsIntegrationStatus> => {
  const [elevationResult, firewallResult, iconOverlaysResult] = await Promise.allSettled([
    readWindowsElevationStatus(),
    readWindowsFirewallStatus(),
    readWindowsIconOverlayStatus(),
  ]);
  const elevation =
    elevationResult.status === "fulfilled"
      ? elevationResult.value
      : { isElevated: false, method: "unavailable" as const };
  const firewall =
    firewallResult.status === "fulfilled"
      ? firewallResult.value
      : {
          supported: platformService.isWindows,
          healthy: false,
          ruleCount: 0,
          expectedRuleCount: 4,
          message: "无法读取防火墙规则状态，可尝试修复。",
        };
  const iconOverlays =
    iconOverlaysResult.status === "fulfilled"
      ? iconOverlaysResult.value
      : {
          supported: platformService.isWindows,
          hidden: false,
          arrowHidden: false,
          shieldHidden: false,
          message: "无法读取桌面图标标记状态。",
        };
  return {
    platform: platformService.capabilities.nodePlatform,
    isPackaged: app.isPackaged,
    elevation,
    firewall,
    iconOverlays,
  };
};

export const ensureWindowsFirewallRules = async (): Promise<
  WindowsIntegrationStatus["firewall"]
> => {
  const outcome = await ensureWindowsFirewallRulesWithOutcome();
  return outcome.status;
};

export interface WindowsFirewallEnsureOutcome {
  status: WindowsIntegrationStatus["firewall"];
  repairAttempted: boolean;
  repaired: boolean;
  inspectionFailed: boolean;
}

/**
 * Repairs only ShangHao's own program-scoped firewall rules. An inspection
 * failure is also repairable because recreating these four owned rules is
 * idempotent and does not reset adapters, DNS, Winsock, or third-party rules.
 */
export const ensureWindowsFirewallRulesWithOutcome = async (
  readStatus: () => Promise<WindowsIntegrationStatus["firewall"]> = readWindowsFirewallStatus,
  repair: () => Promise<WindowsIntegrationStatus["firewall"]> = repairWindowsFirewallRules,
): Promise<WindowsFirewallEnsureOutcome> => {
  let current: WindowsIntegrationStatus["firewall"] | undefined;
  let inspectionFailed = false;
  try {
    current = await readStatus();
  } catch {
    inspectionFailed = true;
  }
  if (current?.healthy) {
    return {
      status: current,
      repairAttempted: false,
      repaired: false,
      inspectionFailed,
    };
  }
  const status = await repair();
  return {
    status,
    repairAttempted: true,
    repaired: status.healthy,
    inspectionFailed,
  };
};

export const repairWindowsIntegrationFirewall = repairWindowsFirewallRules;
export const removeWindowsIntegrationFirewall = removeWindowsFirewallRules;
export const configureWindowsIconOverlays = setWindowsIconOverlaysHidden;
