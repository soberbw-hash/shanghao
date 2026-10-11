import environment from "../../assets/scenes/shanghao-room/environment-v3-extended.png";
import workstation from "../../assets/scenes/shanghao-room/workstation.png";
import curtain from "../../assets/scenes/shanghao-room/curtain-ceiling-v2.png";
import leaves from "../../assets/scenes/shanghao-room/foreground-leaves-v2.png";
import { waitForVisualIdle } from "./waitForVisualIdle";
const sceneImages: HTMLImageElement[] = [];
export const warmRoomSceneAssets = async (signal = new AbortController().signal): Promise<void> => {
  for (const src of [environment, workstation, curtain, leaves]) {
    await waitForVisualIdle(signal);
    const image = new Image();
    image.src = src;
    await image.decode().catch(() => undefined);
    if (!sceneImages.some((cached) => cached.src === image.src)) sceneImages.push(image);
  }
};
