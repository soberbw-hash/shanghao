import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(desktop, "../..");
const output = path.resolve(workspace, process.argv[2] ?? "docs/renderer-bundle-audit-latest.json");
const slash = (value) => value.replaceAll("\\", "/");

const moduleLabel = (id) => {
  const normalized = slash(id).replace(/^\0/, "");
  const nodeModules = normalized.lastIndexOf("/node_modules/");
  if (nodeModules >= 0) {
    const parts = normalized.slice(nodeModules + "/node_modules/".length).split("/");
    return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  }
  if (normalized.startsWith(slash(workspace) + "/")) {
    const relative = normalized.slice(slash(workspace).length + 1);
    return relative.startsWith("packages/") ? relative.split("/").slice(0, 2).join("/") : "app source";
  }
  return "virtual/other";
};

let chunks = [];
const auditPlugin = {
  name: "shanghao-renderer-bundle-audit",
  generateBundle(_options, bundle) {
    chunks = Object.values(bundle)
      .filter((item) => item.type === "chunk")
      .map((item) => {
        const packages = new Map();
        const modules = Object.entries(item.modules).map(([id, details]) => {
          const renderedLength = details.renderedLength;
          const group = moduleLabel(id);
          packages.set(group, (packages.get(group) ?? 0) + renderedLength);
          return { id: slash(id).replace(slash(workspace) + "/", ""), group, renderedLength };
        });
        return {
          file: item.fileName,
          bytes: Buffer.byteLength(item.code),
          entry: item.isEntry,
          dynamicEntry: item.isDynamicEntry,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          packages: [...packages].map(([name, renderedLength]) => ({ name, renderedLength })).sort((a, b) => b.renderedLength - a.renderedLength),
          modules: modules.sort((a, b) => b.renderedLength - a.renderedLength),
        };
      })
      .sort((a, b) => b.bytes - a.bytes);
  },
};

await build({ configFile: path.join(desktop, "vite.config.mts"), plugins: [auditPlugin] });

const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
const initial = new Set();
const visit = (file) => {
  if (initial.has(file)) return;
  const chunk = byFile.get(file);
  if (!chunk) return;
  initial.add(file);
  for (const dependency of chunk.imports) visit(dependency);
};
for (const chunk of chunks) if (chunk.entry) visit(chunk.file);

const appearances = new Map();
for (const chunk of chunks) {
  for (const module of chunk.modules) {
    const files = appearances.get(module.id) ?? [];
    files.push(chunk.file);
    appearances.set(module.id, files);
  }
}
const duplicatedModules = [...appearances]
  .filter(([, files]) => files.length > 1)
  .map(([id, files]) => ({ id, files }));

const report = {
  generatedAt: new Date().toISOString(),
  unit: "bytes",
  moduleBreakdown: "Rollup renderedLength before final minification; use chunk bytes for actual output size",
  jsBytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
  initialJsBytes: chunks.filter((chunk) => initial.has(chunk.file)).reduce((total, chunk) => total + chunk.bytes, 0),
  lazyJsBytes: chunks.filter((chunk) => !initial.has(chunk.file)).reduce((total, chunk) => total + chunk.bytes, 0),
  duplicatedModules,
  chunks,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
console.log(`Renderer bundle report: ${output}`);
console.log(`JS ${(report.jsBytes / 2 ** 20).toFixed(2)} MiB; initial ${(report.initialJsBytes / 2 ** 20).toFixed(2)} MiB; lazy ${(report.lazyJsBytes / 2 ** 20).toFixed(2)} MiB; duplicated modules ${duplicatedModules.length}`);
