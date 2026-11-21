import { readFile } from "node:fs/promises";
import path from "node:path";

const executablePath = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("Usage: node scripts/verify-windows-execution-level.mjs <ShangHao.exe>");
}

const bytes = await readFile(executablePath);
const ascii = bytes.toString("latin1");
const utf16 = bytes.toString("utf16le");
const manifestText = `${ascii}\n${utf16}`;

const executionLevels = [...manifestText.matchAll(/<requestedExecutionLevel\b[^>]*>/gi)];
if (
  executionLevels.length === 0 ||
  executionLevels.some(
    ([entry]) =>
      !/\blevel\s*=\s*["']asInvoker["']/i.test(entry) ||
      !/\buiAccess\s*=\s*["']false["']/i.test(entry),
  )
) {
  throw new Error(`Packaged manifest must request asInvoker and uiAccess=false: ${executablePath}`);
}

console.log(`Verified Windows execution level: ${executablePath}`);
