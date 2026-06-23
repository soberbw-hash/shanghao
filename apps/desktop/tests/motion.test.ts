import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const packagePath = path.resolve(process.cwd(), "package.json");
const homePath = path.resolve(process.cwd(), "src/renderer/src/pages/HomePage.tsx");
const roomPath = path.resolve(process.cwd(), "src/renderer/src/pages/RoomPage.tsx");
const settingsPath = path.resolve(process.cwd(), "src/renderer/src/pages/SettingsPage.tsx");
const chatPath = path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx");
const islandPath = path.resolve(process.cwd(), "src/renderer/src/components/room/TeamIsland.tsx");
const animalPath = path.resolve(process.cwd(), "src/renderer/src/components/room/AnimalSprite.tsx");
const hookPath = path.resolve(process.cwd(), "src/renderer/src/hooks/usePrefersReducedMotion.ts");
const stylesPath = path.resolve(process.cwd(), "src/renderer/src/styles/index.css");

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
  assert.equal(stylesSource.includes("[data-gsap-entry]"), true);
  assert.equal(animalSource.includes("animal-motion-sprite"), true);
  assert.equal(animalSource.includes("motionRows"), true);
  assert.equal(animalSource.includes("isMoving ? \"walk\""), true);
  assert.equal(islandSource.includes("SceneCharacter"), true);
  assert.equal(islandSource.includes("setIsMoving(true)"), true);
  assert.equal(stylesSource.includes("@keyframes animal-motion-frames"), true);
});
