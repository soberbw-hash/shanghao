import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const deskAnimalPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/room/DeskAnimalSprite.tsx",
);
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
const appPath = path.resolve(process.cwd(), "src/renderer/src/app/App.tsx");
const motionSystemPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/motion/motionSystem.ts",
);
const motionPresetsPath = path.resolve(
  process.cwd(),
  "src/renderer/src/features/motion/motionPresets.ts",
);
const toastRegionPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/layout/ToastRegion.tsx",
);
const sharedButtonPath = path.resolve(process.cwd(), "../../packages/ui/src/components/Button.tsx");
const animatedIconPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/icons/AnimatedControlIcon.tsx",
);
const onboardingModalPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/OnboardingModal.tsx",
);
const recordingDialogPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/RecordingSaveDialog.tsx",
);
const reconnectOverlayPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/ReconnectOverlay.tsx",
);
const updateModalPath = path.resolve(
  process.cwd(),
  "src/renderer/src/components/status/UpdateModal.tsx",
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
  const deskAnimalSource = readFileSync(deskAnimalPath, "utf8");
  const hookSource = readFileSync(hookPath, "utf8");
  const stylesSource = readFileSync(stylesPath, "utf8");
  const appStoreSource = readFileSync(appStorePath, "utf8");
  const sharedButtonSource = readFileSync(sharedButtonPath, "utf8");
  const animatedIconSource = readFileSync(animatedIconPath, "utf8");
  const motionPresetsSource = readFileSync(motionPresetsPath, "utf8");
  const toastRegionSource = readFileSync(toastRegionPath, "utf8");

  for (const avatarId of ["fox", "cat", "duck", "panda", "corgi"]) {
    assert.equal(
      existsSync(
        path.resolve(
          process.cwd(),
          `src/renderer/src/assets/avatars/run-cycles-v2/${avatarId}.png`,
        ),
      ),
      true,
    );
  }

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
  assert.equal(islandSource.includes("type CharacterMotionPhase ="), true);
  assert.equal(islandSource.includes('setMotionPhase("walking")'), true);
  assert.equal(islandSource.includes('setMotionPhase("approaching")'), true);
  assert.equal(islandSource.includes('setMotionPhase("turning")'), true);
  assert.equal(islandSource.includes('setMotionPhase("standing-up")'), true);
  assert.equal(islandSource.includes('setMotionPhase("sitting")'), true);
  assert.equal(islandSource.includes('setMotionPhase("leaving")'), true);
  assert.equal(islandSource.includes("WalkingAnimalSprite"), true);
  assert.equal(deskAnimalSource.includes("runCycleSources"), true);
  assert.equal(deskAnimalSource.includes('data-run-cycle-frames="8"'), true);
  assert.equal(deskAnimalSource.includes("walking-animal-run-cycle-strip"), true);
  assert.equal(stylesSource.includes("@keyframes walking-animal-run-cycle"), true);
  assert.equal(stylesSource.includes("var(--run-cycle-duration) steps(8, end)"), true);
  assert.equal(deskAnimalSource.includes("preloadCharacterSpriteAssets"), true);
  assert.equal(stylesSource.includes("contain: layout paint style"), true);
  assert.equal(stylesSource.includes("translate3d(-100%, 0, 0)"), true);
  assert.equal(stylesSource.includes("will-change: background-position"), false);
  assert.equal(stylesSource.includes("@keyframes walking-animal-shadow-step"), false);
  assert.equal(deskAnimalSource.includes("walking-animal-rig"), false);
  assert.equal(deskAnimalSource.includes("runner-leg-far"), false);
  assert.equal(deskAnimalSource.includes("runner-leg-near"), false);
  assert.equal(deskAnimalSource.includes("runner-arm-far"), false);
  assert.equal(deskAnimalSource.includes("runner-arm-near"), false);
  assert.equal(deskAnimalSource.includes("runnerPalettes"), false);
  assert.equal(deskAnimalSource.includes("rearAvatarSources"), true);
  assert.equal(deskAnimalSource.includes("runningAvatarSources"), false);
  assert.equal(deskAnimalSource.includes("../../assets/avatars/run-cycles-v2/fox.png"), true);
  assert.equal(deskAnimalSource.includes("../../assets/avatars/rear-v2/fox-rear.png"), true);
  assert.equal(islandSource.includes("const sceneXFor"), true);
  assert.equal(islandSource.includes("const sceneYFor"), true);
  assert.equal(islandSource.includes("sceneEntryPoint().left"), true);
  assert.equal(stylesSource.includes("container-type: size"), true);
  assert.equal(stylesSource.includes("will-change: left, top"), false);
  assert.equal(stylesSource.includes("will-change: transform, opacity"), true);
  assert.equal(islandSource.includes("planCharacterRoute"), true);
  assert.equal(islandSource.includes("routeAnimation"), true);
  assert.equal(islandSource.includes("const middleLeft"), false);
  assert.equal(islandSource.includes("destinationWalkingTop"), false);
  assert.equal(islandSource.includes("travelDuration * 0.46"), false);
  assert.equal(stylesSource.includes("@keyframes runner-leg-far-stride"), false);
  assert.equal(stylesSource.includes("@keyframes runner-leg-near-stride"), false);
  assert.equal(stylesSource.includes("@keyframes runner-arm-far-stride"), false);
  assert.equal(stylesSource.includes("@keyframes runner-arm-near-stride"), false);
  assert.equal(islandSource.includes("movementDirection"), true);
  assert.equal(islandSource.includes("entryRevision"), true);
  assert.equal(islandSource.includes("didFinishEntryRef.current"), true);
  assert.equal(stylesSource.includes("@keyframes layered-body-walk"), true);
  assert.equal(stylesSource.includes(".layered-animal-head"), true);
  assert.equal(islandSource.includes("useAnimationControls"), true);
  assert.equal(islandSource.includes("usePresence"), true);
  assert.equal(islandSource.includes("currentPositionRef.current"), true);
  assert.equal(islandSource.includes("onUpdate={(latest)"), true);
  assert.equal(
    islandSource.includes('data-zone-transitioning={isZoneTransitioning ? "true"'),
    true,
  );
  assert.equal(stylesSource.includes('data-zone-transitioning="true"'), true);
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
  assert.equal(chatSource.includes("motionEase.jelly"), true);
  assert.equal(chatSource.includes("latestMessage?.isLocal ? 10 : -8"), true);
  assert.equal(chatSource.includes("scaleX: 0.72"), false);
  assert.equal(chatSource.includes("duration: motionDuration.message"), true);
  assert.equal(chatSource.includes('data-icon-motion="send"'), true);
  assert.equal(islandSource.includes("data-knock-wave"), true);
  assert.equal(islandSource.includes("scene-workstation-art-frame"), true);
  assert.equal(islandSource.includes('".scene-workstation .scene-workstation-art-frame"'), true);
  assert.equal(islandSource.includes("WorkstationArt"), true);
  assert.equal(islandSource.includes("desk-animal-muted"), false);
  assert.equal(stylesSource.includes(".desk-animal-muted"), true);
  assert.equal(stylesSource.includes("--character-motion-delay"), true);
  assert.equal(roomSource.includes('message.id.startsWith("knock-")'), true);
  assert.equal(roomSource.includes("AnimatedControlIcon"), true);
  assert.equal(animatedIconSource.includes("animated-icon__speaker-wave--one"), true);
  assert.equal(animatedIconSource.includes("animated-icon__speaker-mute"), true);
  assert.equal(animatedIconSource.includes("animated-icon__bell-clapper"), true);
  assert.equal(animatedIconSource.includes("animated-icon__settings-knob--three"), true);
  assert.equal(stylesSource.includes("@keyframes animated-speaker-wave"), true);
  assert.equal(stylesSource.includes("@keyframes animated-bell-shell"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-look"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-stretch"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-sip"), true);
  assert.equal(stylesSource.includes(".desk-animal-action-phone"), true);
  assert.equal(stylesSource.includes(".desk-animal-screen-sharing"), true);
  assert.equal(stylesSource.includes("@keyframes runner-leg-far-stride"), false);
  assert.equal(stylesSource.includes("@keyframes runner-leg-near-stride"), false);
  assert.equal(stylesSource.includes(".runner-leg-far"), false);
  assert.equal(stylesSource.includes(".runner-leg-near"), false);
  assert.equal(stylesSource.includes("@keyframes walking-animal-step"), false);
  assert.equal(stylesSource.includes(".scene-character-chat-bubble"), false);
  assert.equal(stylesSource.includes("character-voice-halo"), true);
  assert.equal(stylesSource.includes("@keyframes icon-audio-hover"), false);
  assert.equal(motionPresetsSource.includes("dialogSurfaceVariants"), true);
  assert.equal(motionPresetsSource.includes("toastItemVariants"), true);
  assert.equal(motionPresetsSource.includes("stiffness: 420, damping: 34, mass: 0.72"), true);
  assert.equal(toastRegionSource.includes('mode="popLayout"'), true);
  assert.equal(toastRegionSource.includes('layout="position"'), true);
  assert.equal(toastRegionSource.includes("opacity-75"), false);
  assert.equal(appStoreSource.includes("repeatCount"), true);
  assert.equal(appStoreSource.includes(".slice(-3)"), true);
  assert.equal(stylesSource.includes(".toast-card"), true);
  assert.equal(stylesSource.includes(".modal-surface"), true);
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

test("route transitions remove the previous translucent page instead of stacking it", () => {
  const appSource = readFileSync(appPath, "utf8");

  assert.equal(appSource.includes("AnimatePresence"), false);
  assert.equal(appSource.includes("key={basePage}"), true);
});

test("dialogs use interruptible compositor motion without full-screen blur animation", () => {
  const dialogSources = [
    onboardingModalPath,
    recordingDialogPath,
    reconnectOverlayPath,
    updateModalPath,
  ].map((filePath) => readFileSync(filePath, "utf8"));

  for (const source of dialogSources) {
    assert.equal(source.includes("AnimatePresence"), true);
    assert.equal(source.includes("useReducedMotion"), true);
    assert.equal(source.includes("reducedFadeVariants"), true);
    assert.equal(source.includes('exit="closed"'), true);
  }

  const updateSource = dialogSources[3];
  assert.equal(updateSource.includes("backdrop-blur-xl"), false);
  assert.equal(updateSource.includes('role={isForced ? "alertdialog" : "status"}'), true);

  const reconnectSource = dialogSources[2];
  assert.equal(reconnectSource.includes("RECONNECT_SHOW_DELAY_MS = 350"), true);
  assert.equal(reconnectSource.includes("RECONNECT_MIN_VISIBLE_MS = 600"), true);

  const roomSource = readFileSync(roomPath, "utf8");
  assert.equal(roomSource.includes('key="screen-source-picker"'), true);
  assert.equal(roomSource.includes("dialogSurfaceVariants"), true);
});

test("local scene identity survives placeholder-to-server peer replacement", () => {
  const islandSource = readFileSync(islandPath, "utf8");

  assert.equal(islandSource.includes('member.isLocal ? "local-member" : member.id'), true);
  assert.equal(islandSource.includes("key={sceneMemberKey(member)}"), true);
  assert.equal(islandSource.includes("key={member.id}"), false);
});
