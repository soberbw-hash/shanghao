import { useEffect, useState } from "react";
import type { RecordingLibraryItem } from "@private-voice/shared";

const cache = new Map<string, number | null>();
const identity = (item: RecordingLibraryItem) =>
  JSON.stringify([item.mediaUrl, item.fileSize, item.modifiedAt]);

/** Read only metadata for the rendered cards, with two readers and bounded memory. */
export const useRecordingDurations = (items: RecordingLibraryItem[], active: boolean) => {
  const [, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const releases = new Set<() => void>();
    const pending = items.filter((item) => !cache.has(identity(item)));
    const read = (item: RecordingLibraryItem): Promise<void> =>
      new Promise((resolve) => {
        const audio = new Audio();
        const key = identity(item);
        let finished = false;
        const finish = (value?: number | null) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          audio.onloadedmetadata = audio.ondurationchange = audio.onerror = null;
          audio.removeAttribute("src");
          audio.load();
          releases.delete(release);
          if (!cancelled && value !== undefined) {
            cache.delete(key);
            cache.set(key, value);
            if (cache.size > 256) cache.delete(cache.keys().next().value!);
            setRevision((revision) => revision + 1);
          }
          resolve();
        };
        const release = () => finish();
        const timer = window.setTimeout(() => finish(null), 8_000);
        releases.add(release);
        const loaded = () => {
          if (Number.isFinite(audio.duration) && audio.duration >= 0) finish(audio.duration);
        };
        audio.onloadedmetadata = audio.ondurationchange = loaded;
        audio.onerror = () => finish(null);
        audio.preload = "metadata";
        audio.src = item.mediaUrl;
        audio.load();
      });
    const worker = async () => {
      while (!cancelled && pending.length) await read(pending.shift()!);
    };
    void worker();
    void worker();
    return () => {
      cancelled = true;
      for (const release of releases) release();
    };
  }, [items, active]);
  return (item: RecordingLibraryItem): number | null | undefined => cache.get(identity(item));
};
