import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

import { ScreenShareManager } from "./ScreenShareManager";
import type { ScreenShareItem, ScreenShareManagerSnapshot, StartScreenShareRequest } from "./types";

interface UseScreenShareOptions {
  startPublishing: (stream: MediaStream, profile: ScreenShareEncodingProfile) => Promise<void>;
  stopPublishing: () => Promise<void>;
  onSourceEnded?: () => void;
}

export const useScreenShare = ({
  startPublishing,
  stopPublishing,
  onSourceEnded,
}: UseScreenShareOptions) => {
  const managerRef = useRef<ScreenShareManager | undefined>(undefined);
  if (!managerRef.current) {
    managerRef.current = new ScreenShareManager({
      startPublishing,
      stopPublishing,
      onSourceEnded,
      writeLog: (level, message, context) =>
        window.desktopApi.app.writeLog({
          category: "webrtc",
          level,
          message,
          context,
        }),
    });
  }
  const manager = managerRef.current;
  manager.updateOptions({
    startPublishing,
    stopPublishing,
    onSourceEnded,
    writeLog: (level, message, context) =>
      window.desktopApi.app.writeLog({
        category: "webrtc",
        level,
        message,
        context,
      }),
  });
  const [snapshot, setSnapshot] = useState<ScreenShareManagerSnapshot>(() => manager.getSnapshot());

  useEffect(() => manager.subscribe(setSnapshot), [manager]);
  useEffect(
    () => () => {
      void manager.shutdown("component-unmount").finally(() => manager.destroy());
    },
    [manager],
  );

  const openSourcePicker = useCallback(() => manager.openSourcePicker(), [manager]);
  const startShare = useCallback(
    (request: StartScreenShareRequest) => manager.startShare(request),
    [manager],
  );
  const stopShare = useCallback((reason?: string) => manager.stopShare(reason), [manager]);
  const shutdown = useCallback((reason?: string) => manager.shutdown(reason), [manager]);
  const openDetachedViewer = useCallback(
    (item: ScreenShareItem) => manager.openDetachedViewer(item),
    [manager],
  );
  const syncDetachedItem = useCallback(
    (item?: ScreenShareItem) => manager.syncDetachedItem(item),
    [manager],
  );
  const closeDetachedViewer = useCallback(() => manager.closeDetachedViewer(), [manager]);
  const setDisplayMode = useCallback(
    (mode: ScreenShareManagerSnapshot["displayMode"]) => manager.setDisplayMode(mode),
    [manager],
  );

  return {
    ...snapshot,
    openSourcePicker,
    startShare,
    stopShare,
    shutdown,
    openDetachedViewer,
    syncDetachedItem,
    closeDetachedViewer,
    setDisplayMode,
  };
};
