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
    for (const name of ["start-dev.mjs", "launch-dev.cmd", "launch-dev.vbs"]) {
      if (fs.existsSync(path.join(destination, name)))
        fs.copyFileSync(path.join(destination, name), path.join(backup, name));
    }
    fs.copyFileSync(
      path.join(root, "scripts", "start-desktop-dev.mjs"),
      path.join(destination, "start-dev.mjs"),
    );
    const command = `"${path.join(application, "node_modules", "electron", "dist", "electron.exe")}" "${path.join(destination, "start-dev.mjs")}" "${root}"`;
    const vbs = `Set runner = CreateObject("WScript.Shell")\r\nrunner.Environment("Process")("ELECTRON_RUN_AS_NODE") = "1"\r\nresult = runner.Run("${command.replaceAll('"', '""')}", 0, True)\r\nIf result <> 0 Then runner.Popup "Startup failed. See %LOCALAPPDATA%\\Programs\\ShangHaoDev\\start-dev.log", 0, "ShangHao Dev", 16\r\n`;
    fs.writeFileSync(
      path.join(destination, "launch-dev.vbs"),
      Buffer.concat([Buffer.from([255, 254]), Buffer.from(vbs, "utf16le")]),
    );
    fs.writeFileSync(
      path.join(destination, "launch-dev.cmd"),
      '@echo off\r\nstart "" "%SystemRoot%\\System32\\wscript.exe" "%~dp0launch-dev.vbs"\r\n',
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
