import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/main/window.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(
  `${source.slice(source.indexOf("const getWindowIcon ="), source.indexOf("const applyBrandIdentity ="))}\nexport { getWindowIcon };`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;

const iconHarness = (isWindows: boolean, missingIco = false) => {
  const paths: string[] = [];
  const sizes: unknown[] = [];
  const exports = {} as { getWindowIcon: () => { path?: string; resized?: boolean } };
  runInNewContext(compiled, {
    exports,
    platformService: { isWindows },
    getIconPath: () => "official.ico",
    getBuildAssetPath: (name: string) => name,
    nativeImage: {
      createFromPath: (path: string) => {
        paths.push(path);
        return {
          path,
          isEmpty: () => missingIco && path.endsWith(".ico"),
          resize: (size: unknown) => {
            sizes.push(size);
            return { path, resized: true };
          },
        };
      },
      createEmpty: () => ({}),
    },
  });
  return { ...exports, paths, sizes };
};

test("Windows uses ICO-backed NativeImage without flattening its size frames", () => {
  const state = iconHarness(true);
  assert.equal(state.getWindowIcon().path, "official.ico");
  assert.deepEqual(state.paths, ["official.ico"]);
  assert.deepEqual(state.sizes, []);
});

test("missing Windows ICO scales the PNG fallback instead of creating 1254 px HICONs", () => {
  const state = iconHarness(true, true);
  assert.equal(state.getWindowIcon().resized, true);
  assert.equal(JSON.stringify(state.sizes), JSON.stringify([{ width: 32, height: 32 }]));
});

test("other platforms preserve their original PNG loading", () => {
  const state = iconHarness(false);
  assert.equal(state.getWindowIcon().path, "icon.png");
  assert.deepEqual(state.sizes, []);
});
