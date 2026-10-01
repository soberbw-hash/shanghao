import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const compareArchitectureBudgets = (previous, current, fileExists = () => true) => {
  const failures = [];
  for (const [file, ceiling] of Object.entries(current)) {
    if (
      !/^(apps|packages|native)\//.test(file) ||
      file.includes("..") ||
      !Number.isSafeInteger(ceiling) ||
      ceiling < 1
    )
      failures.push(`Invalid architecture budget: ${file}`);
    if (previous[file] !== undefined && ceiling > previous[file])
      failures.push(
        `${file}: ceiling rose from ${previous[file]} to ${ceiling}; extract an independent responsibility instead.`,
      );
  }
  for (const file of Object.keys(previous)) {
    if (current[file] === undefined && fileExists(file))
      failures.push(`${file}: an existing module lost its budget.`);
  }
  return failures;
};

const previousBudgets = (base) => {
  const read = (file) =>
    execFileSync("git", ["show", `${base}:${file}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    return JSON.parse(read("docs/architecture-budgets.json"));
  } catch {
    // The first adoption compares to the formerly inline, committed guard.
    const oldGuard = read("apps/desktop/tests/architecture-guard.test.ts");
    const entries = [...oldGuard.matchAll(/"([^"\n]+)":\s*([\d_]+)/g)].map(([, name, ceiling]) => [
      name.endsWith(".css") && !name.includes("/")
        ? `apps/desktop/src/renderer/src/styles/parts/${name}`
        : name,
      Number(ceiling.replaceAll("_", "")),
    ]);
    if (!entries.length) throw new Error("The base revision has no readable architecture budgets.");
    return Object.fromEntries(entries);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.ARCHITECTURE_BASE || "HEAD";
  if (/^0+$/.test(base)) throw new Error("Architecture base revision is unavailable.");
  const current = JSON.parse(
    readFileSync(path.join(root, "docs/architecture-budgets.json"), "utf8"),
  );
  const failures = compareArchitectureBudgets(previousBudgets(base), current, (file) =>
    existsSync(path.join(root, file)),
  );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("Architecture budgets only decreased or retained their reviewed ceilings.");
}
