import type { WindowsIntegrationStatus } from "@private-voice/shared";
import { app } from "electron";

import { readWindowsElevationStatus } from "./windows-elevation";
import {
  readWindowsFirewallStatus,
  repairWindowsFirewallRules,
  removeWindowsFirewallRules,
} from "./windows-firewall";
import { configureWindowsStartupTask, readWindowsStartupTaskStatus } from "./windows-startup-task";
import {
  readWindowsIconOverlayStatus,
  setWindowsIconOverlaysHidden,
} from "./windows-icon-overlays";
import { platformService } from "./platform/PlatformService";

export const readWindowsIntegrationStatus = async (): Promise<WindowsIntegrationStatus> => {
  const [elevationResult, startupTaskResult, firewallResult, iconOverlaysResult] =
    await Promise.allSettled([
      readWindowsElevationStatus(),
      readWindowsStartupTaskStatus(),
      readWindowsFirewallStatus(),
      readWindowsIconOverlayStatus(),
    ]);
  const elevation =
    elevationResult.status === "fulfilled"
      ? elevationResult.value
      : { isElevated: false, method: "unavailable" as const };
  const startupTask =
    startupTaskResult.status === "fulfilled"
      ? startupTaskResult.value
      : {
          supported: platformService.isWindows,
          enabled: false,
          taskName: "ShangHao Auto Start",
          message: "无法读取开机启动任务状态。",
        };
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
    startupTask,
    firewall,
    iconOverlays,
  };
};

export const ensureWindowsFirewallRules = async (): Promise<
  WindowsIntegrationStatus["firewall"]
> => {
  const current = await readWindowsFirewallStatus();
  return current.healthy ? current : repairWindowsFirewallRules();
};

export const repairWindowsIntegrationFirewall = repairWindowsFirewallRules;
export const removeWindowsIntegrationFirewall = removeWindowsFirewallRules;
export const configureWindowsIntegrationStartup = configureWindowsStartupTask;
export const configureWindowsIconOverlays = setWindowsIconOverlaysHidden;
