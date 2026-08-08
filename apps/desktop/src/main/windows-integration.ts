import type { WindowsIntegrationStatus } from "@private-voice/shared";
import { app } from "electron";

import { readWindowsElevationStatus } from "./windows-elevation";
import {
  readWindowsFirewallStatus,
  repairWindowsFirewallRules,
  removeWindowsFirewallRules,
} from "./windows-firewall";
import { configureWindowsStartupTask, readWindowsStartupTaskStatus } from "./windows-startup-task";

export const readWindowsIntegrationStatus = async (): Promise<WindowsIntegrationStatus> => {
  const [elevationResult, startupTaskResult, firewallResult] = await Promise.allSettled([
    readWindowsElevationStatus(),
    readWindowsStartupTaskStatus(),
    readWindowsFirewallStatus(),
  ]);
  const elevation =
    elevationResult.status === "fulfilled"
      ? elevationResult.value
      : { isElevated: false, method: "unavailable" as const };
  const startupTask =
    startupTaskResult.status === "fulfilled"
      ? startupTaskResult.value
      : {
          supported: process.platform === "win32",
          enabled: false,
          taskName: "ShangHao Auto Start",
          message: "无法读取开机启动任务状态。",
        };
  const firewall =
    firewallResult.status === "fulfilled"
      ? firewallResult.value
      : {
          supported: process.platform === "win32",
          healthy: false,
          ruleCount: 0,
          expectedRuleCount: 4,
          message: "无法读取防火墙规则状态，可尝试修复。",
        };
  return {
    platform: process.platform,
    isPackaged: app.isPackaged,
    elevation,
    startupTask,
    firewall,
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
