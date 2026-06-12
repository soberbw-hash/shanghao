import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
const electronBuilderCli = requireFromProject.resolve("electron-builder/out/cli/cli.js");
const env = {
  ...process.env,
  PATH: [path.join(root, "tools"), process.env.PATH].filter(Boolean).join(path.delimiter),
};

const child = spawn(process.execPath, [electronBuilderCli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
