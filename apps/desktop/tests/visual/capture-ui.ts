import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BrowserWindow } from "electron";

type CaptureMode =
  | "home"
  | "room"
  | "room-seat"
  | "room-away"
  | "screen-share"
  | "screen-share-expanded"
  | "settings";

interface CaptureUiOptions {
  mode: CaptureMode;
  outputPath: string;
  exitAfterCapture: boolean;
  onExit: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const clickButtonByLabel = async (window: BrowserWindow, label: string): Promise<boolean> => {
  return window.webContents.executeJavaScript(
    `
      (() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const target = buttons.find((button) =>
          (button.textContent || "").replace(/\\s+/g, " ").includes(${JSON.stringify(label)}) ||
          (button.getAttribute("aria-label") || "").includes(${JSON.stringify(label)}),
        );
        if (target instanceof HTMLButtonElement) {
          target.click();
          return true;
        }
        return false;
      })();
    `,
    true,
  );
};

const prepareProfileForCapture = async (window: BrowserWindow): Promise<void> => {
  await window.webContents.executeJavaScript(
    `
      (() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const nicknameInput = inputs.find((input) => input.placeholder === "朋友怎么叫你");
        if (!(nicknameInput instanceof HTMLInputElement) || nicknameInput.value.trim()) return;
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(nicknameInput, "Sober");
        nicknameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nicknameInput.dispatchEvent(new Event("change", { bubbles: true }));
      })();
    `,
    true,
  );
};

const waitForLocalSceneCharacter = async (
  window: BrowserWindow,
  phase: "idle" | "walking",
  timeoutMs = 5_000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await window.webContents
      .executeJavaScript(
        `Boolean(document.querySelector('[data-scene-member-key="local-member"][data-motion-phase="${phase}"]'))`,
        true,
      )
      .catch(() => false);
    if (found) return true;
    await sleep(100);
  }
  return false;
};

const waitForVisibleSelector = async (
  window: BrowserWindow,
  selector: string,
  timeoutMs = 8_000,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isVisible = await window.webContents
      .executeJavaScript(
        `
          (() => {
            const element = document.querySelector(${JSON.stringify(selector)});
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) > 0 &&
              bounds.width > 0 &&
              bounds.height > 0
            );
          })()
        `,
        true,
      )
      .catch(() => false);
    if (isVisible) return true;
    await sleep(100);
  }
  return false;
};

const getCaptureDebugSnapshot = async (window: BrowserWindow): Promise<unknown> => {
  return window.webContents
    .executeJavaScript(
      `
        (() => {
          const settingsLayer = document.querySelector(".app-page-settings");
          const settingsHeader = document.querySelector(".settings-page-header");
          const describe = (element) => {
            if (!(element instanceof HTMLElement)) return null;
            const style = window.getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return {
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              width: Math.round(bounds.width),
              height: Math.round(bounds.height),
              text: (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240),
            };
          };

          return {
            bodyText: document.body.innerText.replace(/\\s+/g, " ").trim().slice(0, 800),
            buttons: Array.from(document.querySelectorAll("button"))
              .map((button) => (button.textContent || button.getAttribute("aria-label") || "")
                .replace(/\\s+/g, " ")
                .trim())
              .filter(Boolean)
              .slice(0, 40),
            settingsLayer: describe(settingsLayer),
            settingsHeader: describe(settingsHeader),
          };
        })()
      `,
      true,
    )
    .catch((error) => ({
      captureDebugError: error instanceof Error ? error.message : String(error),
    }));
};

export const captureUi = async (
  window: BrowserWindow,
  options: CaptureUiOptions,
): Promise<void> => {
  if (window.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
    });
  }

  await sleep(5_200);
  if (options.mode !== "home" && options.mode !== "settings") {
    await prepareProfileForCapture(window);
    await sleep(300);
    const usedQuickEntry = await clickButtonByLabel(window, "上号");
    if (!usedQuickEntry) {
      await clickButtonByLabel(window, "进入频道");
    }
    const needsSettledRoom = [
      "room",
      "room-seat",
      "room-away",
      "screen-share",
      "screen-share-expanded",
    ].includes(options.mode);
    if (needsSettledRoom) {
      await waitForLocalSceneCharacter(window, "idle", 5_500);
      await sleep(180);
    } else {
      await sleep(700);
    }
  }

  if (options.mode === "settings") {
    const isAlreadyOpen = await waitForVisibleSelector(window, ".settings-page-header", 3_000);
    const openedSettings = isAlreadyOpen || (await clickButtonByLabel(window, "设置"));
    if (!openedSettings || !(await waitForVisibleSelector(window, ".settings-page-header"))) {
      const debugSnapshot = await getCaptureDebugSnapshot(window);
      throw new Error(
        `设置页未在预期时间内完成渲染：${JSON.stringify({
          openedSettings,
          debugSnapshot,
        })}`,
      );
    }
    await sleep(300);
  }

  if (options.mode === "room-seat") {
    await clickButtonByLabel(window, "2 号位");
    await waitForLocalSceneCharacter(window, "walking", 1_200);
    await sleep(420);
  }
  if (options.mode === "room-away") {
    await clickButtonByLabel(window, "离开");
    await sleep(2_200);
  }

  if (options.mode === "screen-share" || options.mode === "screen-share-expanded") {
    await clickButtonByLabel(window, "屏幕分享");
    await sleep(1_800);
  }
  if (options.mode === "screen-share-expanded") {
    await clickButtonByLabel(window, "放大屏幕分享");
    await sleep(800);
  }

  const image = await window.capturePage();
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, image.toPNG());

  if (options.exitAfterCapture) {
    options.onExit();
  }
};
