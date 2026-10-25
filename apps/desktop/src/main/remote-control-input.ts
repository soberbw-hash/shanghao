import type {
  RemoteControlInputEvent,
  RemoteControlNativeEvent,
  RemoteControlNativePoint,
  RemoteControlRect,
  RemoteControlShareGeometry,
  RemoteControlViewerGeometry,
} from "../../../../packages/shared/src/types/remote-control.types";

export const finite = (...values: number[]): boolean => values.every(Number.isFinite);
export const validRect = (r: RemoteControlRect): boolean =>
  Boolean(
    r &&
    finite(r.x, r.y, r.width, r.height) &&
    Math.abs(r.x) <= 1_000_000 &&
    Math.abs(r.y) <= 1_000_000 &&
    r.width >= 1 &&
    r.height >= 1 &&
    r.width <= 262_144 &&
    r.height <= 262_144,
  );
export const containsRect = (outer: RemoteControlRect, inner: RemoteControlRect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
export const sameRect = (a: RemoteControlRect, b: RemoteControlRect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Pure viewer helper. Black bars and viewport clipping do not produce input. */
export const normalizeRemotePointer = (
  view: RemoteControlViewerGeometry,
  clientX: number,
  clientY: number,
): { x: number; y: number } | undefined => {
  const r = view.viewport;
  if (
    !validRect(r) ||
    !finite(clientX, clientY, view.videoWidth, view.videoHeight, view.zoom, view.panX, view.panY) ||
    view.videoWidth <= 0 ||
    view.videoHeight <= 0 ||
    view.zoom < 0.1 ||
    view.zoom > 8 ||
    clientX < r.x ||
    clientX > r.x + r.width ||
    clientY < r.y ||
    clientY > r.y + r.height
  )
    return;
  const scale = Math.min(r.width / view.videoWidth, r.height / view.videoHeight) * view.zoom;
  const width = view.videoWidth * scale,
    height = view.videoHeight * scale;
  const x = (clientX - (r.x + (r.width - width) / 2 + view.panX)) / width;
  const y = (clientY - (r.y + (r.height - height) / 2 + view.panY)) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : undefined;
};

const namedKeys = new Set([
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
  "Space",
  "Tab",
  "Enter",
  "Backspace",
  "Delete",
  "Insert",
  "Escape",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "CapsLock",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "NumpadEnter",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumLock",
]);
const validKey = (code: string): boolean =>
  typeof code === "string" &&
  (/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2]))$/.test(code) || namedKeys.has(code));
const point = (
  event: { x: number; y: number },
  share: RemoteControlShareGeometry,
): RemoteControlNativePoint | undefined => {
  if (!finite(event.x, event.y) || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) return;
  const physical = share.displayBoundsPhysical,
    dip = share.displayBoundsDip,
    virtual = share.virtualDesktopBoundsPhysical;
  const xPhysical = physical.x + Math.round(event.x * (physical.width - 1));
  const yPhysical = physical.y + Math.round(event.y * (physical.height - 1));
  return {
    xPhysical,
    yPhysical,
    xDip: dip.x + ((xPhysical - physical.x) * dip.width) / physical.width,
    yDip: dip.y + ((yPhysical - physical.y) * dip.height) / physical.height,
    absoluteX: Math.round(((xPhysical - virtual.x) / Math.max(1, virtual.width - 1)) * 65535),
    absoluteY: Math.round(((yPhysical - virtual.y) / Math.max(1, virtual.height - 1)) * 65535),
  };
};
export const toNativeRemoteControlEvent = (
  event: RemoteControlInputEvent,
  share: RemoteControlShareGeometry,
): RemoteControlNativeEvent | undefined => {
  if (!event || typeof event !== "object") return;
  if (event.kind === "key")
    return validKey(event.code) &&
      typeof event.pressed === "boolean" &&
      (event.repeat === undefined || typeof event.repeat === "boolean")
      ? { kind: "key", code: event.code, pressed: event.pressed, repeat: event.repeat === true }
      : undefined;
  if (event.kind === "text")
    return typeof event.text === "string" &&
      event.text.length > 0 &&
      [...event.text].length <= 128 &&
      [...event.text].every((character) => {
        const code = character.codePointAt(0)!;
        return (
          !(code >= 0xd800 && code <= 0xdfff) &&
          (code === 9 || code === 10 || (code >= 32 && code !== 127))
        );
      })
      ? { kind: "text", text: event.text }
      : undefined;
  if (!["pointer", "button", "wheel"].includes(event.kind)) return;
  const mapped = point(event as { x: number; y: number }, share);
  if (!mapped) return;
  if (event.kind === "pointer") return { kind: "pointer", ...mapped };
  if (event.kind === "button")
    return ["left", "right", "middle"].includes(event.button) && typeof event.pressed === "boolean"
      ? { kind: "button", button: event.button, pressed: event.pressed, ...mapped }
      : undefined;
  if (
    event.kind === "wheel" &&
    finite(event.deltaX, event.deltaY) &&
    Math.abs(event.deltaX) <= 1200 &&
    Math.abs(event.deltaY) <= 1200
  )
    return { kind: "wheel", deltaX: event.deltaX, deltaY: event.deltaY, ...mapped };
};
