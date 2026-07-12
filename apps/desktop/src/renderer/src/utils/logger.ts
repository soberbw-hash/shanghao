import type { LogCategory } from "@private-voice/shared";

import { desktopApi } from "./desktopApi";

export const writeRendererLog = async (
  category: LogCategory,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
): Promise<void> => {
  try {
    await desktopApi.app.writeLog({ category, level, message, context });
  } catch {
    // Logging must never interrupt the renderer or expose context to DevTools.
  }
};
