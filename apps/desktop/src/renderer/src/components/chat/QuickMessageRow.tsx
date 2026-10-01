import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Music2, Pause } from "lucide-react";
import type { QuickMessagePreset } from "@private-voice/shared";

export interface QuickMessageRowItem {
  preset: QuickMessagePreset;
  shortcut: string;
  enabled: boolean;
}

// CJK and emoji take a full character cell; Latin uses its measured advance.
const characterCells = (label: string, context: CanvasRenderingContext2D, cell: number) =>
  Array.from(label).reduce(
    (sum, character) => sum + Math.max(0.5, context.measureText(character).width / cell),
    0,
  );

export const QuickMessageRow = ({
  items,
  music = false,
  canSend,
  coolingDown,
  soundId,
  status,
  onSend,
}: {
  items: QuickMessageRowItem[];
  music?: boolean;
  canSend: boolean;
  coolingDown: boolean;
  soundId?: string;
  status: string;
  onSend: (item: QuickMessageRowItem, source: HTMLButtonElement) => void;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const button = root.current?.querySelector("button");
    const style = getComputedStyle(button ?? root.current!);
    void document.fonts
      .load(
        `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
        items.map((item) => item.preset.label).join(" "),
      )
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .then(() => {
        if (active) setFontRevision((revision) => revision + 1);
      });
    return () => {
      active = false;
    };
  }, [items]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const pages = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context || !width || !fontRevision) return [items.slice(0, 1)];
    const style = getComputedStyle(root.current!.querySelector("button") ?? root.current!);
    const cell = parseFloat(style.fontSize) || 12;
    context.font = `${style.fontWeight} ${cell}px ${style.fontFamily}`;
    const costs = items.map(
      ({ preset }) =>
        Math.max(
          characterCells(preset.label, context, cell) * cell,
          context.measureText(preset.label).width,
        ) +
        16 +
        (music ? 16 : 0) +
        6,
    );
    const needsPages = costs.reduce((sum, cost) => sum + cost, -6) > width;
    const budget = Math.max(1, (width - (needsPages ? 36 : 0)) / cell);
    const result: QuickMessageRowItem[][] = [];
    let used = 0;
    for (let index = 0; index < items.length; index += 1) {
      const cost = costs[index]! / cell;
      if (!result.length || (used + cost > budget && result.at(-1)!.length)) {
        result.push([]);
        used = 0;
      }
      result.at(-1)!.push(items[index]!);
      used += cost;
    }
    return result.length ? result : [[]];
  }, [items, music, width, fontRevision]);
  const currentPage = page % pages.length;
  return (
    <div
      ref={root}
      className={music ? "chat-quick-music-row" : "chat-quick-replies"}
      aria-label={music ? "音乐快捷消息" : "语音快捷消息"}
    >
      {pages[currentPage]!.map((item, index) => {
        const playing = soundId === item.preset.soundId && status === "playing";
        const resumable = music && soundId === item.preset.soundId && status === "paused";
        return (
          <button
            key={`${item.preset.id}-${index}`}
            type="button"
            className={`chat-quick-reply interactive-surface inline-flex items-center gap-1 rounded-[9px] border bg-white font-medium disabled:opacity-35 ${music ? "chat-quick-music" : ""}`}
            disabled={!canSend || (coolingDown && !playing && !resumable)}
            title={`${item.preset.content}${item.shortcut ? ` · ${item.shortcut}` : ""}`}
            onClick={(event) => onSend(item, event.currentTarget)}
          >
            {music ? (
              playing ? (
                <Pause className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <Music2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              )
            ) : null}
            <span>{item.preset.label}</span>
          </button>
        );
      })}
      {pages.length > 1 ? (
        <button
          type="button"
          className="chat-quick-reply chat-quick-more interactive-surface rounded-[9px] border bg-white"
          onClick={() => setPage(currentPage + 1)}
          aria-label={`查看更多${music ? "音乐" : "语音"}，当前第 ${currentPage + 1} / ${pages.length} 页`}
          title={`更多 · ${currentPage + 1}/${pages.length}`}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
};
