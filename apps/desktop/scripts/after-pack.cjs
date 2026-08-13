const path = require("node:path");
const { readdir, rm } = require("node:fs/promises");
const { writeInstallManifest } = require("./install-manifest.cjs");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const nativePrebuildsPath = path.join(
    context.appOutDir,
    "resources",
    "app.asar.unpacked",
    "node_modules",
    "uiohook-napi",
    "prebuilds",
  );

  try {
    const platformDirectories = await readdir(nativePrebuildsPath);
    await Promise.all(
      platformDirectories
        .filter((directory) => directory !== "win32-x64")
        .map((directory) =>
          rm(path.join(nativePrebuildsPath, directory), {
            recursive: true,
            force: true,
          }),
        ),
    );
  } catch {
    // The app still works without this optional size cleanup.
  }

  const manifest = await writeInstallManifest(context.appOutDir);
  console.log(
    `ShangHao install manifest: ${manifest.files} files, ${manifest.directories} directories`,
  );
};
