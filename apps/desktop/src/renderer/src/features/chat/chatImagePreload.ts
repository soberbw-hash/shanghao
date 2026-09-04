const MAX_PRELOADED_CHAT_IMAGES = 12;
const decodedImages = new Map<string, { image: HTMLImageElement; promise: Promise<void> }>();

export const preloadChatImage = (dataUrl: string): Promise<void> => {
  const cached = decodedImages.get(dataUrl);
  if (cached) return cached.promise;

  const image = new Image();
  image.decoding = "async";
  const pending = new Promise<void>((resolve) => {
    image.onload = () => {
      if (typeof image.decode !== "function") {
        resolve();
        return;
      }
      void image
        .decode()
        .catch(() => undefined)
        .then(resolve);
    };
    image.onerror = () => resolve();
    image.src = dataUrl;
    if (image.complete) image.onload?.(new Event("load"));
  });
  // Keep the decoded image alive while it is in the small LRU. Retaining only
  // the promise allowed Chromium to discard the bitmap and decode it again on click.
  decodedImages.set(dataUrl, { image, promise: pending });
  if (decodedImages.size > MAX_PRELOADED_CHAT_IMAGES) {
    const oldest = decodedImages.keys().next().value as string | undefined;
    if (oldest) decodedImages.delete(oldest);
  }
  return pending;
};

export const preloadAdjacentChatImages = (urls: string[], activeIndex: number): void => {
  if (urls.length < 2) return;
  const previous = urls[(activeIndex - 1 + urls.length) % urls.length];
  const next = urls[(activeIndex + 1) % urls.length];
  if (previous) void preloadChatImage(previous);
  if (next && next !== previous) void preloadChatImage(next);
};
