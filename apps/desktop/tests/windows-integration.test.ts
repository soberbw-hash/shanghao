import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("startup task is current-user interactive, delayed and highest available", async () => {
  const startupTask = await read("../src/main/windows-startup-task.ts");
  assert.match(startupTask, /ShangHao Auto Start/);
  assert.match(startupTask, /LogonType Interactive/);
  assert.match(startupTask, /RunLevel Highest/);
  assert.match(startupTask, /PT5S/);
  assert.match(startupTask, /--shanghao-startup/);
  assert.doesNotMatch(startupTask, /-UserId\s+['"]?SYSTEM/i);
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

test("firewall repair UI blocks repeated clicks while the serialized repair is running", async () => {
  const settings = await read("../src/renderer/src/pages/SettingsPage.tsx");
  const diagnosticsCard = await read(
    "../src/renderer/src/components/settings/DiagnosticsSettingsCard.tsx",
  );
  assert.match(settings, /if \(isRepairingFirewall\) return/);
  assert.match(settings, /\.finally\(\(\) => setIsRepairingFirewall\(false\)\)/);
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
