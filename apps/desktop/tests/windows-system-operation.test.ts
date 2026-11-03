import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeWindowsSystemOperation,
  runWindowsSystemOperation,
} from "../src/main/windows-system-operation";
import { runWindowsPowerShell, parsePowerShellJson } from "../src/main/windows-command";
import { assertSystemOperationSender } from "../src/main/windows-integration-ipc";
import { toUserFacingError } from "../src/renderer/src/utils/userFacingError";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { windowsSystemScript } from "../src/main/windows-system-scripts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

const executable = "C:\\Apps\\O'Brian $notCode\\ShangHao.exe";
const command = (operation: Parameters<typeof encodeWindowsSystemOperation>[0]) =>
  Buffer.from(
    encodeWindowsSystemOperation(operation, executable, Date.now() + 90_000),
    "base64",
  ).toString("utf16le");

test(
  "firewall repair supplies all four display names without touching Windows rules",
  { skip: process.platform !== "win32" },
  async () => {
    const mocks = String.raw`
$script:createdNames = @()
function Get-NetFirewallRule { param($Group, $ErrorAction) @() }
function Remove-NetFirewallRule { param($ErrorAction) }
function New-NetFirewallRule {
  param($Name, $DisplayName, $Group, $Direction, $Action, $Enabled, $Profile, $Program, $Protocol, $EdgeTraversalPolicy)
  if (-not $Name -or -not $DisplayName -or -not $Program) { throw 'missing_firewall_parameter' }
  $script:createdNames += $DisplayName
}
`;
    const result = await runWindowsPowerShell(
      `${mocks}\n${windowsSystemScript("firewall-repair")}\n@($script:createdNames) | ConvertTo-Json -Compress`,
      { SHANGHAO_FIREWALL_OPERATION: "repair", SHANGHAO_FIREWALL_EXE: process.execPath },
    );
    const lines = result.stdout.trim().split(/\r?\n/);
    assert.deepEqual(JSON.parse(lines.at(-1)!), [
      "ShangHao UDP Inbound",
      "ShangHao UDP Outbound",
      "ShangHao TCP Inbound",
      "ShangHao TCP Outbound",
    ]);
  },
);

