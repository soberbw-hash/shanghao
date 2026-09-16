import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ReadableTranscriptParagraph } from "@private-voice/shared";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const TranscriptParagraph = memo(function TranscriptParagraph({
  paragraph,
  name,
  onSeek,
}: {
  paragraph: ReadableTranscriptParagraph;
  name: string;
  onSeek: (ms: number) => void;
}) {
  return (
    <button
      className="transcript-paragraph"
      type="button"
      data-paragraph-id={paragraph.id}
      onClick={() => onSeek(paragraph.startMs)}
    >
      <time>{clock(paragraph.startMs)}</time>
      <strong>{name}</strong>
      <span>{paragraph.text}</span>
    </button>
  );
});

export const TranscriptParagraphList = memo(function TranscriptParagraphList({
  paragraphs,
  names,
  multipleSpeakers,
  onSeek,
}: {
  paragraphs: ReadableTranscriptParagraph[];
  names: Map<string, string>;
  multipleSpeakers: boolean;
  onSeek: (ms: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<VirtuosoHandle>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const [scrollParent, setScrollParent] = useState<HTMLElement>();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    let parent = host.current?.parentElement;
    while (parent && parent !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        setScrollParent(parent);
        break;
      }
      parent = parent.parentElement;
    }
    setReady(true);
    return () => {
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  const row = useCallback(
    (_index: number, paragraph: ReadableTranscriptParagraph) => (
      <TranscriptParagraph
        paragraph={paragraph}
        onSeek={onSeek}
        name={
          paragraph.nickname ??
          paragraph.displayNameSnapshot ??
          names.get(paragraph.speakerId) ??
          (multipleSpeakers ? `${paragraph.speakerId}（待确认）` : "说话人")
        }
      />
    ),
    [names, multipleSpeakers, onSeek],
  );
  return (
    <div
      ref={host}
      className="voice-memory-transcript"
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-paragraph-id]");
        if (!row) return;
        const current = paragraphs.findIndex(
          (paragraph) => paragraph.id === row.dataset.paragraphId,
        );
        const next = current + (event.shiftKey ? -1 : 1);
        if (current < 0 || next < 0 || next >= paragraphs.length) return;
        event.preventDefault();
        list.current?.scrollIntoView({
          index: next,
          done: () => {
            const focus = (remaining: number) => {
              const target = Array.from(
                host.current?.querySelectorAll<HTMLButtonElement>("[data-paragraph-id]") ?? [],
              ).find((button) => button.dataset.paragraphId === paragraphs[next]?.id);
              target?.focus({ preventScroll: true });
              if (!target && host.current && remaining > 0)
                focusFrame.current = requestAnimationFrame(() => focus(remaining - 1));
            };
            focus(10);
          },
        });
      }}
    >
      {ready && paragraphs.length ? (
        <Virtuoso
          ref={list}
          data={paragraphs}
          customScrollParent={scrollParent}
          useWindowScroll={!scrollParent}
          computeItemKey={(_index, paragraph) => paragraph.id}
          itemContent={row}
          increaseViewportBy={200}
        />
      ) : null}
    </div>
  );
});
