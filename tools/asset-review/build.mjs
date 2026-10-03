import { createRequire } from "node:module";
import { readFile, readdir, mkdir, copyFile, writeFile, stat, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderer = path.join(root, "apps/desktop/src/renderer/src");
const assetsRoot = path.join(renderer, "assets");
const bundled = process.argv.includes("--bundle");
const output = bundled
  ? path.join(root, "apps/desktop/resources/asset-studio")
  : path.join(os.homedir(), "Desktop", "上号素材审核");
const distAssets = path.join(root, "apps/desktop/dist/assets");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sharedAssets = new Map();
if (bundled) {
  for (const file of await readdir(distAssets)) {
    if (/\.(png|jpe?g|webp|svg|ico)$/i.test(file))
      sharedAssets.set(digest(await readFile(path.join(distAssets, file))), file);
  }
}
const req = createRequire(path.join(root, "apps/desktop/package.json"));
const esbuild = createRequire(req.resolve("tsup"))("esbuild");
const version = JSON.parse(
  await readFile(path.join(root, "apps/desktop/package.json"), "utf8"),
).version;
const existing = await readFile(path.join(output, "manifest.json"), "utf8").catch(() => undefined);
if (await stat(path.join(output, "index.html")).catch(() => undefined)) {
  if (!existing || JSON.parse(existing).kind !== "shanghao-asset-review")
    throw new Error("Review folder contains an unrelated index.html; refusing to overwrite.");
}
await mkdir(path.join(output, "assets"), { recursive: true });
const files = execFileSync(
  "git",
  [
    "-C",
    root,
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "apps/desktop/src/renderer/src/assets",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter((file) => /\.(png|jpe?g|webp|svg|ico)$/i.test(file));
const sourceFiles = [];
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory() && item.name !== "assets") await collect(file);
    else if (/\.tsx?$/.test(item.name)) sourceFiles.push(await readFile(file, "utf8"));
  }
}
await collect(renderer);
const source = sourceFiles.join("\n");
const games = JSON.parse(
  await readFile(path.join(assetsRoot, "games/screens/catalog.json"), "utf8"),
);
const labels = {
  "clock.png": "时钟表盘原图",
  "calendar-blank-v2.png": "当前空白日历",
  "calendar.png": "旧日历原图",
  "window-frame-v2.png": "当前窗框",
  "window.png": "旧窗户",
  "door.png": "离开区的门",
  "workstation.png": "当前桌面与显示器",
  "environment-v3-extended.png": "当前扩展房间底图",
  "environment-v2.png": "旧房间底图",
  "curtain-ceiling-v2.png": "当前窗帘",
  "foreground-leaves-v2.png": "当前前景叶子",
  "weather-day.png": "窗外晴天",
  "weather-cloudy.png": "窗外阴天",
  "weather-rain.png": "窗外下雨",
  "weather-snow.png": "窗外下雪",
  "weather-night.png": "窗外夜晚",
  "cabinet.png": "房间收藏柜",
  "window-sky.png": "当前空闲屏保",
  "aquarium.png": "保留的水族箱屏保",
};
const assets = [];
files.push(
  "docs/branding/github-avatar.png",
  "apps/desktop/build/shanghao-icon-v4.ico",
  "tools/asset-review/assets/studio-icon.png",
  "tools/asset-review/assets/studio-icon.ico",
);
for (const file of files) {
  const absolute = path.join(root, file),
    branding =
      file === "docs/branding/github-avatar.png" ||
      file === "apps/desktop/build/shanghao-icon-v4.ico" ||
      file.startsWith("tools/asset-review/assets/studio-icon."),
    relative = branding
      ? `branding/${path.basename(file)}`
      : path.relative(assetsRoot, absolute).replaceAll("\\", "/");
  const sharedFile = sharedAssets.get(digest(await readFile(absolute)));
  const destination = path.join(output, "assets", relative);
  if (!sharedFile) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(absolute, destination);
  }
  const name = path.basename(file),
    referenced = source.includes(`/${name}`);
  const category = branding
    ? "品牌图标"
    : relative.startsWith("scenes/")
      ? "房间与天气"
      : relative.startsWith("games/")
        ? "游戏原图"
        : relative.startsWith("account-avatars/")
          ? "账号头像"
          : relative.startsWith("avatars/")
            ? "房间角色与动画"
            : relative.startsWith("ai/")
              ? "AI 助手"
              : "其他图片";
  const oldGameScene = /^games\/.*-scene\.webp$/.test(relative);
  assets.push({
    relative,
    url: sharedFile ? `../app.asar/dist/assets/${sharedFile}` : `./assets/${relative}`,
    ...(sharedFile ? { bundledFile: sharedFile } : {}),
    sourcePath: file,
    label:
      (file.startsWith("tools/asset-review/assets/studio-icon.")
        ? name.endsWith(".ico")
          ? "上号素材 Windows 图标 · 九档尺寸"
          : "上号素材 · 浅色图标"
        : branding
          ? name.endsWith(".ico")
            ? "上号 Windows 图标 · 九档尺寸"
            : "上号官方图标 · 原稿"
          : labels[name]) ||
      (relative.startsWith("games/screens/")
        ? games.find((game) => game.file === name)?.name + " · 场景原图"
        : name),
    group: category,
    note: file.startsWith("tools/asset-review/assets/studio-icon.")
      ? "素材工具专用浅色图标；主软件官方图标保持原样。"
      : branding
        ? "用户提供的官方原稿，保持原样；支持复制和下载。"
        : oldGameScene
          ? "保留的上一版场景；当前新画面见游戏显示器。"
          : referenced
            ? "当前源码有引用；最终叠加效果见房间组件或游戏显示器。"
            : "当前 Renderer 未直接引用，保留图片供审核；不代表正在使用。",
  });
}
const manifest = {
  kind: "shanghao-asset-review",
  version,
  generatedAt: new Date().toISOString(),
  sourceRoot: bundled ? "" : root,
  packaged: bundled,
  assets,
  games,
};
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
await esbuild.build({
  entryPoints: [path.join(root, "tools/asset-review/ReviewApp.tsx")],
  outfile: path.join(output, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  minify: true,
  nodePaths: [path.join(root, "apps/desktop/node_modules")],
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": '{"DEV":false,"MODE":"production"}',
  },
  alias: {
    "@private-voice/shared": path.join(root, "packages/shared/src/index.ts"),
    "@private-voice/ui": path.join(root, "packages/ui/src/index.ts"),
  },
  plugins: [
    {
      name: "review-assets",
      setup(build) {
        build.onLoad({ filter: /\.(png|jpe?g|webp|svg|ico)$/ }, (args) => {
          const relative = path.relative(assetsRoot, args.path).replaceAll("\\", "/");
          if (relative.startsWith("../")) throw new Error("Unexpected asset outside review source");
          return {
            contents: `export default ${JSON.stringify(assets.find((asset) => asset.relative === relative)?.url ?? `./assets/${relative}`)}`,
            loader: "js",
          };
        });
        build.onLoad({ filter: /\.(css|wav|mp3|aac)$/ }, () => ({
          contents: 'export default "";',
          loader: "js",
        }));
      },
    },
  ],
});
const cssName = (await readdir(distAssets)).find((name) => /^styles-.*\.css$/.test(name));
if (!cssName)
  throw new Error(
    "Build the current renderer with corepack pnpm --dir apps/desktop build:renderer first.",
  );
