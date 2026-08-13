import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BrowserWindow } from "electron";

type CaptureMode =
  | "home"
  | "home-mic"
  | "room"
  | "room-mic"
  | "member-volume"
  | "recording-stop"
  | "room-seat"
  | "room-away"
  | "screen-share"
  | "screen-share-expanded"
  | "settings"
  | "settings-detail";

interface CaptureUiOptions {
  mode: CaptureMode;
  outputPath: string;
  exitAfterCapture: boolean;
  onExit: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dismissReleaseNotes = async (window: BrowserWindow, timeoutMs = 4_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  let sawViewer = false;
  while (Date.now() < deadline) {
    const viewerVisible = await waitForVisibleSelector(window, ".release-notes-viewer", 150);
    if (!viewerVisible) {
      if (sawViewer) return true;
      await sleep(100);
      continue;
    }
    sawViewer = true;
    if (await clickButtonByLabel(window, "知道了，开始上号")) {
      await sleep(180);
      continue;
    }
    if (await clickButtonByLabel(window, "下一页")) {
      await sleep(180);
      continue;
    }
    await sleep(100);
  }
  return !sawViewer;
};

const dismissDailyReport = async (window: BrowserWindow): Promise<void> => {
  if (await waitForVisibleSelector(window, '[aria-labelledby="daily-room-report-title"]', 350)) {
    await clickButtonByLabel(window, "知道了");
    await sleep(180);
  }
};

const clickButtonByLabel = async (window: BrowserWindow, label: string): Promise<boolean> => {
  return window.webContents.executeJavaScript(
    `
      (() => {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        const readText = (button) => (button.textContent || "").replace(/\\s+/g, " ").trim();
        const readLabel = (button) => (button.getAttribute("aria-label") || "").trim();
        const target =
          buttons.find(
            (button) =>
              readText(button) === ${JSON.stringify(label)} ||
              readLabel(button) === ${JSON.stringify(label)},
          ) ||
          buttons.find(
            (button) =>
              readText(button).includes(${JSON.stringify(label)}) ||
              readLabel(button).includes(${JSON.stringify(label)}),
          );
        if (target instanceof HTMLElement) {
          target.click();
          return true;
        }
        return false;
      })();
    `,
    true,
  );
};

const clickButtonByLabelWithMouse = async (
  window: BrowserWindow,
  label: string,
): Promise<boolean> => {
  const point = (await window.webContents.executeJavaScript(
    `
      (() => {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        const readText = (button) => (button.textContent || "").replace(/\\s+/g, " ").trim();
        const readLabel = (button) => (button.getAttribute("aria-label") || "").trim();
        const target =
          buttons.find(
            (button) =>
              readText(button) === ${JSON.stringify(label)} ||
              readLabel(button) === ${JSON.stringify(label)},
          ) ||
          buttons.find(
            (button) =>
              readText(button).includes(${JSON.stringify(label)}) ||
              readLabel(button).includes(${JSON.stringify(label)}),
          );
        if (!(target instanceof HTMLElement)) return null;
        const bounds = target.getBoundingClientRect();
        return {
          x: Math.round(bounds.left + bounds.width / 2),
          y: Math.round(bounds.top + bounds.height / 2),
        };
      })();
    `,
    true,
  )) as { x: number; y: number } | null;
  if (!point) return false;

  window.webContents.sendInputEvent({ type: "mouseMove", ...point });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    button: "left",
    clickCount: 1,
    ...point,
  });
  window.webContents.sendInputEvent({
    type: "mouseUp",
    button: "left",
    clickCount: 1,
    ...point,
  });
  return true;
};

