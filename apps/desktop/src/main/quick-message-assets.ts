import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

export const QUICK_MESSAGE_MEDIA_PROTOCOL = "shanghao-quick-message";
export const QUICK_MESSAGE_MEDIA_MIME_TYPE = "audio/aac";

export const resolveQuickMessagePackDirectory = async (): Promise<string> => {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "quick-messages")]
    : [
        path.join(app.getAppPath(), "resources", "quick-messages"),
        path.join(process.cwd(), "apps", "desktop", "resources", "quick-messages"),
      ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next development/package candidate.
    }
  }
  throw new Error("quick_message_assets_missing");
};

const decodeRelativeAssetPath = (rawUrl: string): string | undefined => {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${QUICK_MESSAGE_MEDIA_PROTOCOL}:` || url.hostname !== "audio") {
      return undefined;
    }
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
    if (
      segments.length < 2 ||
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.includes("/") ||
          segment.includes("\\") ||
          segment.includes("\0"),
      )
    ) {
      return undefined;
    }
    const relativePath = path.join(...segments);
    return path.extname(relativePath).toLowerCase() === ".aac" ? relativePath : undefined;
  } catch {
    return undefined;
  }
};

export const createQuickMessageMediaResponse = async (rawUrl: string): Promise<Response> => {
  const relativePath = decodeRelativeAssetPath(rawUrl);
  if (!relativePath) return new Response("Not found", { status: 404 });

  const sourceDirectory = path.resolve(await resolveQuickMessagePackDirectory());
  const filePath = path.resolve(sourceDirectory, relativePath);
  const relative = path.relative(sourceDirectory, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return new Response("Not found", { status: 404 });
    return new Response(await readFile(filePath), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(fileStat.size),
        "Content-Type": QUICK_MESSAGE_MEDIA_MIME_TYPE,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
