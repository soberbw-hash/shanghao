import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Music2, Pause } from "lucide-react";
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
  const font = useRef("");
  const [width, setWidth] = useState(0);
  const isEmpty = items.length === 0;
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void document.fonts
      .load(font.current, items.map((item) => item.preset.label).join(" "))
      .catch(() => undefined)
      .then(() => active && setFontRevision((revision) => revision + 1));
    return () => {
      active = false;
    };
  }, [items]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const style = getComputedStyle(element.querySelector("button") ?? element);
    font.current = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    setFontRevision((revision) => revision + 1);
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [music, isEmpty]);
  const visibleItems = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context || !width || !fontRevision) return items.slice(0, 1);
    const cell = parseFloat(font.current.split(" ")[1] ?? "12");
    context.font = font.current;
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
    const budget = (width + 6) / cell;
    const result: QuickMessageRowItem[] = [];
    let used = 0;
    for (let index = 0; index < items.length; index += 1) {
      const cost = costs[index]! / cell;
      if (used + cost > budget) break;
      result.push(items[index]!);
      used += cost;
    }
    return result;
  }, [items, music, width, fontRevision]);
  return (
    <div
      ref={root}
      className={music ? "chat-quick-music-row" : "chat-quick-replies"}
      style={!fontRevision ? { visibility: "hidden" } : undefined}
      aria-label={music ? "音乐快捷消息" : "语音快捷消息"}
    >
      {visibleItems.map((item, index) => {
        const playing = soundId === item.preset.soundId && status === "playing";
        const resumable = music && soundId === item.preset.soundId && status === "paused";
        return (
          <button
            key={`${item.preset.id}-${index}`}
            type="button"
            className={`chat-quick-reply interactive-surface inline-flex items-center gap-1 rounded-[9px] border bg-white font-medium disabled:opacity-35 ${music ? "chat-quick-music" : ""}`}
            disabled={!canSend || (coolingDown && !playing && !resumable)}
            title={`${item.preset.content}${item.enabled && item.shortcut ? ` · ${item.shortcut}` : ""}`}
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
    </div>
  );
};
