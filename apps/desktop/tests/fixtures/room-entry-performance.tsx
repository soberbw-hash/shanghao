import React from "react";
import { createRoot } from "react-dom/client";
import type { DesktopApi } from "@private-voice/shared";
import { PrivateRoomEditor } from "../../src/renderer/src/components/room/PrivateRoomEditor";
import {
  cancelDelayedRoomEntryCue,
  playUiSound,
  unlockUiSounds,
} from "../../src/renderer/src/features/audio/uiSound";
import { loadRoomEntryCue } from "../../src/renderer/src/features/audio/roomEntryCue";
import { createRecipe, renderRecipe } from "uisfx";
import "../../src/renderer/src/styles/index.css";

let nextCode = 126000;
let availabilityRequests = 0;
window.desktopApi = {
  app: { writeLog: async () => {} },
  rooms: {
    randomCode: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return String(++nextCode);
    },
    available: async (code) => {
      availabilityRequests++;
      return code !== "999999";
    },
  },
} as unknown as DesktopApi;
Object.assign(window, {
  performanceFixture: {
    playUiSound,
    unlockUiSounds,
    cancelDelayedRoomEntryCue,
    loadRoomEntryCue,
    createRecipe,
    renderRecipe,
    getAvailabilityRequests: () => availabilityRequests,
  },
});
createRoot(document.getElementById("root")!).render(
  <PrivateRoomEditor defaultName="性能夹具" onClose={() => {}} onSaved={() => {}} />,
);
