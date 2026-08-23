import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

import { Eye, GripHorizontal } from "lucide-react";

import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";
import { motionDuration } from "../../features/motion/motionSystem";
import type {
  ScreenShareItem,
  ScreenShareTransitionOrigin,
} from "../../features/screen-share/types";
import { recordScreenSharePresentation } from "../../features/screen-share/screenSharePresentationMetrics";
import { useRenderProfiler } from "../../features/diagnostics/renderProfiler";

interface VideoFrameCallbackMetadata {
  width?: number;
  height?: number;
}

interface ScreenPresentationStats {
  framesPerSecond?: number;
  width?: number;
  height?: number;
  ambientColor?: string;
  sampledAt: number;
}

const sampleMediaAmbientColor = (source: CanvasImageSource): string | undefined => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 6;
    canvas.height = 6;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let samples = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if ((pixels[index + 3] ?? 0) < 16) continue;
      red += pixels[index] ?? 0;
      green += pixels[index + 1] ?? 0;
      blue += pixels[index + 2] ?? 0;
      samples += 1;
    }
    if (!samples) return undefined;
    return `rgba(${Math.round(red / samples)}, ${Math.round(green / samples)}, ${Math.round(
      blue / samples,
    )}, 0.3)`;
  } catch {
    return undefined;
  }
};

const ScreenShareVideo = ({
  stream,
  onPresentation,
}: {
  stream: MediaStream;
  onPresentation?: (stats: ScreenPresentationStats) => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => undefined);
    const measuredVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
      ) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    if (!measuredVideo.requestVideoFrameCallback || !onPresentation) return;
    let callbackId = 0;
    let frames = 0;
    let windowStartedAt = performance.now();
    let ambientColor: string | undefined;
    let ambientSampledAt = 0;
    const measure = (now: number, metadata: VideoFrameCallbackMetadata) => {
      frames += 1;
      if (now - ambientSampledAt >= 2_500) {
        ambientColor = sampleMediaAmbientColor(video) ?? ambientColor;
        ambientSampledAt = now;
      }
      const elapsedMs = now - windowStartedAt;
      if (elapsedMs >= 1_000) {
        onPresentation({
          framesPerSecond: (frames * 1_000) / elapsedMs,
          width: metadata.width || video.videoWidth || undefined,
          height: metadata.height || video.videoHeight || undefined,
          ambientColor,
          sampledAt: Date.now(),
        });
        frames = 0;
        windowStartedAt = now;
      }
      callbackId = measuredVideo.requestVideoFrameCallback?.(measure) ?? 0;
    };
    callbackId = measuredVideo.requestVideoFrameCallback(measure);
    return () => measuredVideo.cancelVideoFrameCallback?.(callbackId);
  }, [onPresentation, stream]);

  return <video ref={videoRef} autoPlay playsInline muted className="screen-share-video" />;
};

const ScreenShareMedia = ({
  item,
  onPresentation,
}: {
  item: ScreenShareItem;
  onPresentation: (item: ScreenShareItem, stats: ScreenPresentationStats) => void;
}) => {
  if (item.isLocal && item.stream) {
    return (
      <div className="screen-share-self-preview" data-testid="local-share-safe-preview">
        <ScreenShareVideo
          stream={item.stream}
          onPresentation={(stats) => onPresentation(item, stats)}
        />
        <span className="screen-share-self-badge">你的分享</span>
      </div>
    );
  }
  if (item.stream)
    return (
      <ScreenShareVideo
        stream={item.stream}
        onPresentation={(stats) => onPresentation(item, stats)}
      />
    );
  return <ScreenShareFallbackFrame item={item} onPresentation={onPresentation} />;
};

const ScreenShareFallbackFrame = ({
  item,
  onPresentation,
}: {
  item: ScreenShareItem;
  onPresentation: (item: ScreenShareItem, stats: ScreenPresentationStats) => void;
}) => {
  const measurementRef = useRef({
    startedAt: performance.now(),
    frames: 0,
    hasPresented: false,
    ambientSampledAt: 0,
    ambientColor: undefined as string | undefined,
  });
  return (
    <img
      src={item.frameDataUrl}
      alt=""
      className="screen-share-video"
      draggable={false}
      onLoad={(event) => {
        const measurement = measurementRef.current;
        measurement.frames += 1;
        const now = performance.now();
        const elapsedMs = now - measurement.startedAt;
        if (now - measurement.ambientSampledAt >= 2_500) {
          measurement.ambientColor =
            sampleMediaAmbientColor(event.currentTarget) ?? measurement.ambientColor;
          measurement.ambientSampledAt = now;
        }
        const sampled = {
          width: item.frameWidth,
          height: item.frameHeight,
          sampledAt: Date.now(),
          ambientColor: measurement.ambientColor,
          ...(elapsedMs >= 1_000
            ? { framesPerSecond: (measurement.frames * 1_000) / elapsedMs }
            : {}),
        };
        if (!measurement.hasPresented || elapsedMs >= 1_000) {
          measurement.hasPresented = true;
          onPresentation(item, sampled);
        }
        if (elapsedMs >= 1_000) {
          measurement.frames = 0;
          measurement.startedAt = now;
        }
      }}
    />
  );
};

