import environment from "../../assets/scenes/shanghao-room/environment-v3-extended.png";
import workstation from "../../assets/scenes/shanghao-room/workstation.png";
import curtain from "../../assets/scenes/shanghao-room/curtain-ceiling-v2.png";
import leaves from "../../assets/scenes/shanghao-room/foreground-leaves-v2.png";

// Retain only the fixed scene images; joining/audio never awaits this visual work.
const sceneImages: HTMLImageElement[] = [];
export const warmRoomSceneAssets = async (): Promise<void> => {
  for (const src of [environment, workstation, curtain, leaves]) {
    const image = new Image();
    image.src = src;
    await image.decode().catch(() => undefined);
    sceneImages.push(image);
  }
};
