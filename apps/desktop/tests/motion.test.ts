import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const packagePath = path.resolve(process.cwd(), "package.json");
const homePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const roomPath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const settingsPath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const chatPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/chat/TemporaryChatPanel.tsx",
);
const islandPath = path.resolve(process.cwd(), "src/renderer/src/components/room/TeamIsland.tsx");
const animalPath = path.resolve(process.cwd(), "src/renderer/src/components/room/AnimalSprite.tsx");
const hookPath = path.resolve(process.cwd(), "src/renderer/src/hooks/usePrefersReducedMotion.ts");
const stylesPath = path.resolve(process.cwd(), "src/renderer/src/styles/index.css");
const appStorePath = path.resolve(process.cwd(), "src/renderer/src/store/appStore.ts");
const startupPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/StartupSplashPage.tsx",
);
const bootstrapPath = path.resolve(process.cwd(), "src/renderer/src/hooks/useAppBootstrap.ts");
const rendererHtmlPath = path.resolve(process.cwd(), "src/renderer/index.html");
const mainWindowPath = path.resolve(process.cwd(), "src/main/window.ts");
const motionSystemPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/motion/motionSystem.ts",
);
const sharedButtonPath = path.resolve(process.cwd(), "../../packages/ui/src/components/Button.tsx");
const animatedIconPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/icons/AnimatedControlIcon.tsx",
);

test("gsap motion is wired across the main surfaces with reduced-motion fallback", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const homeSource = readFileSync(homePath, "utf8");
  const roomSource = readFileSync(roomPath, "utf8");
  const settingsSource = readFileSync(settingsPath, "utf8");
  const chatSource = readFileSync(chatPath, "utf8");
  const islandSource = readFileSync(islandPath, "utf8");
  const animalSource = readFileSync(animalPath, "utf8");
  const hookSource = readFileSync(hookPath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");
  const appStoreSource = readFileSync(appStorePath, "utf8");
  const sharedButtonSource = readFileSync(sharedButtonPath, "utf8");
  const animatedIconSource = readFileSync(animatedIconPath, "utf8");

  assert.match(packageJson.dependencies?.gsap ?? "", /^\^3\./);
  assert.equal(homeSource.includes('from "gsap"'), true);
  assert.equal(roomSource.includes('from "gsap"'), true);
  assert.equal(settingsSource.includes('from "gsap"'), true);
  assert.equal(chatSource.includes('from "gsap"'), true);
  assert.equal(islandSource.includes('from "gsap"'), true);
  assert.equal(homeSource.includes("data-gsap-entry"), true);
  assert.equal(roomSource.includes("data-gsap-room"), true);
  assert.equal(settingsSource.includes("data-gsap-settings"), true);
  assert.equal(chatSource.includes("data-gsap-chat-message"), true);
  assert.equal(islandSource.includes("data-gsap-character"), true);
  assert.equal(hookSource.includes("prefers-reduced-motion: reduce"), true);
  assert.equal(stylesSource.includes("[data-gsap-entry],"), false);
  assert.equal(stylesSource.includes("@media (prefers-reduced-motion: reduce)"), true);
  assert.equal(appStoreSource.includes("startTransition"), true);
  assert.equal(animalSource.includes("layered-animal"), true);
  assert.equal(animalSource.includes("avatarLayerAssets"), true);
  assert.equal(animalSource.includes("LayerPart"), true);
  assert.equal(animalSource.includes('isMoving ? "walk"'), true);
  assert.equal(islandSource.includes("SceneCharacter"), true);
  assert.equal(islandSource.includes("setIsMoving(true)"), true);
  assert.equal(stylesSource.includes("@keyframes layered-body-walk"), true);
  assert.equal(stylesSource.includes(".layered-animal-head"), true);
  assert.equal(islandSource.includes('layout="position"'), true);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("force3D: true"), true);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("CustomEase"), true);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("0.16,1,0.3,1"), true);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("0.22,1,0.36,1"), true);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("back.out"), false);
  assert.equal(readFileSync(motionSystemPath, "utf8").includes("APPLE_MOTION_DURATION"), true);
  assert.equal(sharedButtonSource.includes("--button-pointer-x"), true);
  assert.equal(sharedButtonSource.includes("requestAnimationFrame"), true);
  assert.equal(sharedButtonSource.includes("radial-gradient(100px circle"), true);
  assert.equal(
    chatSource.includes('behavior: shouldReduceMotion || previous === 0 ? "auto" : "smooth"'),
    true,
  );
  assert.equal(chatSource.includes("motionEase.spatial"), true);
  assert.equal(chatSource.includes('data-icon-motion="send"'), true);
  assert.equal(islandSource.includes("data-knock-wave"), true);
  assert.equal(islandSource.includes("scene-workstation-art-frame"), true);
  assert.equal(islandSource.includes("WorkstationArt"), true);
  assert.equal(islandSource.includes("desk-animal-muted"), false);
  assert.equal(stylesSource.includes(".desk-animal-muted"), true);
  assert.equal(stylesSource.includes("--character-motion-delay"), true);
  assert.equal(roomSource.includes('message.id.startsWith("knock-")'), true);
  assert.equal(roomSource.includes("AnimatedControlIcon"), true);
  assert.equal(animatedIconSource.includes("animated-icon__speaker-wave--one"), true);
  assert.equal(animatedIconSource.includes("animated-icon__bell-clapper"), true);
  assert.equal(animatedIconSource.includes("animated-icon__settings-knob--three"), true);
  assert.equal(stylesSource.includes("@keyframes animated-speaker-wave"), true);
  assert.equal(stylesSource.includes("@keyframes animated-bell-shell"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-look"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-stretch"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-sip"), true);
  assert.equal(stylesSource.includes("character-voice-halo"), true);
  assert.equal(stylesSource.includes("@keyframes icon-audio-hover"), false);
});

test("startup paints immediately and keeps network work off the critical path", () => {
  const startupSource = readFileSync(startupPath, "utf8");
  const bootstrapSource = readFileSync(bootstrapPath, "utf8");
  const rendererHtml = readFileSync(rendererHtmlPath, "utf8");
  const mainWindowSource = readFileSync(mainWindowPath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");

  assert.equal(rendererHtml.includes("app-preboot"), true);
  assert.equal(rendererHtml.includes("preboot-mark-enter"), true);
  assert.equal(rendererHtml.includes('data-renderer="overlay"'), true);
  assert.equal(mainWindowSource.includes('backgroundColor: "#EEF5FF"'), true);
  assert.equal(startupSource.includes("startup-splash-progress"), true);
  assert.equal(stylesSource.includes("@keyframes startup-mark-enter"), true);
  assert.equal(bootstrapSource.includes("await checkUpdates()"), false);
  assert.equal(bootstrapSource.includes("const hydration = await hydrationTask"), true);
  assert.equal(bootstrapSource.includes("void refreshDevices()"), true);
});
