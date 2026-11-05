import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { VoiceReplayClip } from "@private-voice/shared";
import { VoiceReplayLibrary } from "../../src/renderer/src/components/audio/VoiceReplayLibrary";
import "../../src/renderer/src/styles/index.css";

const clips: VoiceReplayClip[] = ["first", "second"].map((id) => ({
  id,
  title: id,
  createdAt: Date.UTC(2026, 10, 1),
  durationMs: 1006,
  byteLength: 46,
}));
const count = (key: string) => {
  document.documentElement.dataset[key] = String(
    Number(document.documentElement.dataset[key] ?? 0) + 1,
  );
};
let releaseRename: (() => void) | undefined;
let nextTranscript = "合成本地文字";
const transcripts = new Map<string, string>();
document.addEventListener("fixture-next-transcript", (event) => {
  nextTranscript = (event as CustomEvent<string>).detail;
});
Object.defineProperty(window, "desktopApi", {
  configurable: true,
  value: {
    voiceReplay: {
      list: async () => {
        count("lists");
        return structuredClone(clips);
      },
      read: async () => new Uint8Array(46),
      transcribeLocal: async (id: string) => {
        count("transcribes");
        await new Promise((resolve) => setTimeout(resolve, 80));
        const text = nextTranscript;
        nextTranscript = "合成本地文字";
        transcripts.set(id, text);
        return text;
      },
      readTranscript: async (id: string) => transcripts.get(id),
      readTranscriptDetail: async (id: string) => {
        const text = transcripts.get(id);
        return text === undefined
          ? undefined
          : {
              version: 2 as const,
              createdAt: Date.UTC(2026, 10, 1),
              text,
              sourceModel: "fixture-model",
              segments: [
                { text, startMs: 125, endMs: 750, timestampPrecision: "aligned" as const },
              ],
            };
      },
      reviseTranscriptSegment: async (
        id: string,
        _version: number,
        index: number,
        text: string,
      ) => {
        if (index !== 0) throw Error("unexpected_index");
        transcripts.set(id, text);
        return {
          version: 2 as const,
          createdAt: Date.UTC(2026, 10, 1) + 1,
          text,
          sourceModel: "fixture-model",
          segments: [
            {
              text,
              startMs: 125,
              endMs: 750,
              timestampPrecision: "aligned" as const,
              reviewStatus: "edited" as const,
            },
          ],
        };
      },
      rename: async (id: string, title: string) => {
        count("renames");
        await new Promise<void>((resolve) => {
          releaseRename = resolve;
        });
        clips.find((clip) => clip.id === id)!.title = title;
      },
      export: async () => {
        count("exports");
        await new Promise((resolve) => setTimeout(resolve, 80));
        return true;
      },
      remove: async (id: string) => {
        count("removes");
        await new Promise((resolve) => setTimeout(resolve, 80));
        clips.splice(
          clips.findIndex((clip) => clip.id === id),
          1,
        );
      },
      trim: async (_id: string, _from: number, to: number) => {
        if (to > 1006) throw Error("trim endpoint exceeds clip");
        count("trims");
        await new Promise((resolve) => setTimeout(resolve, 80));
        const next = { ...clips[0], id: "trimmed", title: "trimmed" };
        clips.push(next);
        return next;
      },
    },
  },
});
document.addEventListener("fixture-finish-rename", () => releaseRename?.());
const urls = new Set<string>();
const createUrl = URL.createObjectURL.bind(URL),
  revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createUrl(blob);
  urls.add(url);
  document.documentElement.dataset.urls = String(urls.size);
  return url;
};
URL.revokeObjectURL = (url) => {
  urls.delete(url);
  document.documentElement.dataset.urls = String(urls.size);
  revokeUrl(url);
};
function Fixture() {
  const [open, setOpen] = useState(true);
  return (
    <main style={{ padding: 24 }}>
      <button id="fixture-toggle-library" onClick={() => setOpen((value) => !value)}>
        片段库开关
      </button>
      {open && <VoiceReplayLibrary revision={0} />}
    </main>
  );
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
import.meta.hot?.dispose(() => {
  root.unmount();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = revokeUrl;
});
