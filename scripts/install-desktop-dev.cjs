const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
require("../apps/desktop/tests/electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "dev-shortcut-setup",
);
app.setAppUserModelId("com.sober.shanghao.dev.setup");
app.whenReady().then(() => {
  try {
    const root = path.resolve(__dirname, "..");
    const application = path.join(root, "apps", "desktop");
    const destination = path.join(process.env.LOCALAPPDATA, "Programs", "ShangHaoDev");
    fs.mkdirSync(destination, { recursive: true });
    const backup = path.join(
      process.env.LOCALAPPDATA,
      "ShangHao-brand-backups",
      `dev-launcher-${Date.now()}`,
    );
    fs.mkdirSync(backup, { recursive: true });
    for (const name of [
      "start-dev.mjs",
      "desktop-dev-runtime.mjs",
      "launch-dev.cmd",
      "launch-dev-admin.cmd",
      "launch-dev.vbs",
      "launch-dev.ps1",
    ]) {
      if (fs.existsSync(path.join(destination, name)))
        fs.copyFileSync(path.join(destination, name), path.join(backup, name));
    }
    for (const folder of [
      app.getPath("desktop"),
      path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
    ]) {
      for (const name of ["上号（开发版）.lnk", "上号开发版.lnk"]) {
        const shortcut = path.join(folder, name);
        if (fs.existsSync(shortcut))
          fs.copyFileSync(
            shortcut,
            path.join(
              backup,
              `${folder === app.getPath("desktop") ? "desktop" : "start-menu"}-${name}`,
            ),
          );
      }
    }
    fs.copyFileSync(
      path.join(root, "scripts", "start-desktop-dev.mjs"),
      path.join(destination, "start-dev.mjs"),
    );
    fs.copyFileSync(
      path.join(root, "scripts", "desktop-dev-runtime.mjs"),
      path.join(destination, "desktop-dev-runtime.mjs"),
    );
    const launcher = require("./desktop-dev-shortcut.cjs").developmentPowerShellScript(
      application,
      root,
      destination,
    );
    fs.writeFileSync(
      path.join(destination, "launch-dev.ps1"),
      Buffer.concat([Buffer.from([255, 254]), Buffer.from(launcher, "utf16le")]),
    );
    fs.writeFileSync(
      path.join(destination, "launch-dev.cmd"),
      `@echo off\r\nstart "" "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(launcher, "utf16le").toString("base64")}\r\n`,
    );
    fs.writeFileSync(
      path.join(destination, "launch-dev-admin.cmd"),
      `@echo off\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -WindowStyle Hidden -Command "$taskShell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'; Start-Process -FilePath $taskShell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(launcher, "utf16le").toString("base64")}'"\r\n`,
    );
    const load = createRequire(path.join(application, "package.json"));
    load("tsx/cjs");
    app.getAppPath = () => application;
    load(
      path.join(application, "src", "main", "development-shortcuts.ts"),
    ).repairDevelopmentShortcuts();
    console.log("上号开发版入口已安装，原启动脚本已备份。");
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
