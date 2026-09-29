import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRawHeader } from "@electron/asar";

const workspace = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const desktop = path.join(workspace, "apps", "desktop");
const outputOption = process.argv.find((argument) => argument.startsWith("--output="));
if (outputOption === "--output=") throw new Error("package_size_output_missing");
const outputPath = outputOption ? path.resolve(outputOption.slice("--output=".length)) : undefined;
const inputs = process.argv.slice(2).filter((argument) => !argument.startsWith("--output="));
const unpackedRoot = path.resolve(inputs[0] ?? path.join(desktop, "release", "win-unpacked"));
const version = JSON.parse(await readFile(path.join(desktop, "package.json"), "utf8")).version;
const installer = path.resolve(
  inputs[1] ?? path.join(desktop, "release", `ShangHao-${version}-Setup-x64.exe`),
);

const fileBytes = async (file) => (await stat(file)).size;
const directoryBytes = async (directory) => {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(entryPath);
    else if (entry.isFile()) bytes += await fileBytes(entryPath);
  }
  return bytes;
};
const listPhysicalFiles = async (directory, relativeTo) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listPhysicalFiles(entryPath, relativeTo)));
    else if (entry.isFile())
      files.push({ path: path.relative(relativeTo, entryPath), bytes: await fileBytes(entryPath) });
  }
  return files;
};
const archiveBytes = (node) =>
  node.size ??
  Object.values(node.files ?? {}).reduce((total, child) => total + archiveBytes(child), 0);
const archiveGroups = (files) =>
  Object.fromEntries(
    Object.entries(files ?? {})
      .map(([name, node]) => [name, archiveBytes(node)])
      .sort((left, right) => right[1] - left[1]),
  );
const listArchiveFiles = (node, prefix = "") =>
  Object.entries(node.files ?? {}).flatMap(([name, child]) => {
    const file = prefix ? `${prefix}/${name}` : name;
    return child.files ? listArchiveFiles(child, file) : [{ path: file, bytes: child.size ?? 0 }];
  });
const hashFile = async (file) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
};