let css = await readFile(path.join(distAssets, cssName), "utf8");
for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
  const relative = match[1].replace(/["']/g, "");
  if (/^(?:data:|https?:|#)/.test(relative)) continue;
  const file = path.resolve(distAssets, relative);
  if (!file.startsWith(distAssets + path.sep))
    throw new Error("Unexpected stylesheet resource outside dist/assets");
  const target = path.join(output, "assets", relative);
  if (bundled) {
    css = css.replaceAll(match[0], `url("../../app.asar/dist/assets/${relative}")`);
    continue;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}
await writeFile(path.join(output, "assets/product.css"), css);
await copyFile(
  path.join(root, "tools/asset-review/review.css"),
  path.join(output, "assets/review.css"),
);
const payload = JSON.stringify(manifest).replaceAll("<", "\\u003c");
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>上号素材</title><link rel="stylesheet" href="./assets/product.css"><link rel="stylesheet" href="./assets/review.css"></head><body><div id="root"></div><script>window.reviewManifest=${payload};</script><script src="./app.js"></script></body></html>`,
);
for (const name of ["desktop.cjs", "preload.cjs", "launch.cjs"])
  await copyFile(path.join(root, "tools/asset-review", name), path.join(output, name));
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify({ name: "shanghao-asset-studio", version, main: "launch.cjs" }),
);
await copyFile(
  path.join(root, "tools/asset-review/assets/studio-icon.ico"),
  path.join(output, "studio.ico"),
);
// Keep an independent runtime beside the review snapshot so it survives source cleanup.
if (!bundled) {
  const electronRuntime = path.dirname(req.resolve("electron/package.json")) + "/dist";
  const runtimeVersion = (await readFile(path.join(electronRuntime, "version"), "utf8")).trim();
  const oldRuntime = path.join(output, "runtime");
  const oldVersion = await readFile(path.join(oldRuntime, "version"), "utf8").catch(() => "");
  const runtime =
    oldVersion.trim() === runtimeVersion
      ? oldRuntime
      : path.join(output, "runtime-" + runtimeVersion);
  if (
    (await readFile(path.join(runtime, "version"), "utf8").catch(() => "")).trim() !==
    runtimeVersion
  )
    await cp(electronRuntime, runtime, { recursive: true, force: false, errorOnExist: true });
  if (process.platform === "win32") {
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const shortcut = path.join(os.homedir(), "Desktop", "上号素材.lnk");
    const script = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${quote(shortcut)}); $s.TargetPath=${quote(path.join(runtime, "electron.exe"))}; $s.Arguments=${quote('"' + output + '"')}; $s.WorkingDirectory=${quote(output)}; $s.IconLocation=${quote(path.join(output, "assets/branding/studio-icon.ico"))}; $s.Description='查看、复制、下载上号素材并保存审核意见'; $s.Save()`;
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  }
}
console.log(`Created ${assets.length} image previews: ${path.join(output, "index.html")}`);
if (process.argv.includes("--serve")) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
  };
  createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(output, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(output + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const bytes = await readFile(file);
      response.writeHead(200, {
        "content-type": types[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end();
    }
  }).listen(45741, "127.0.0.1", () => console.log("Review page: http://127.0.0.1:45741"));
}
