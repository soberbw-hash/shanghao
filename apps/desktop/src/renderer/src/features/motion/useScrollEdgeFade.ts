import { useEffect, type RefObject } from "react";

/** Paint the fades only at the edges where the scroll viewport is clipping content. */
export function useScrollEdgeFade(
  listRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const list = listRef.current;
    const viewport = list?.parentElement;
    if (!enabled || !list || !viewport) return;
    let frame = 0;
    const update = () => {
      const { clientHeight, scrollHeight, scrollTop } = list;
      viewport.toggleAttribute("data-content-above", scrollTop > 2);
      viewport.toggleAttribute("data-content-below", scrollHeight - clientHeight - scrollTop > 2);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const resize = new ResizeObserver(schedule);
    const contents = new MutationObserver(schedule);
    resize.observe(list);
    contents.observe(list, { childList: true, subtree: true, characterData: true });
    list.addEventListener("scroll", update, { passive: true });
    list.addEventListener("load", schedule, true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      contents.disconnect();
      list.removeEventListener("scroll", update);
      list.removeEventListener("load", schedule, true);
      viewport.removeAttribute("data-content-above");
      viewport.removeAttribute("data-content-below");
    };
  }, [enabled, listRef]);
}
