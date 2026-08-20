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
    await new Promise<void>((resolve) => setTimeout(resolve, 80));

    let sources: DesktopCapturerSource[];
    try {
      sources = await this.waitForSources(true, true);
    } catch {
      sources = await this.waitForSources(true, false).catch(() => []);
    }
    if (sources.length === 0) sources = await this.waitForSources(false, false);

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

    return sources
      .filter((source) => source.id.startsWith("screen:") || !appWindowSourceIds.has(source.id))
      .slice(0, 24)
      .map((source) => {
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
    const sources = await this.waitForSources(false);
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
