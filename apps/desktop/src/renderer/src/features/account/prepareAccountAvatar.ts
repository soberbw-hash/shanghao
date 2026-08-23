const MAX_AVATAR_BYTES = 500 * 1024;
const MAX_AVATAR_EDGE = 512;

const estimatedBytes = (dataUrl: string): number => {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((encoded.length * 3) / 4);
};

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("account_avatar_invalid"));
    image.src = dataUrl;
  });

/** Resizes and compresses selected images so users never have to manually prepare an avatar. */
export const prepareAccountAvatar = async (dataUrl: string): Promise<string> => {
  const image = await loadImage(dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("account_avatar_invalid");

  const scale = Math.min(1, MAX_AVATAR_EDGE / Math.max(sourceWidth, sourceHeight));
  for (const edgeScale of [1, 0.82, 0.68]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale * edgeScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale * edgeScale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("account_avatar_invalid");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.74, 0.62, 0.5]) {
      const prepared = canvas.toDataURL("image/webp", quality);
      if (prepared.startsWith("data:image/webp") && estimatedBytes(prepared) <= MAX_AVATAR_BYTES) {
        return prepared;
      }
    }
  }
  throw new Error("account_avatar_invalid");
};
