/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "audio-icons-metadata");
const timer = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  try {
    require("tsx/cjs");
    const { ApplicationAudioService } = require("../src/main/application-audio-service.ts");
    const { readApplicationAudioIcons } = require("../src/main/application-audio-icons.ts");
    const service = new ApplicationAudioService({
      musicOnly: true,
      executablePath: path.resolve(
        __dirname,
        "../../../native/target-application-audio-picker/release/shanghao-core.exe",
      ),
      loadIcons: (rows) =>
        readApplicationAudioIcons(rows, async (executable) =>
          (await app.getFileIcon(executable, { size: "normal" }))
            .resize({ width: 40, height: 40 })
            .toDataURL(),
        ),
    });
    const { sources } = await service.listSources();
    const icons = sources.filter((source) => source.appIconDataUrl);
    const sanitized = icons.map((source, index) => ({
      ...source,
      id: "native-icon-" + index,
      name: source.processName,
    }));
    fs.writeFileSync(
      path.resolve(__dirname, "../../../artifacts/application-audio-native-icons.json"),
      JSON.stringify(sanitized),
    );
    console.log(
      JSON.stringify({
        sources: sources.length,
        actualApplicationIcons: icons.length,
        musicOnly: true,
        noScreenCapture: true,
        noAudioCapture: true,
        rawExecutablePathsExposed: sources.some((source) => source.executablePath || source.pid),
      }),
    );
    await service.close();
    clearTimeout(timer);
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    app.exit(1);
  }
});
