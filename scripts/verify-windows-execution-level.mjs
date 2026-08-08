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

if (!manifestText.includes("requireAdministrator")) {
  throw new Error(`Packaged manifest is missing requireAdministrator: ${executablePath}`);
}
if (!/uiAccess\s*=\s*["']false["']/i.test(manifestText)) {
  throw new Error(`Packaged manifest is missing uiAccess=false: ${executablePath}`);
}
if (manifestText.includes("asInvoker")) {
  throw new Error(`Packaged manifest still contains asInvoker: ${executablePath}`);
}

console.log(`Verified Windows execution level: ${executablePath}`);
