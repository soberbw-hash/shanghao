import { app } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getChatLinkPreview } from "../src/main/chat-link-preview";

app.setPath("userData", mkdtempSync(path.join(os.tmpdir(), "shanghao-link-preview-")));

void app.whenReady().then(async () => {
  try {
    const preview = await getChatLinkPreview(process.argv[2] ?? "https://officetool.plus/");
    const result = JSON.stringify({
      title: preview.title,
      imageBytes: preview.imageDataUrl?.length ?? 0,
    });
    console.log(result);
    if (process.env.SHANGHAO_LINK_PREVIEW_RESULT) {
      writeFileSync(process.env.SHANGHAO_LINK_PREVIEW_RESULT, result, "utf8");
    }
    process.exitCode = preview.imageDataUrl ? 0 : 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
