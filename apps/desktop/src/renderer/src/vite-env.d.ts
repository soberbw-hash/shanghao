/// <reference types="vite/client" />

import type { DesktopApi } from "@private-voice/shared";

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}

export {};
