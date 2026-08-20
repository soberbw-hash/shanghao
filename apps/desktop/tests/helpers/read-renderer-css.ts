import { readFileSync } from "node:fs";
import path from "node:path";

const importPattern = /@import\s+["']([^"']+\.css)["'];/g;

const readCssTree = (filePath: string, seen: Set<string>): string => {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return "";
  seen.add(resolved);
  const source = readFileSync(resolved, "utf8");
  let combined = source;
  for (const match of source.matchAll(importPattern)) {
    const importPath = match[1];
    if (!importPath?.startsWith(".")) continue;
    combined += `\n${readCssTree(path.resolve(path.dirname(resolved), importPath), seen)}`;
  }
  return combined;
};

export const readRendererCss = (): string =>
  readCssTree(path.resolve(process.cwd(), "src/renderer/src/styles/index.css"), new Set<string>());