const resources = path.join(unpackedRoot, "resources");
const asar = path.join(resources, "app.asar");
const header = getRawHeader(asar).header.files;
const resourceGroups = {};
for (const entry of await readdir(resources, { withFileTypes: true })) {
  const entryPath = path.join(resources, entry.name);
  resourceGroups[entry.name] = entry.isDirectory()
    ? await directoryBytes(entryPath)
    : await fileBytes(entryPath);
}
const electronRuntimeBytes = (
  await Promise.all(
    (await readdir(unpackedRoot, { withFileTypes: true }))
      .filter((entry) => entry.name !== "resources")
      .map(async (entry) => {
        const entryPath = path.join(unpackedRoot, entry.name);
        return entry.isDirectory() ? directoryBytes(entryPath) : fileBytes(entryPath);
      }),
  )
).reduce((sum, bytes) => sum + bytes, 0);
const ffmpegResource = path.join(resources, "ffmpeg", "ffmpeg.exe");
const ffmpegDependency = path.join(
  resources,
  "app.asar.unpacked",
  "node_modules",
  "ffmpeg-static",
  "ffmpeg.exe",
);
const ffmpegCopies = [];
for (const file of [ffmpegResource, ffmpegDependency]) {
  try {
    ffmpegCopies.push({
      path: path.relative(unpackedRoot, file),
      bytes: await fileBytes(file),
      sha256: await hashFile(file),
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const rendererOnlyModules = [
  "react",
  "react-dom",
  "framer-motion",
  "gsap",
  "lucide",
  "lucide-react",
  "morphicons",
  "uisfx",
  "@fontsource-variable",
  "react-virtuoso",
  "zustand",
];
const nodeModules = archiveGroups(header.node_modules?.files);
const physicalFiles = await listPhysicalFiles(unpackedRoot, unpackedRoot);
const archiveFiles = listArchiveFiles({ files: header });
const summarizeArchiveMatches = (predicate) => {
  const matches = archiveFiles.filter((entry) => predicate(entry.path));
  return {
    count: matches.length,
    bytes: matches.reduce((total, entry) => total + entry.bytes, 0),
    files: matches.sort((left, right) => right.bytes - left.bytes),
  };
};
const archiveSum = (predicate) =>
  archiveFiles.reduce((total, entry) => total + (predicate(entry.path) ? entry.bytes : 0), 0);
const rendererAsset = (name) => name.startsWith("dist/assets/");
const rendererFont = (name) => rendererAsset(name) && /\.(?:woff2?|ttf|otf)$/i.test(name);
const rendererImage = (name) =>
  rendererAsset(name) && /\.(?:png|jpe?g|webp|svg|gif|avif)$/i.test(name);
const rendererJs = (name) => rendererAsset(name) && /\.js$/i.test(name);
const rendererCss = (name) => rendererAsset(name) && /\.css$/i.test(name);
const rendererAssetsLogicalBytes = archiveSum(rendererAsset);
const namedResourceGroups = new Set([
  "app.asar",
  "app.asar.unpacked",
  "ffmpeg",
  "deepfilter",
  "quick-messages",
  "native",
]);
const report = {
  schemaVersion: 1,
  version,
  measuredAt: new Date().toISOString(),
  installerBytes: await fileBytes(installer),
  unpackedBytes:
    electronRuntimeBytes + Object.values(resourceGroups).reduce((sum, bytes) => sum + bytes, 0),
  electronRuntimeBytes,
  resources: resourceGroups,
  archiveLogicalBytes: archiveGroups(header),
  productionNodeModules: nodeModules,
  rendererOnlyModuleCopies: Object.fromEntries(
    rendererOnlyModules.map((name) => [name, nodeModules[name] ?? 0]),
  ),
  rendererAssets: archiveGroups(header.dist?.files?.assets?.files),
  componentBytes: {
    electronRuntime: electronRuntimeBytes,
    appAsar: resourceGroups["app.asar"] ?? 0,
    appAsarUnpacked: resourceGroups["app.asar.unpacked"] ?? 0,
    ffmpegResource:
      ffmpegCopies.find((copy) => copy.path === path.relative(unpackedRoot, ffmpegResource))
        ?.bytes ?? 0,
    deepFilter: resourceGroups.deepfilter ?? 0,
    quickMessages: resourceGroups["quick-messages"] ?? 0,
    nativeHelpers: resourceGroups.native ?? 0,
    otherResources: Object.entries(resourceGroups).reduce(
      (total, [name, bytes]) => total + (namedResourceGroups.has(name) ? 0 : bytes),
      0,
    ),
    nativeAddonsLogical: archiveSum((name) => /\.node$/i.test(name)),
    rendererJsLogical: archiveSum(rendererJs),
    rendererCssLogical: archiveSum(rendererCss),
    rendererFontsLogical: archiveSum(rendererFont),
    rendererImagesLogical: archiveSum(rendererImage),
    rendererOtherAssetsLogical:
      rendererAssetsLogicalBytes -
      archiveSum(rendererJs) -
      archiveSum(rendererCss) -
      archiveSum(rendererFont) -
      archiveSum(rendererImage),
    productionNodeModulesLogical: Object.values(nodeModules).reduce(
      (total, bytes) => total + bytes,
      0,
    ),
  },
  largestPhysicalFiles: physicalFiles.sort((left, right) => right.bytes - left.bytes).slice(0, 20),
  largestArchiveFiles: archiveFiles.sort((left, right) => right.bytes - left.bytes).slice(0, 20),
  archiveSourceMaps: archiveFiles.filter((entry) => entry.path.endsWith(".map")),
  nativeAddons: summarizeArchiveMatches((name) => /\.node$/i.test(name)),
  nonTargetUiohookPrebuilds: summarizeArchiveMatches((name) =>
    /^node_modules\/uiohook-napi\/prebuilds\/(?!win32-x64\/)[^/]+\//.test(name),
  ),
  workspaceSourceFiles: summarizeArchiveMatches((name) =>
    /^node_modules\/@private-voice\/[^/]+\/src\//.test(name),
  ),
  cloudbaseMiniProgramFiles: summarizeArchiveMatches((name) =>
    name.startsWith("node_modules/@cloudbase/js-sdk/miniprogram_dist/"),
  ),
  electronLocales: (await readdir(path.join(unpackedRoot, "locales"))).sort(),
  ffmpegCopies,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await writeFile(outputPath, json, "utf8");
  process.stdout.write(`Package size report written: ${outputPath}\n`);
} else {
  process.stdout.write(json);
}