const ScreenSharePanelSurface = ({
  items,
  localViewerNames,
  autoStopRemainingSeconds,
  transitionOrigin,
  onStopLocalShare,
  onOpenDetached,
}: {
  items: ScreenShareItem[];
  localViewerNames: string[];
  autoStopRemainingSeconds?: number;
  transitionOrigin?: ScreenShareTransitionOrigin;
  onStopLocalShare: () => void;
  onOpenDetached: (item: ScreenShareItem) => Promise<void>;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string>();
  const [isDetaching, setIsDetaching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [qualityNotice, setQualityNotice] = useState<string>();
  const [unfoldVector, setUnfoldVector] = useState<{
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
  }>();
  const [presentationByItem, setPresentationByItem] = useState<
    Record<string, ScreenPresentationStats>
  >({});
  useRenderProfiler("ScreenShare", {
    items,
    selectedId,
    isDetaching,
    isDragging,
  });
  const dragStateRef = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        baseX: number;
        baseY: number;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id);
    }
  }, [items, selectedId]);

  const primaryItem = items.find((item) => item.id === selectedId) ?? items[0]!;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !transitionOrigin || !primaryItem.isLocal) {
      setUnfoldVector(undefined);
      return;
    }
    const bounds = panel.getBoundingClientRect();
    setUnfoldVector({
      x: transitionOrigin.centerX - (bounds.left + bounds.width / 2),
      y: transitionOrigin.centerY - (bounds.top + bounds.height / 2),
      scaleX: Math.max(0.36, Math.min(1, transitionOrigin.width / bounds.width)),
      scaleY: Math.max(0.24, Math.min(1, transitionOrigin.height / bounds.height)),
    });
    const timer = window.setTimeout(() => setUnfoldVector(undefined), 520);
    return () => window.clearTimeout(timer);
  }, [primaryItem.id, primaryItem.isLocal, transitionOrigin]);

  useEffect(() => {
    if (!primaryItem.quality) {
      setQualityNotice(undefined);
      return;
    }
    setQualityNotice(
      `${primaryItem.quality} · ${primaryItem.quality === "1440p" ? "2K" : "清晰画面"}`,
    );
    const timer = window.setTimeout(() => setQualityNotice(undefined), 2_600);
    return () => window.clearTimeout(timer);
  }, [primaryItem.quality]);
  const primaryPresentation = presentationByItem[primaryItem.id];
  const resolutionLabel =
    primaryPresentation?.width && primaryPresentation.height
      ? `${primaryPresentation.width}×${primaryPresentation.height}`
      : undefined;
  const frameRateLabel = primaryPresentation?.framesPerSecond
    ? `${Math.round(primaryPresentation.framesPerSecond)} FPS`
    : undefined;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button")) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: position.x,
      baseY: position.y,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!dragState || dragState.pointerId !== event.pointerId || !panel || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const baseLeft = parentRect.width - panel.offsetWidth - 14;
    const desiredLeft = baseLeft + dragState.baseX + event.clientX - dragState.startX;
    const desiredTop = 14 + dragState.baseY + event.clientY - dragState.startY;
    const clampedLeft = Math.min(
      Math.max(10, desiredLeft),
      Math.max(10, parentRect.width - panel.offsetWidth - 10),
    );
    const clampedTop = Math.min(
      Math.max(10, desiredTop),
      Math.max(10, parentRect.height - panel.offsetHeight - 10),
    );
    setPosition({ x: clampedLeft - baseLeft, y: clampedTop - 14 });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = undefined;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const openDetachedViewer = async () => {
    if (isDetaching) return;
    setIsDetaching(true);
    const minimumHandoff = new Promise<void>((resolve) => {
      window.setTimeout(resolve, motionDuration.panel * 1_000);
    });
    try {
      await Promise.all([onOpenDetached(primaryItem), minimumHandoff]);
    } finally {
      setIsDetaching(false);
    }
  };

  const handlePresentation = useCallback(
    (item: ScreenShareItem, stats: ScreenPresentationStats) => {
      setPresentationByItem((current) => ({ ...current, [item.id]: stats }));
      recordScreenSharePresentation(item.id.replace(/-relay$/, ""), stats);
    },
    [],
  );

  return (
    <motion.div
      ref={panelRef}
      className={`screen-share-panel transport-${primaryItem.transport} ${
        primaryPresentation ? "has-presented-frame" : "is-awaiting-frame"
      } ${isDetaching ? "is-detaching" : ""} ${isDragging ? "is-dragging" : ""} ${
        unfoldVector ? "is-source-unfolding" : ""
      }`}
      data-testid="screen-share-panel"
      exit={{ opacity: 0, scale: 0.9, y: 8 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      style={
        {
          "--screen-share-x": `${position.x}px`,
          "--screen-share-y": `${position.y}px`,
          ...(unfoldVector
            ? {
                "--share-origin-x": `${unfoldVector.x}px`,
                "--share-origin-y": `${unfoldVector.y}px`,
                "--share-origin-scale-x": unfoldVector.scaleX,
                "--share-origin-scale-y": unfoldVector.scaleY,
              }
            : {}),
          ...(primaryPresentation?.ambientColor
            ? { "--share-ambient": primaryPresentation.ambientColor }
            : {}),
        } as CSSProperties & Record<string, string | number>
      }
    >
      <AnimatePresence>
        {qualityNotice ? (
          <motion.span
            className="screen-share-quality-notice"
            initial={{ opacity: 0, y: -5, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
          >
            {qualityNotice}
          </motion.span>
        ) : null}
      </AnimatePresence>
      <div
        className="screen-share-panel-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <GripHorizontal className="screen-share-drag-handle" aria-hidden="true" />
        <div>
          <p className="screen-share-kicker">屏幕分享</p>
          <strong>{primaryItem.title}</strong>
          <span className="screen-share-transport">
            {primaryItem.transport === "webrtc" ? "实时视频" : "网络受限 · 备用画面"}
          </span>
          <span className="screen-share-presentation-status" aria-live="polite">
            {resolutionLabel || "正在等待首帧"}
            {frameRateLabel ? ` · ${frameRateLabel}` : ""}
          </span>
        </div>
        <div className="screen-share-panel-actions">
          <button
            type="button"
            className="screen-share-icon-action"
            data-icon-motion="expand"
            disabled={isDetaching}
            onClick={() => void openDetachedViewer()}
            title="在独立窗口中观看"
            aria-label="在独立窗口中观看"
          >
            <AnimatedControlIcon name="overlay" className="h-3.5 w-3.5" />
          </button>
          {primaryItem.isLocal ? (
            <button type="button" className="screen-share-stop" onClick={onStopLocalShare}>
              停止
            </button>
          ) : null}
        </div>
      </div>
      {primaryItem.isLocal ? (
        <div
          className={`screen-share-viewers ${localViewerNames.length ? "has-viewers" : "is-empty"}`}
          aria-live="polite"
          title={localViewerNames.length ? `正在观看：${localViewerNames.join("、")}` : undefined}
        >
          <Eye aria-hidden="true" />
          <span>
            {localViewerNames.length
              ? `正在观看：${localViewerNames.join("、")}`
              : autoStopRemainingSeconds !== undefined
                ? `暂无观看者 · ${autoStopRemainingSeconds} 秒后自动停止`
                : "正在等待好友观看"}
          </span>
        </div>
      ) : null}
      <div className="screen-share-video-shell" aria-busy={!primaryPresentation}>
        <ScreenShareMedia item={primaryItem} onPresentation={handlePresentation} />
      </div>
      {items.length > 1 ? (
        <div className="screen-share-stack" role="tablist" aria-label="切换共享画面">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === primaryItem.id}
              className={item.id === primaryItem.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              {item.title.replace(" 正在分享", "").replace("你正在分享", "你")}
            </button>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
};

export const ScreenSharePanel = (props: Parameters<typeof ScreenSharePanelSurface>[0]) => (
  <AnimatePresence initial={false}>
    {props.items.length ? <ScreenSharePanelSurface key="screen-share-panel" {...props} /> : null}
  </AnimatePresence>
);
