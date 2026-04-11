import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, dialog } from "electron";

import type { ProfileAvatarSelection } from "@private-voice/shared";

const avatarDirectory = path.join(app.getPath("userData"), "avatars");

const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

const mimeTypeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
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

  const normalizedAvatarPath = path.resolve(avatarPath);
  const normalizedAvatarDirectory = path.resolve(avatarDirectory);
  return normalizedAvatarPath.startsWith(normalizedAvatarDirectory);
};

const readAvatarAsDataUrl = async (avatarPath?: string): Promise<string | undefined> => {
  if (!avatarPath) {
    return undefined;
  }

  const extension = path.extname(avatarPath).toLowerCase();
  const mimeType = mimeTypeByExtension[extension];

  if (!mimeType) {
    return undefined;
  }

  const buffer = await readFile(avatarPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
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

  await mkdir(avatarDirectory, { recursive: true });
  const avatarPath = path.join(avatarDirectory, `${crypto.randomUUID()}${extension}`);
  await copyFile(sourcePath, avatarPath);

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
  avatarPath ? pathToFileURL(avatarPath).toString() : undefined;
