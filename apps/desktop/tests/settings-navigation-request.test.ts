import assert from "node:assert/strict";
import test from "node:test";
import {
  getInitialSettingsSection,
  readRequestedSettingsSection,
  SETTINGS_SECTION_REQUEST_KEY,
} from "../src/renderer/src/features/settings/settingsSectionState";

test("repeated settings initialization preserves the requested section until the active-page effect consumes it", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[SETTINGS_SECTION_REQUEST_KEY, "account"]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
      },
    },
  });
  try {
    assert.equal(getInitialSettingsSection(), "account");
    assert.equal(getInitialSettingsSection(), "account");
    assert.equal(values.get(SETTINGS_SECTION_REQUEST_KEY), "account");
    assert.equal(readRequestedSettingsSection(), "account");
    assert.equal(readRequestedSettingsSection(), undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
