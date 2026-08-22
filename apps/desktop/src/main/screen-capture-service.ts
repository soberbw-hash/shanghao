import { BrowserWindow, desktopCapturer, screen, type DesktopCapturerSource } from "electron";

import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";

import { platformService } from "./platform/PlatformService";

type Log = (
  level: "info" | "warn" | "error",
  message: string,
  context?: Record<string, unknown>,
) => void;

export class ScreenCaptureService {
  private pendingSourceId: string | undefined;
  private readonly sourceCache = new Map<string, DesktopCapturerSource>();

  constructor(private readonly log?: Log) {}

  get capabilities() {
    return {
      supported: platformService.capabilities.screenCapture,
      systemAudioLoopback: platformService.capabilities.systemAudioLoopback,
    } as const;
  }

  selectSource(sourceId: string): void {
    this.pendingSourceId = sourceId;
  }

  consumeSelectedSourceId(): string | undefined {
    const sourceId = this.pendingSourceId;
    this.pendingSourceId = undefined;
    return sourceId;
  }

  setContentProtection(enabled: boolean): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setContentProtection(enabled);
    }
  }

  async listSources(): Promise<ScreenCaptureSourceDescriptor[]> {
    if (!this.capabilities.supported) return [];
    this.setContentProtection(false);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Window thumbnails make Windows Graphics Capture initialize every candidate
    // before the picker can open. Source names are enough for selection and keep
    // enumeration fast; the selected source itself is cached for the capture request.
    const sources = await this.waitForSources(false, false);

    const screenSourceIds = sources
      .filter((source) => source.id.startsWith("screen:"))
      .map((source) => source.id);
    const appWindowSourceIds = new Set(
      BrowserWindow.getAllWindows().flatMap((window) => {
        try {
          return [window.getMediaSourceId()];
        } catch {
          return [];
        }
      }),
    );

    const visibleSources = sources
      .filter((source) => source.id.startsWith("screen:") || !appWindowSourceIds.has(source.id))
      .sort(
        (left, right) =>
          Number(right.id.startsWith("screen:")) - Number(left.id.startsWith("screen:")),
      )
      .slice(0, 24);
    this.sourceCache.clear();
    for (const source of visibleSources) this.sourceCache.set(source.id, source);

    return visibleSources.map((source) => {
      const isScreen = source.id.startsWith("screen:");
      const screenIndex = isScreen ? screenSourceIds.indexOf(source.id) + 1 : 0;
      return {
        id: source.id,
        name: source.name.slice(0, 120),
        kind: isScreen ? "screen" : "window",
        displayId: source.display_id || undefined,
        displayLabel: isScreen ? `显示器 ${Math.max(1, screenIndex)} · 全屏` : undefined,
        thumbnailDataUrl: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL(),
        appIconDataUrl:
          source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined,
      } satisfies ScreenCaptureSourceDescriptor;
    });
  }

  async resolveRequestedSource(
    requestedSourceId?: string,
  ): Promise<DesktopCapturerSource | undefined> {
    const cachedSource = requestedSourceId ? this.sourceCache.get(requestedSourceId) : undefined;
    if (cachedSource) return cachedSource;

    const sources = await this.waitForSources(false);
    for (const source of sources) this.sourceCache.set(source.id, source);
    const primaryDisplayId = String(screen.getPrimaryDisplay().id);
    const selected = requestedSourceId
      ? sources.find((source) => source.id === requestedSourceId)
      : (sources.find((source) => source.display_id === primaryDisplayId) ??
        sources.find((source) => source.id.startsWith("screen:")) ??
        sources[0]);

    if (!selected) {
      this.log?.("error", "Requested screen share source is no longer available", {
        requestedSourceId,
        sourceCount: sources.length,
      });
    }
    return selected;
  }

  private enumerate(withThumbnails: boolean, fetchWindowIcons = withThumbnails) {
    return desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: withThumbnails ? { width: 240, height: 135 } : { width: 0, height: 0 },
      fetchWindowIcons,
    });
  }

  private async waitForSources(
    withThumbnails: boolean,
    fetchWindowIcons = withThumbnails,
  ): Promise<DesktopCapturerSource[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const sources = await this.enumerate(withThumbnails, fetchWindowIcons);
        if (sources.length > 0) return sources;
      } catch (error) {
        lastError = error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
    if (lastError) throw lastError;
    return [];
  }
}

export const screenCaptureService = new ScreenCaptureService();
