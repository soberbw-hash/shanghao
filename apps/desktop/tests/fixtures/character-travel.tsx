/* eslint-disable no-console -- Emits structured results to the Electron test harness. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence } from "framer-motion";
import { MemberSpeakingState, type RoomMember, type SceneZoneId } from "@private-voice/shared";
import { SceneCharacter } from "../../src/renderer/src/components/room/SceneCharacter";
import { SceneWelcomeDoor } from "../../src/renderer/src/components/room/SceneWelcomeDoor";
import { readRenderedScenePosition } from "../../src/renderer/src/features/voice-scene/characterMotionRuntime";
import "../../src/renderer/src/styles/index.css";

const member = {
  id: "test",
  nickname: "Test",
  isLocal: true,
  volume: 1,
  speakingState: MemberSpeakingState.Silent,
  joinedAt: "2026-09-16",
} as RoomMember;
const Harness = () => {
  const [zone, setZone] = useState<SceneZoneId>("gameDesk1");
  const [present, setPresent] = useState(true);
  const [, rerender] = useState(0);
  Object.assign(window, {
    travel: {
      setZone,
      setPresent,
      rerender: () => rerender((n) => n + 1),
      read: () =>
        readRenderedScenePosition(document.querySelector(".scene-character-motion")!, {
          left: -999,
          top: -999,
        }),
    },
  });
  return (
    <div
      id="stage"
      style={{
        position: "relative",
        width: 1000,
        height: 700,
        containerType: "size",
        transform: "scale(.8)",
        transformOrigin: "top left",
      }}
    >
      <style>{`.scene-character-motion { position: absolute; } .room-character-sprite { position: relative; } .scene-service-zone {position:absolute;transform:translate(-50%,-50%);}`}</style>
      <SceneWelcomeDoor memberKeys={present ? "local-member" : ""} motionEnabled={true} />
      <AnimatePresence>
        {present && (
          <SceneCharacter
            key="test"
            member={member}
            avatarId="fox"
            shouldReduceMotion={false}
            zone={zone}
            awayIndex={0}
            awayCount={1}
            arrivalIndex={0}
            isWelcoming={false}
            isScreenSharing={false}
            onSettled={(_id, settled) => (document.body.dataset.settled = settled)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// Renderer-local timing avoids automation IPC latency changing interruptions.
const verify = async () => {
  const startedAt = performance.now();
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check: () => boolean, name: string) => {
    const deadline = performance.now() + 8000;
    while (!check()) {
      if (performance.now() > deadline) throw new Error(name);
      await delay(25);
    }
  };
  const api = () =>
    (
      window as unknown as {
        travel: {
          setZone: (zone: SceneZoneId) => void;
          setPresent: (value: boolean) => void;
          rerender: () => void;
          read: () => { left: number; top: number };
        };
      }
    ).travel;
  const settled = (zone: string) => document.body.dataset.settled === zone;
  const doorOpen = () =>
    document.querySelector(".scene-welcome-door")?.classList.contains("is-open");
  await waitFor(() => Boolean(doorOpen()), "door opens for arrival");
  await waitFor(
    () =>
      [...document.querySelectorAll<HTMLImageElement>(".scene-welcome-door img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    "door image loads",
  );
  const doorBounds = document.querySelector(".scene-welcome-door-art")!.getBoundingClientRect();
  if (doorBounds.width < 40 || doorBounds.height < 80)
    throw new Error(`door layout: ${JSON.stringify(doorBounds)}`);
  await waitFor(
    () =>
      Number(getComputedStyle(document.querySelector(".scene-welcome-door-hall")!).opacity) > 0.95,
    "door visually opens",
  );
  console.info("DOOR_PREVIEW");
  await waitFor(() => settled("gameDesk1"), "entry");
  const point = api().read();
  if (Math.abs(point.left - 28) > 0.05 || Math.abs(point.top - 38) > 0.05) {
    throw new Error(`scaled position: ${JSON.stringify(point)}`);
  }
  // A compositor or style reset can leave an otherwise visible, idle character
  // at the door. The watchdog must check its position, not just opacity/phase.
  await delay(4600); // Also recover a reset that happens after the first watchdog check.
  const stuckElement = document.querySelector<HTMLElement>(".scene-character-motion")!;
  stuckElement.style.transform = "translate3d(8cqw, 70cqh, 0)";
  await waitFor(() => {
    const recovered = api().read();
    return Math.abs(recovered.left - 28) < 0.1 && Math.abs(recovered.top - 38) < 0.1;
  }, "visible character stuck at entry");
  await waitFor(() => !doorOpen(), "door closes after arrival in StrictMode");
  await waitFor(
    () =>
      [...document.querySelectorAll<HTMLImageElement>(".room-character-visual-layer img")].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    "character pose images load",
  );
  let poseFrames = 0;
  let poseError = "";
  let observePoses = true;
  const checkPoseFrame = () => {
    if (!observePoses) return;
    const layers = [...document.querySelectorAll<HTMLElement>(".room-character-visual-layer")];
    if (layers.length) {
      const visible = layers.filter((layer) => Number(getComputedStyle(layer).opacity) > 0.01);
      if (visible.length !== 1 || Number(getComputedStyle(visible[0]).opacity) < 0.99) {
        poseError ||= `pose overlap or disappearance: ${layers.map((layer) => getComputedStyle(layer).opacity).join(", ")}`;
      }
      poseFrames++;
    }
    requestAnimationFrame(checkPoseFrame);
  };
  requestAnimationFrame(checkPoseFrame);
  for (const target of [
    "gameDesk2",
    "restroomZone",
    "gameDesk5",
    "gameDesk3",
    "restroomZone",
    "gameDesk1",
  ] as const) {
    delete document.body.dataset.settled;
    api().setZone(target);
    for (let i = 0; i < 12; i++) {
      await delay(30);
      api().rerender();
    }
    await waitFor(() => settled(target), `travel ${target}`);
    if (doorOpen()) throw new Error("seat/status updates reopened the door");
  }
  for (const target of [
    "gameDesk2",
    "restroomZone",
    "gameDesk4",
    "gameDesk3",
    "restroomZone",
  ] as const) {
    delete document.body.dataset.settled;
    api().setZone(target);
    await delay(90);
  }
  await waitFor(() => settled("restroomZone"), "interrupted travel");
  const element = document.querySelector<HTMLElement>(".scene-character-motion")!;
  const animate = element.animate;
  element.animate = function () {
    this.animate = animate;
    throw new Error("Injected animation failure");
  };
  delete document.body.dataset.settled;
  api().setZone("gameDesk4");
  await waitFor(
    () => settled("gameDesk4") && element.dataset.motionPhase === "idle",
    "failure recovery",
  );
  observePoses = false;
  if (poseError || poseFrames < 10) throw new Error(poseError || "too few pose frames sampled");
  api().setPresent(false);
  await waitFor(() => Boolean(doorOpen()), "door opens for departure");
  await waitFor(() => !document.querySelector(".scene-character-motion"), "exit");
  await waitFor(() => !doorOpen(), "door closes after departure");
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    scaledPosition: point,
    completedRoutes: 6,
    interruptions: 5,
    poseFrames,
    failureRecovery: true,
    exit: true,
    welcomeDoor: true,
  };
};
void verify().then(
  (result) => console.info(`MOTION_RESULT:${JSON.stringify(result)}`),
  (error) => console.error(`MOTION_FAILURE:${String(error)}`),
);
