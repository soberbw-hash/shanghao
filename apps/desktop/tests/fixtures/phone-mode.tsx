import { createRoot } from "react-dom/client";
import type { AppSettings } from "@private-voice/shared";
// Isolated UI fixture. System audio is tested separately by verify-phone-audio.mjs.
const listeners = new Set<(state: { active: boolean; busy: boolean }) => void>();
let active = false;
let savedSettings = { phoneModeShortcut: "", phoneModeTrigger: "hold" } as AppSettings;
window.desktopApi = {
  phoneMode: {
    get: async () => ({ active, busy: false }),
    set: async (next: boolean) => {
      active = next;
      listeners.forEach((listener) => listener({ active, busy: false }));
    },
    devices: async () => undefined,
    configure: async () => undefined,
    onChanged: (listener: (state: { active: boolean; busy: boolean }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
  app: { writeLog: async () => undefined },
  settings: {
    save: async (patch: Partial<AppSettings>) => {
      savedSettings = { ...savedSettings, ...patch };
      return savedSettings;
    },
  },
} as unknown as typeof window.desktopApi;
const { PhoneModeSettings } =
  await import("../../src/renderer/src/components/settings/PhoneModeSettings");
const { usePhoneModeSync } = await import("../../src/renderer/src/hooks/usePhoneModeSync");
const { useSettingsStore } = await import("../../src/renderer/src/store/settingsStore");
useSettingsStore.setState({ settings: savedSettings });
function Fixture() {
  usePhoneModeSync();
  return (
    <>
      <PhoneModeSettings />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
