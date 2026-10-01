import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  RecordingState,
  RoomLifecycleState,
  type AppSettings,
  type RecordingLibraryItem,
} from "@private-voice/shared";
import { RecordingClipsPanel } from "../../src/renderer/src/components/settings/RecordingClipsPanel";
import { TraySettingsRows } from "../../src/renderer/src/components/settings/TraySettingsRows";
import { ToastRegion } from "../../src/renderer/src/components/layout/ToastRegion";
import { useRecordingClipPreview } from "../../src/renderer/src/hooks/useRecordingClipPreview";
import { useAccountStore } from "../../src/renderer/src/store/accountStore";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useRecordingStore } from "../../src/renderer/src/store/recordingStore";
import {
  useTrayBackground,
  useTrayRoomCommands,
} from "../../src/renderer/src/hooks/useTrayBackground";
import "../../src/renderer/src/styles/index.css";

declare global {
  interface Window {
    __clipReviewRoot?: ReturnType<typeof createRoot>;
    __clipReview: {
      ready?: boolean;
      previews: number[][];
      leaves: number;
      picks: number;
      enter?: () => void;
      recording?: RecordingLibraryItem;
      wasPreview?: () => boolean;
      resetPreview?: () => void;
    };
  }
}
window.__clipReview = { previews: [], leaves: 0, picks: 0 };
const bridge = window.desktopApi as typeof window.desktopApi & {
  review: {
    load(): Promise<{ settings: AppSettings; recording: RecordingLibraryItem; audioUrl: string }>;
    save(patch: Partial<AppSettings>): Promise<void>;
  };
};
function Review() {
  const [data, setData] = useState<{
    settings: AppSettings;
    recording: RecordingLibraryItem;
    audioUrl: string;
  }>();
  const audio = useRef<HTMLAudioElement>(null);
  const preview = useRecordingClipPreview(audio, data?.recording.id);
  window.__clipReview.wasPreview = () => preview.wasPreview.current;
  window.__clipReview.resetPreview = preview.reset;
  useTrayBackground();
  useTrayRoomCommands(
    async () => {
      window.__clipReview.leaves++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      useRoomStore.setState((state) => ({
        room: { ...state.room, lifecycleState: RoomLifecycleState.Closed },
      }));
      useRecordingStore.setState((state) => ({
        status: { ...state.status, state: RecordingState.Saved },
      }));
    },
    () => {
      window.__clipReview.picks++;
    },
  );
  useEffect(() => {
    void bridge.review.load().then((next) => {
      setData(next);
      window.__clipReview.recording = next.recording;
      window.__clipReview.ready = true;
    });
  }, []);
  window.__clipReview.enter = () => {
    useRoomStore.setState((state) => ({
      room: { ...state.room, lifecycleState: RoomLifecycleState.Open },
    }));
    useRecordingStore.setState((state) => ({
      status: { ...state.status, state: RecordingState.Recording },
    }));
  };
  if (!data) return null;
  const change = async (patch: Partial<AppSettings>) => {
    await bridge.review.save(patch);
    setData((old) => (old ? { ...old, settings: { ...old.settings, ...patch } } : old));
  };
  return (
    <>
      <audio muted preload="auto" ref={audio} src={data.audioUrl} />
      <main style={{ padding: 24 }}>
        <section className="settings-card">
          <h2>录音库</h2>
          <RecordingClipsPanel
            recording={data.recording}
            durationMs={60_000}
            settings={data.settings}
            onChange={change}
            onPreview={async (...range) => {
              window.__clipReview.previews.push(range);
              await preview.play(...range);
            }}
          />
        </section>
        <section className="settings-card" style={{ marginTop: 20 }}>
          <h2>通用</h2>
          <TraySettingsRows
            settings={data.settings}
            onChange={(patch) => {
              void change(patch);
            }}
          />
        </section>
      </main>
      <ToastRegion />
    </>
  );
}
useAccountStore.setState({
  snapshot: { status: "signed_in", configured: true, guestAllowed: false },
});
document.body.style.background = "#e7f1fc";
window.__clipReviewRoot ??= createRoot(document.getElementById("root")!);
window.__clipReviewRoot.render(
  <React.StrictMode>
    <Review />
  </React.StrictMode>,
);
