import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ensureWindowsFirewallRulesWithOutcome } from "../src/main/windows-integration";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("packaged Windows executable requires administrator without uiAccess", async () => {
  const builder = await read("../electron-builder.yml");
  const verifier = await read("../../../scripts/verify-windows-execution-level.mjs");
  assert.match(builder, /requestedExecutionLevel:\s*requireAdministrator/);
  assert.match(builder, /signAndEditExecutable:\s*true/);
  assert.match(verifier, /uiAccess\\s\*=/);
  assert.match(verifier, /false/);
  assert.match(verifier, /asInvoker/);
});

test("legacy startup task support only removes the old auto-login task", async () => {
  const startupTask = await read("../src/main/windows-startup-task.ts");
  assert.match(startupTask, /ShangHao Auto Start/);
  assert.match(startupTask, /Unregister-ScheduledTask/);
  assert.match(startupTask, /removeWindowsStartupTask/);
  assert.doesNotMatch(startupTask, /Register-ScheduledTask/);
  assert.doesNotMatch(startupTask, /--shanghao-startup/);
});

test("firewall repair owns exactly four program-scoped TCP and UDP rules", async () => {
  const firewall = await read("../src/main/windows-firewall.ts");
  assert.match(firewall, /ShangHao Network/);
  assert.equal((firewall.match(/New-NetFirewallRule/g) ?? []).length, 4);
  assert.match(firewall, /-Program \$exePath -Protocol UDP/);
  assert.match(firewall, /-Program \$exePath -Protocol TCP/);
  assert.match(firewall, /EdgeTraversalPolicy Allow/);
  assert.match(firewall, /-Profile Any/);
  assert.match(firewall, /queueFirewallOperation/);
  assert.match(firewall, /-Name \$expectedRuleNames\[0\]/);
  assert.match(firewall, /firewallOperationQueue = result\.then/);
});

test("network permission self-heal repairs missing rules and reports the outcome", async () => {
  let repairs = 0;
  const outcome = await ensureWindowsFirewallRulesWithOutcome(
    async () => ({
      supported: true,
      healthy: false,
      ruleCount: 2,
      expectedRuleCount: 4,
      message: "rules missing",
    }),
    async () => {
      repairs += 1;
      return {
        supported: true,
        healthy: true,
        ruleCount: 4,
        expectedRuleCount: 4,
        message: "repaired",
      };
    },
  );
  assert.equal(repairs, 1);
  assert.equal(outcome.repairAttempted, true);
  assert.equal(outcome.repaired, true);
  assert.equal(outcome.status.healthy, true);
});

test("network permission self-heal repairs after inspection fails but leaves healthy rules alone", async () => {
  let repairs = 0;
  const failedInspection = await ensureWindowsFirewallRulesWithOutcome(
    async () => Promise.reject(new Error("access denied")),
    async () => {
      repairs += 1;
      return {
        supported: true,
        healthy: true,
        ruleCount: 4,
        expectedRuleCount: 4,
        message: "repaired",
      };
    },
  );
  assert.equal(failedInspection.inspectionFailed, true);
  assert.equal(failedInspection.repaired, true);

  const healthy = await ensureWindowsFirewallRulesWithOutcome(
    async () => ({
      supported: true,
      healthy: true,
      ruleCount: 4,
      expectedRuleCount: 4,
      message: "healthy",
    }),
    async () => {
      repairs += 1;
      throw new Error("should not repair");
    },
  );
  assert.equal(repairs, 1);
  assert.equal(healthy.repairAttempted, false);
});

test("network permission self-heal runs in background and only notifies after an attempted repair", async () => {
  const main = await read("../src/main/index.ts");
  assert.match(main, /void autoRepairWindowsNetworkPermissions\(\)/);
  assert.match(main, /if \(!outcome\.repairAttempted\) return/);
  assert.match(main, /网络权限已自动修复/);
  assert.match(main, /TCP\/UDP 语音连接权限/);
});

test("firewall repair UI blocks repeated clicks while the serialized repair is running", async () => {
  const settings = await read("../src/renderer/src/pages/SettingsPage.tsx");
  const diagnosticsCard = await read(
    "../src/renderer/src/components/settings/DiagnosticsSettingsCard.tsx",
  );
  assert.match(settings, /if \(isRepairingFirewall\) return/);
  assert.match(settings, /\.finally\(\(\) => setIsRepairingFirewall\(false\)\)/);
  assert.match(settings, /TCP\/UDP 双向规则已正常启用。/);
  assert.match(diagnosticsCard, /后台已尝试修复/);
  assert.match(diagnosticsCard, /disabled=\{isRepairingFirewall\}/);
  assert.match(diagnosticsCard, /修复中…/);
});

test("uninstaller removes only ShangHao startup and firewall integration", async () => {
  const installer = await read("../build/installer.nsh");
  assert.match(installer, /ShangHao Auto Start/);
  assert.match(installer, /ShangHao Network/);
  assert.doesNotMatch(installer, /Get-NetFirewallRule\s+\|/);
});

test("installer validates the owned-directory marker and never recursively removes install root", async () => {
  const installer = await read("../build/installer.nsh");
  assert.match(installer, /ShangHao\.InstallRoot\.v1/);
  assert.match(installer, /ensureShangHaoInstallMarker/);
  assert.match(installer, /resources\\app\.asar/);
  assert.match(installer, /Uninstall\*\.exe/);
  assert.doesNotMatch(installer, /RMDir\s+\/r\s+"\$INSTDIR"/);
  assert.doesNotMatch(installer, /RMDir\s+\/r\s+"\$INSTDIR\\(?:locales|resources|swiftshader)"/);
  assert.doesNotMatch(installer, /taskkill\.exe/i);
});
