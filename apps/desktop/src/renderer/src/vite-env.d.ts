/// <reference types="vite/client" />

import type { DesktopApi, ScreenShareViewerApi } from "@private-voice/shared";

declare global {
  interface Window {
    desktopApi: DesktopApi;
    screenShareViewerApi: ScreenShareViewerApi;
  }
}

export {};
