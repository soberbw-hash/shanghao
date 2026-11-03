import type { BrowserWindow, Rectangle } from "electron";

type Viewer = Pick<BrowserWindow, "isDestroyed" | "destroy" | "setBounds" | "show" | "focus">;

/** A late load must not revive a closed viewer or displace its newer session. */
export async function loadScreenShareViewer(
  viewer: Viewer,
  load: () => Promise<unknown>,
  isCurrent: () => boolean,
  releaseCurrent: () => void,
  bounds: Rectangle,
): Promise<void> {
  try {
    await load();
  } catch (error) {
    if (isCurrent()) releaseCurrent();
    if (!viewer.isDestroyed()) viewer.destroy();
    throw error;
  }
  if (viewer.isDestroyed()) return;
  if (!isCurrent()) {
    viewer.destroy();
    return;
  }
  viewer.setBounds(bounds, false);
  viewer.show();
  viewer.focus();
}
