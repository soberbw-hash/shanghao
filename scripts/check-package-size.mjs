import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const [reportPath, previousPath] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--enforce");
if (!reportPath)
  throw new Error("Usage: node scripts/check-package-size.mjs <report.json> [previous.json]");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const previous = previousPath ? JSON.parse(await readFile(previousPath, "utf8")) : undefined;
const budget = JSON.parse(
  await readFile(path.join(workspace, "docs/package-size-budget.json"), "utf8"),
);
const mib = (bytes) => (bytes / 1024 ** 2).toFixed(2);
const delta = (current, old) =>
  old === undefined ? "—" : `${current >= old ? "+" : ""}${mib(current - old)} MiB`;
const fields = [
  ["Installer", report.installerBytes, previous?.installerBytes, budget.installerMiB],
  ["Unpacked", report.unpackedBytes, previous?.unpackedBytes, budget.unpackedMiB],
  ["app.asar", report.resources["app.asar"], previous?.resources?.["app.asar"], budget.appAsarMiB],
];
const componentFields = [
  ["Electron runtime", "electronRuntime"],
  ["app.asar.unpacked", "appAsarUnpacked"],
  ["FFmpeg resource", "ffmpegResource"],
  ["DeepFilter", "deepFilter"],
  ["Quick messages", "quickMessages"],
  ["Native helpers", "nativeHelpers"],
  ["Other resources", "otherResources"],
  ["Native addons (logical)", "nativeAddonsLogical"],
  ["Renderer JS (logical)", "rendererJsLogical"],
  ["Renderer CSS (logical)", "rendererCssLogical"],
  ["Renderer fonts (logical)", "rendererFontsLogical"],
  ["Renderer images (logical)", "rendererImagesLogical"],
  ["Production node_modules (logical)", "productionNodeModulesLogical"],
];
const rendererOnlyRawBytes = Object.values(report.rendererOnlyModuleCopies).reduce(
  (total, bytes) => total + bytes,
  0,
);
const issues = [];
const physicalKeys = [
  "electronRuntime",
  "appAsar",
  "appAsarUnpacked",
  "ffmpegResource",
  "deepFilter",
  "quickMessages",
  "nativeHelpers",
  "otherResources",
];
if (!physicalKeys.every((key) => Number.isSafeInteger(report.componentBytes?.[key]))) {
  issues.push("Physical component size report is incomplete");
} else {
  const physicalTotal = physicalKeys.reduce((total, key) => total + report.componentBytes[key], 0);
  if (physicalTotal !== report.unpackedBytes) {
    issues.push("Physical component sizes do not reconcile with unpacked size");
  }
}
for (const [name, bytes, , limitMiB] of fields) {
  if (bytes > limitMiB * 1024 ** 2) issues.push(`${name} exceeds ${limitMiB} MiB`);
}
if (report.ffmpegCopies.length !== budget.ffmpegCopies)
  issues.push(`Expected ${budget.ffmpegCopies} FFmpeg binary, found ${report.ffmpegCopies.length}`);
if (rendererOnlyRawBytes > budget.rendererOnlyRawMiB * 1024 ** 2)
  issues.push("Raw renderer libraries are packaged beside the Vite bundle");
if (report.nonTargetUiohookPrebuilds?.count > 0)
  issues.push("Non-target uiohook native binaries are packaged");
if (report.workspaceSourceFiles?.count > 0)
  issues.push("Unused workspace TypeScript source is packaged");
if (report.cloudbaseMiniProgramFiles?.count > 0)
  issues.push("CloudBase mini-program distribution is packaged with the Windows desktop client");
const markdown = [
  "### ShangHao package size",
  "",
  `Version: ${report.version}`,
  "",
  "| Part | Current | Change | Budget |",
  "| --- | ---: | ---: | ---: |",
  ...fields.map(
    ([name, bytes, old, limitMiB]) =>
      `| ${name} | ${mib(bytes)} MiB | ${delta(bytes, old)} | ${limitMiB} MiB |`,
  ),
  "",
  "| Component | Current | Change |",
  "| --- | ---: | ---: |",
  ...componentFields.map(([name, key]) => {
    const bytes = report.componentBytes?.[key];
    return `| ${name} | ${bytes === undefined ? "—" : `${mib(bytes)} MiB`} | ${bytes === undefined ? "—" : delta(bytes, previous?.componentBytes?.[key])} |`;
  }),
  "",
  "Logical archive entries can overlap with physical package components; do not add these rows to obtain installer size.",
  "",
  `FFmpeg copies: ${report.ffmpegCopies.length}; raw renderer libraries: ${mib(rendererOnlyRawBytes)} MiB; non-target native addons: ${report.nonTargetUiohookPrebuilds?.count ?? "not reported"}; workspace source files: ${report.workspaceSourceFiles?.count ?? "not reported"}; CloudBase mini-program files: ${report.cloudbaseMiniProgramFiles?.count ?? "not reported"}.`,
  ...(issues.length ? ["", `Budget findings: ${issues.join("; ")}.`] : []),
  "",
].join("\n");
process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
if (issues.length && process.argv.includes("--enforce")) process.exitCode = 1;
