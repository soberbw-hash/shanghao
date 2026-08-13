const path = require("node:path");
const { readdir, writeFile } = require("node:fs/promises");

const MANIFEST_FILE_NAME = ".shanghao-install-manifest";
const MANIFEST_HEADER = "ShangHao.InstallManifest.v1";

const toSafeRelativePath = (root, target) => {
  const relative = path.relative(root, target);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Unsafe ShangHao install manifest path: ${target}`);
  }
  return relative.replaceAll("/", "\\");
};

const collectInstalledEntries = async (root) => {
  const files = [];
  const directories = [];

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (entry.name === MANIFEST_FILE_NAME) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toSafeRelativePath(root, absolutePath);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  await visit(root);
  directories.sort((left, right) => {
    const depthDifference = right.split("\\").length - left.split("\\").length;
    return depthDifference || right.localeCompare(left, "en");
  });
  return { files, directories };
};

const writeInstallManifest = async (appOutDir) => {
  const root = path.resolve(appOutDir);
  const { files, directories } = await collectInstalledEntries(root);
  const lines = [
    MANIFEST_HEADER,
    ...files.map((entry) => `F|${entry}`),
    ...directories.map((entry) => `D|${entry}`),
    "",
  ];
  await writeFile(path.join(root, MANIFEST_FILE_NAME), lines.join("\r\n"), "utf8");
  return { files: files.length, directories: directories.length };
};

module.exports = {
  MANIFEST_FILE_NAME,
  MANIFEST_HEADER,
  collectInstalledEntries,
  writeInstallManifest,
};
