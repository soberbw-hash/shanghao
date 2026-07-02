const path = require("node:path");
const { readdir, rm } = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const executablePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(projectDir, "build", "shanghao-icon-v3.ico");
  const rceditModulePath = path.join(projectDir, "node_modules", "rcedit", "lib", "index.js");
  const { rcedit } = await import(pathToFileURL(rceditModulePath).href);
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

  await rcedit(executablePath, {
    icon: iconPath,
    "file-version": context.packager.appInfo.version,
    "product-version": context.packager.appInfo.version,
    "requested-execution-level": "asInvoker",
    "version-string": {
      CompanyName: "Sober",
      FileDescription: "上号",
      InternalName: "ShangHao",
      LegalCopyright: "Copyright Sober",
      OriginalFilename: "ShangHao.exe",
      ProductName: "上号",
    },
  });
};
