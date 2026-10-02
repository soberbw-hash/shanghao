import { useEffect } from "react";
import { type GameDetectionSnapshot } from "@private-voice/shared";
import { addGameRecordingEvents } from "./gameRecordingEvents";

/** Local-only event annotations; never publish them to room presence or cloud summaries. */
export const useGameRecordingMarkers = (): void => {
  useEffect(() => {
    let initialized = false;
    let previous: string | undefined;
    let pushed = false;
    let disposed = false;
    const apply = (snapshot: GameDetectionSnapshot) => {
      const next = snapshot.gameName;
      const before = previous;
      previous = next;
      if (!initialized) {
        initialized = true;
        return;
      }
      addGameRecordingEvents(before, next);
    };
    const unsubscribe = window.desktopApi.games.onDetected((snapshot) => {
      if (!disposed) {
        pushed = true;
        apply(snapshot);
      }
    });
    void window.desktopApi.games
      .getSnapshot()
      .then((snapshot) => {
        if (!disposed && !pushed) apply(snapshot);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
};
