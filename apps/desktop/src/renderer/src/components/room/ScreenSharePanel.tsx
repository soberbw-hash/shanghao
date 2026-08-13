import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { GripHorizontal } from "lucide-react";

import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";
import { motionDuration } from "../../features/motion/motionSystem";
import type { ScreenShareItem } from "../../features/screen-share/types";

const ScreenShareVideo = ({ stream }: { stream: MediaStream }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = true;
    void video.play().catch(() => undefined);
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted className="screen-share-video" />;
};

const ScreenShareMedia = ({ item }: { item: ScreenShareItem }) => {
  if (item.isLocal && item.stream) {
    return (
      <div className="screen-share-self-preview" data-testid="local-share-safe-preview">
        <ScreenShareVideo stream={item.stream} />
        <span className="screen-share-self-badge">你的分享</span>
      </div>
    );
  }
  if (item.stream) return <ScreenShareVideo stream={item.stream} />;
  return <img src={item.frameDataUrl} alt="" className="screen-share-video" draggable={false} />;
};

export const ScreenSharePanel = ({
  items,
  onStopLocalShare,
  onOpenDetached,
}: {
  items: ScreenShareItem[];
  onStopLocalShare: () => void;
  onOpenDetached: (item: ScreenShareItem) => Promise<void>;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string>();
  const [isDetaching, setIsDetaching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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

  if (items.length === 0) return null;
  const primaryItem = items.find((item) => item.id === selectedId) ?? items[0];
  if (!primaryItem) return null;

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

  return (
    <div
      ref={panelRef}
      className={`screen-share-panel ${isDetaching ? "is-detaching" : ""} ${isDragging ? "is-dragging" : ""}`}
      data-testid="screen-share-panel"
      style={
        {
          "--screen-share-x": `${position.x}px`,
          "--screen-share-y": `${position.y}px`,
        } as CSSProperties & Record<string, string>
      }
    >
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
            {primaryItem.transport === "webrtc" ? "实时视频" : "服务器兜底"}
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
      <div className="screen-share-video-shell">
        <ScreenShareMedia item={primaryItem} />
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
    </div>
  );
};
