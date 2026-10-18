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

const executable = "C:\\Apps\\O'Brian $notCode\\ShangHao.exe";
const command = (operation: Parameters<typeof encodeWindowsSystemOperation>[0]) =>
  Buffer.from(
    encodeWindowsSystemOperation(operation, executable, Date.now() + 90_000),
    "base64",
  ).toString("utf16le");

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
    const encoded = operations
      .map(
        (operation) =>
          `'${encodeWindowsSystemOperation(operation, executable, Date.now() + 90_000)}'`,
      )
      .join(",");
    // Parse all four scripts in one cold host. Hosted Windows startup can exceed
    // the product command deadline under parallel CI load; no script is executed.
    const result = await runWindowsPowerShell(
      `
      $results = @(@(${encoded}) | ForEach-Object {
      $source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($_))
      $tokens = $null; $parseErrors = $null
      $null = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
      @{ errors = $parseErrors.Count }
      })
      ConvertTo-Json -InputObject $results -Compress
    `,
      {},
      60_000,
    );
    const parsed = parsePowerShellJson<Array<{ errors: number }>>(result.stdout);
    assert.equal(parsed.length, operations.length);
    for (const entry of parsed) assert.equal(entry.errors, 0);
  },
);
