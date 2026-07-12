import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, dialog } from "electron";

import type { ProfileAvatarSelection } from "@private-voice/shared";

const avatarDirectory = path.join(app.getPath("userData"), "avatars");

const MAX_AVATAR_FILE_BYTES = 4 * 1024 * 1024;
const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const mimeTypeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const copy = {
  pickerTitle: "\u9009\u62e9\u5934\u50cf",
  imageFilter: "\u56fe\u7247",
  unsupportedType:
    "\u5f53\u524d\u53ea\u652f\u6301 PNG\u3001JPG\u3001WEBP\u3001GIF \u6216 BMP \u5934\u50cf\u3002",
  previewFailed:
    "\u5934\u50cf\u5df2\u7ecf\u4fdd\u5b58\uff0c\u4f46\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u9884\u89c8\u3002",
} as const;

const isManagedAvatarPath = (avatarPath?: string): avatarPath is string => {
  if (!avatarPath) {
    return false;
  }

  const relative = path.relative(path.resolve(avatarDirectory), path.resolve(avatarPath));
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
};

const detectImageFormat = (buffer: Buffer): { extension: string; mimeType: string } | undefined => {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: ".png", mimeType: "image/png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { extension: ".webp", mimeType: "image/webp" };
  }
  if (["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    return { extension: ".gif", mimeType: "image/gif" };
  }
  return undefined;
};

const readValidatedImage = async (
  imagePath: string,
): Promise<{ buffer: Buffer; extension: string; mimeType: string }> => {
  const fileStats = await stat(imagePath);
  if (!fileStats.isFile() || fileStats.size <= 0 || fileStats.size > MAX_AVATAR_FILE_BYTES) {
    throw new Error("头像文件必须小于 4 MB。");
  }
  const buffer = await readFile(imagePath);
  const format = detectImageFormat(buffer);
  if (!format) throw new Error(copy.unsupportedType);
  return { buffer, ...format };
};

const readAvatarAsDataUrl = async (avatarPath?: string): Promise<string | undefined> => {
  if (!avatarPath || !isManagedAvatarPath(avatarPath)) {
    return undefined;
  }

  const extension = path.extname(avatarPath).toLowerCase();
  const mimeType = mimeTypeByExtension[extension];

  if (!mimeType) {
    return undefined;
  }

  const validated = await readValidatedImage(avatarPath);
  return `data:${validated.mimeType || mimeType};base64,${validated.buffer.toString("base64")}`;
};

export const pickAvatarImage = async (
  currentAvatarPath?: string,
): Promise<ProfileAvatarSelection | undefined> => {
  const selection = await dialog.showOpenDialog({
    title: copy.pickerTitle,
    properties: ["openFile"],
    filters: [
      {
        name: copy.imageFilter,
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return undefined;
  }

  const sourcePath = selection.filePaths[0];
  if (!sourcePath) {
    return undefined;
  }

  const extension = path.extname(sourcePath).toLowerCase();

  if (!supportedImageExtensions.has(extension)) {
    throw new Error(copy.unsupportedType);
  }

  const validated = await readValidatedImage(sourcePath);
  await mkdir(avatarDirectory, { recursive: true });
  const avatarPath = path.join(avatarDirectory, `${crypto.randomUUID()}${validated.extension}`);
  await writeFile(avatarPath, validated.buffer, { flag: "wx" });

  if (currentAvatarPath && currentAvatarPath !== avatarPath) {
    await clearAvatarImage(currentAvatarPath);
  }

  const avatarDataUrl = await readAvatarAsDataUrl(avatarPath);

  if (!avatarDataUrl) {
    throw new Error(copy.previewFailed);
  }

  return {
    avatarPath,
    avatarDataUrl,
  };
};

export const readAvatarImage = async (avatarPath?: string): Promise<string | undefined> => {
  return readAvatarAsDataUrl(avatarPath);
};

export const clearAvatarImage = async (avatarPath?: string): Promise<void> => {
  if (!isManagedAvatarPath(avatarPath)) {
    return;
  }

  await rm(avatarPath, { force: true });
};

export const toAvatarFileUrl = (avatarPath?: string): string | undefined =>
  isManagedAvatarPath(avatarPath) ? pathToFileURL(avatarPath).toString() : undefined;