const prepareProfileForCapture = async (window: BrowserWindow): Promise<void> => {
  const captureServerUrl = process.env.SHANGHAO_CAPTURE_SERVER_URL?.trim();
  if (captureServerUrl) {
    await window.webContents.executeJavaScript(
      `window.desktopApi.settings.save({ relayServerUrl: ${JSON.stringify(captureServerUrl)} })`,
      true,
    );
  }
  const prepared = async (): Promise<boolean> =>
    window.webContents.executeJavaScript(
      `
      (() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const nicknameInput = inputs.find((input) => input.placeholder === "朋友怎么叫你");
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (nicknameInput instanceof HTMLInputElement && !nicknameInput.value.trim()) {
          valueSetter?.call(nicknameInput, "Sober");
          nicknameInput.dispatchEvent(new Event("input", { bubbles: true }));
          nicknameInput.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const captureServerUrl = ${JSON.stringify(captureServerUrl)};
        if (!captureServerUrl) return true;
        const serverInput = inputs.find(
          (input) => input !== nicknameInput && input.type === "text",
        );
        if (!(serverInput instanceof HTMLInputElement)) return false;
        valueSetter?.call(serverInput, captureServerUrl);
        serverInput.dispatchEvent(new Event("input", { bubbles: true }));
        serverInput.dispatchEvent(new Event("change", { bubbles: true }));
        return serverInput.value === captureServerUrl;
      })();
    `,
      true,
    ) as Promise<boolean>;
  const deadline = Date.now() + 3_000;
  while (!(await prepared()) && Date.now() < deadline) await sleep(100);
  await sleep(150);
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
  await dismissReleaseNotes(window);
  await dismissDailyReport(window);
  if (options.mode !== "home" && options.mode !== "home-mic") {
    await prepareProfileForCapture(window);
    await dismissReleaseNotes(window, 1_500);
    await dismissDailyReport(window);
    await sleep(300);
    if (process.env.SHANGHAO_CAPTURE_SERVER_URL) {
      await clickButtonByLabel(window, "选择鸭子");
      await sleep(120);
    }
    const usedChannelEntry = await clickButtonByLabel(window, "进入频道");
    if (!usedChannelEntry) {
      await clickButtonByLabel(window, "上号");
    }
    await dismissReleaseNotes(window, 2_000);
    await dismissDailyReport(window);
    const needsSettledRoom = [
      "room",
      "room-mic",
      "member-volume",
      "recording-stop",
      "room-seat",
      "room-away",
      "screen-share",
      "screen-share-expanded",
      "settings",
      "settings-detail",
    ].includes(options.mode);
    if (needsSettledRoom) {
      await waitForLocalSceneCharacter(window, "idle", 5_500);
      await sleep(3_400);
    } else {
      await sleep(700);
    }
  }

  if (options.mode === "settings" || options.mode === "settings-detail") {
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
    await clickButtonByLabel(window, "更新");
    await sleep(300);
    if (options.mode === "settings-detail") {
      await clickButtonByLabel(window, "查看详细信息");
      await sleep(300);
    }
  }

  if (options.mode === "home-mic") {
    await clickButtonByLabel(window, "麦克风正常");
    await sleep(250);
  }

  if (options.mode === "room-mic") {
    await clickButtonByLabel(window, "打开麦克风设备");
    await sleep(250);
  }

  if (options.mode === "member-volume") {
    const clicked = await clickButtonByLabelWithMouse(window, "的本地音量");
    const opened =
      clicked && (await waitForVisibleSelector(window, ".member-audio-popover", 1_500));
    if (!opened) {
      const failedImage = await window.capturePage();
      await mkdir(dirname(options.outputPath), { recursive: true });
      await writeFile(options.outputPath, failedImage.toPNG());
      throw new Error("真实鼠标点击好友角色后，本地音量窗口没有打开");
    }
    await sleep(250);
  }

  if (options.mode === "recording-stop") {
    const stoppedAutomaticRecording = await clickButtonByLabel(window, "录音中");
    if (!stoppedAutomaticRecording) {
      await clickButtonByLabel(window, "录音");
      await sleep(300);
      await clickButtonByLabel(window, "录音中");
    }
    await sleep(250);
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
