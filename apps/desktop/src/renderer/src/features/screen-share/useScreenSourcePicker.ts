import { useEffect, useRef, useState } from "react";
import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";

/** One picker request owns the visible list; closed and superseded requests cannot reopen it. */
export const useScreenSourcePicker = (
  prepare: () => Promise<ScreenCaptureSourceDescriptor[]>,
  cancel: () => Promise<void>,
) => {
  const [isScreenSourcePickerOpen, setOpen] = useState(false);
  const [screenSourcePickerSources, setSources] = useState<ScreenCaptureSourceDescriptor[]>([]);
  const [screenSourcePickerStatus, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [pendingIncludeSystemAudio, setPendingIncludeSystemAudio] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  const closeScreenSourcePicker = (cancelManager = true) => {
    request.current += 1;
    setOpen(false);
    setSources([]);
    setStatus("loading");
    if (cancelManager) void cancel();
  };
  const openScreenSourcePicker = async () => {
    const id = ++request.current;
    if (!isScreenSourcePickerOpen) {
      setSources([]);
      setPendingIncludeSystemAudio(false);
    }
    setStatus("loading");
    setOpen(true);
    try {
      const sources = await prepare();
      if (id !== request.current) return;
      setSources(sources);
      setStatus(sources.length ? "ready" : "empty");
    } catch {
      if (id !== request.current) return;
      setSources([]);
      setStatus("error");
    }
  };
  return {
    isScreenSourcePickerOpen,
    screenSourcePickerSources,
    screenSourcePickerStatus,
    pendingIncludeSystemAudio,
    setPendingIncludeSystemAudio,
    closeScreenSourcePicker,
    openScreenSourcePicker,
  };
};
