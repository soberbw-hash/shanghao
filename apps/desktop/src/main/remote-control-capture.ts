import { randomUUID } from "node:crypto";
import type {
  RemoteControlRect,
  RemoteControlShareGeometry,
} from "../../../../packages/shared/src/types/remote-control.types";

export interface RemoteCaptureDisplay {
  id: string;
  dip: RemoteControlRect;
  physical: RemoteControlRect;
}
const validRect = (r: RemoteControlRect) =>
  [r?.x, r?.y, r?.width, r?.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

/** Main-only approved source ownership. Enumerating/selecting a source alone grants nothing. */
export class RemoteControlCapture {
  private current?: RemoteControlShareGeometry;
  private revision = 0;
  private generation = 0;
  private frameAt = -Infinity;
  constructor(
    private readonly readDisplays: () => RemoteCaptureDisplay[],
    private readonly now = () => performance.now(),
  ) {}

  approve(source: { id: string; display_id?: string }): RemoteControlShareGeometry | undefined {
    this.clear();
    // Window sharing is always read-only. Never guess a monitor from a window rectangle.
    if (!source.id.startsWith("screen:") || !source.display_id) return undefined;
    const displays = this.readDisplays();
    const display = displays.find((item) => item.id === source.display_id);
    if (
      !display ||
      !displays.length ||
      displays.some((item) => !validRect(item.dip) || !validRect(item.physical))
    )
      return undefined;
    const left = Math.min(...displays.map((item) => item.physical.x));
    const top = Math.min(...displays.map((item) => item.physical.y));
    const right = Math.max(...displays.map((item) => item.physical.x + item.physical.width));
    const bottom = Math.max(...displays.map((item) => item.physical.y + item.physical.height));
    this.current = {
      kind: "screen",
      shareSessionId: randomUUID(),
      captureHandle: randomUUID(),
      displayId: display.id,
      geometryVersion: ++this.revision,
      displayBoundsDip: { ...display.dip },
      displayBoundsPhysical: { ...display.physical },
      virtualDesktopBoundsPhysical: { x: left, y: top, width: right - left, height: bottom - top },
    };
    return this.read();
  }
  read(): RemoteControlShareGeometry | undefined {
    return this.current ? structuredClone(this.current) : undefined;
  }
  get lastVideoFrameAtMs(): number {
    return this.frameAt;
  }
  markFrame(handle: string, geometryVersion: number): boolean {
    if (handle !== this.current?.captureHandle || geometryVersion !== this.current.geometryVersion)
      return false;
    this.frameAt = this.now();
    return true;
  }
  clear(): void {
    this.generation++;
    this.current = undefined;
    this.frameAt = -Infinity;
  }
  get operationGeneration(): number {
    return this.generation;
  }
}