test(
  "icon changes back up and restore both values without overwriting another tool",
  { skip: process.platform !== "win32" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shanghao-icon-test-"));
    const root = `Registry::HKEY_CURRENT_USER\\Software\\ShangHaoIconTest-${randomUUID()}`;
    const shell = `${root}\\shell`,
      backup = `${root}\\backup`;
    const isolate = (script: string) =>
      script
        .replaceAll(
          "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons",
          shell,
        )
        .replaceAll(
          "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Sober\\ShangHao\\IconOverlayBackup",
          backup,
        )
        .replace(
          /Stop-Process -Name explorer[^\n]*|Start-Sleep -Milliseconds 350|Start-Process explorer\.exe/g,
          "",
        );
    const setup = `New-Item -Path '${shell}' -Force | Out-Null\nNew-ItemProperty -LiteralPath '${shell}' -Name '29' -PropertyType ExpandString -Value '%SystemRoot%\\original.dll,2' -Force | Out-Null\nNew-ItemProperty -LiteralPath '${shell}' -Name '77' -PropertyType String -Value 'original-shield' -Force | Out-Null`;
    try {
      const script = `$ErrorActionPreference='Stop'\n$env:ProgramData=$env:SHANGHAO_ICON_TEST_DIR\ntry {\n${setup}\n${isolate(windowsSystemScript("icon-hide"))}\n${isolate(windowsSystemScript("icon-hide"))}\n${isolate(windowsSystemScript("icon-restore"))}\n$k=Get-Item -LiteralPath '${shell}'\n$arrow=$k.GetValue('29',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);$kind=[string]$k.GetValueKind('29');$shield=$k.GetValue('77')\n${isolate(windowsSystemScript("icon-hide"))}\nNew-ItemProperty -LiteralPath '${shell}' -Name '77' -PropertyType String -Value 'other-tool' -Force | Out-Null\n${isolate(windowsSystemScript("icon-restore"))}\n$k=Get-Item -LiteralPath '${shell}'\n@{arrow=$arrow;kind=$kind;shield=$shield;other=$k.GetValue('77');backupPreserved=(Test-Path -LiteralPath '${backup}')} | ConvertTo-Json -Compress\n} finally { Remove-Item -LiteralPath '${root}' -Recurse -Force -ErrorAction SilentlyContinue }`;
      const result = parsePowerShellJson<{
        arrow: string;
        kind: string;
        shield: string;
        other: string;
        backupPreserved: boolean;
      }>((await runWindowsPowerShell(script, { SHANGHAO_ICON_TEST_DIR: dir })).stdout);
      assert.deepEqual(result, {
        arrow: "%SystemRoot%\\original.dll,2",
        kind: "ExpandString",
        shield: "original-shield",
        other: "other-tool",
        backupPreserved: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("privileged commands are a fixed vocabulary with literal Main-owned paths", () => {
  assert.throws(
    () => encodeWindowsSystemOperation("arbitrary-script" as never, executable, 1),
    /invalid_windows_system_operation/,
  );
  for (const target of [
    "relative.exe",
    "\\\\host\\share\\ShangHao.exe",
    "C:\\bad\n\\a.exe",
    "C:\\Apps\\a.cmd",
  ])
    assert.throws(
      () => encodeWindowsSystemOperation("firewall-repair", target, 1),
      /invalid_windows_system_target/,
    );
  const repair = command("firewall-repair");
  assert.match(repair, /O''Brian \$notCode/);
  assert.match(repair, /Wait-Job -Job \$job -Timeout 60/);
  assert.match(repair, /Stop-Job -Job \$job/);
  assert.match(repair, /ToUnixTimeMilliseconds/);
  assert.match(repair, /SHANGHAO_FIREWALL_OPERATION = 'repair'/);
});

test("UAC success, cancellation and timeout have bounded, distinct outcomes", async () => {
  let timeout: number | undefined;
  await runWindowsSystemOperation(
    "firewall-repair",
    async (script, _env, budget) => {
      timeout = budget;
      assert.match(script, /-Verb RunAs -WindowStyle Hidden/);
      assert.match(script, /Join-Path \$PSHOME 'powershell.exe'/);
      return { stdout: '{"code":0}', stderr: "" };
    },
    executable,
  );
  assert.equal(timeout, 160_000);
  for (const [code, expected] of [
    [1223, "windows_uac_cancelled"],
    [124, "windows_system_timeout"],
    [1, "windows_system_operation_failed"],
  ] as const)
    await assert.rejects(
      runWindowsSystemOperation(
        "icon-hide",
        async () => ({ stdout: JSON.stringify({ code }), stderr: "" }),
        executable,
      ),
      new RegExp(expected),
    );
  assert.equal(
    toUserFacingError(new Error("windows_uac_cancelled"), "settings").title,
    "已取消系统授权",
  );
});

test("only the live main-window frame may request system writes", () => {
  const frame = {};
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  assert.doesNotThrow(() => assertSystemOperationSender(event, window));
  assert.throws(() => assertSystemOperationSender(event, null), /untrusted/);
  assert.throws(
    () => assertSystemOperationSender({ ...event, senderFrame: {} } as IpcMainInvokeEvent, window),
    /untrusted/,
  );
  assert.throws(
    () => assertSystemOperationSender({ ...event, sender: {} } as IpcMainInvokeEvent, window),
    /untrusted/,
  );
});

test(
  "Windows parses every fixed privileged script without running it or changing system settings",
  { skip: process.platform !== "win32" },
  async () => {
    const operations = ["firewall-repair", "firewall-remove", "icon-hide", "icon-restore"] as const;
    // Parse separately to stay below the Windows command-line length limit.
    for (const operation of operations) {
      const encoded = encodeWindowsSystemOperation(operation, executable, Date.now() + 90_000);
      const result = await runWindowsPowerShell(
        `
      $source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))
      $tokens = $null; $parseErrors = $null
      $null = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
      @{ errors = $parseErrors.Count } | ConvertTo-Json -Compress
    `,
        {},
        60_000,
      );
      const parsed = parsePowerShellJson<{ errors: number }>(result.stdout);
      assert.equal(parsed.errors, 0);
    }
  },
);
