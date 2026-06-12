import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const targets = [
  "dist",
  "dist-electron",
  "release",
  "out",
  "apps/desktop/dist",
  "apps/desktop/dist-electron",
  "apps/desktop/release",
  "apps/desktop/out",
  "apps/desktop/win-unpacked",
  "apps/desktop/mac-unpacked",
];

for (const target of targets) {
  await rm(path.resolve(root, target), { recursive: true, force: true });
}
