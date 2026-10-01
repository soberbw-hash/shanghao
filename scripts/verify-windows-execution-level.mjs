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

if (!/requestedExecutionLevel\s+[^>]*level\s*=\s*["']asInvoker["']/i.test(manifestText)) {
  throw new Error(`Packaged manifest is missing asInvoker: ${executablePath}`);
}
if (!/uiAccess\s*=\s*["']false["']/i.test(manifestText)) {
  throw new Error(`Packaged manifest is missing uiAccess=false: ${executablePath}`);
}
if (/level\s*=\s*["'](?:requireAdministrator|highestAvailable)["']/i.test(manifestText)) {
  throw new Error(`Packaged manifest unexpectedly requests elevation: ${executablePath}`);
}

console.log(`Verified Windows execution level: ${executablePath}`);
