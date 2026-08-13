import type { ChatImageAttachment, ChatImageMimeType } from "@private-voice/shared";

const ALLOWED_IMAGE_TYPES = new Set<ChatImageMimeType>(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 170_000;
const MAX_IMAGE_SIDE = 1_600;
const IMAGE_TYPE_BY_EXTENSION: Record<string, ChatImageMimeType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const isSupportedChatImageFile = (file: File): boolean => {
  if (ALLOWED_IMAGE_TYPES.has(file.type as ChatImageMimeType)) return true;
  const normalizedName = file.name.toLocaleLowerCase();
  return Object.keys(IMAGE_TYPE_BY_EXTENSION).some((extension) =>
    normalizedName.endsWith(extension),
  );
};

const canvasToDataUrl = (canvas: HTMLCanvasElement, quality: number): Promise<string> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("图片压缩失败，请换一张图片重试。"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
        reader.readAsDataURL(blob);
      },
      "image/webp",
      quality,
    );
  });

export const prepareChatImage = async (file: File): Promise<ChatImageAttachment> => {
  if (!isSupportedChatImageFile(file)) {
    throw new Error("仅支持 PNG、JPG 和 WebP 图片。");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("图片不能超过 8 MB。");
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("无法读取这张图片，请换一张重试。");
  });

  try {
    const initialScale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    let quality = 0.88;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("当前设备无法处理图片。");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);

      const dataUrl = await canvasToDataUrl(canvas, quality);
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) {
        return {
          mimeType: "image/webp",
          dataUrl,
          width,
          height,
          fileName: file.name.slice(0, 80),
        };
      }

      if (quality > 0.56) {
        quality -= 0.08;
      } else {
        width = Math.max(1, Math.round(width * 0.82));
        height = Math.max(1, Math.round(height * 0.82));
      }
    }
  } finally {
    bitmap.close();
  }

  throw new Error("图片内容过大，请换一张更简单的图片。");
};
