import path from "node:path";
import { createRequire } from "node:module";
import { app, dialog } from "electron";

const load = createRequire(__filename);
if (process.argv.includes("--asset-studio")) {
  // Select the independent profile before loading any voice, account or storage service.
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "asset-studio")
    : path.join(app.getAppPath(), "resources", "asset-studio");
  try {
    load(path.join(root, "desktop.cjs")).startStudio({ root });
  } catch (error) {
    void app.whenReady().then(() => {
      dialog.showErrorBox(
        "上号素材无法打开",
        error instanceof Error ? error.message : String(error),
      );
      app.exit(1);
    });
  }
} else {
  load(path.join(__dirname, "app.cjs"));
}
