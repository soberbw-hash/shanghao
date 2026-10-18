import { app } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { getChatLinkPreview } from "../src/main/chat-link-preview";

const profile = mkdtempSync(path.join(os.tmpdir(), "shanghao-link-preview-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);

void app.whenReady().then(async () => {
  try {
    const preview = await getChatLinkPreview(process.argv[2] ?? "https://officetool.plus/");
    const result = JSON.stringify({
      title: preview.title,
      hasDescription: Boolean(preview.description),
      hasSiteName: Boolean(preview.siteName),
      imageKind: preview.imageKind,
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
