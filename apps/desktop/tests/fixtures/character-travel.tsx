/* eslint-disable no-console -- Emits structured results to the Electron test harness. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence } from "framer-motion";
import { MemberSpeakingState, type RoomMember, type SceneZoneId } from "@private-voice/shared";
import { SceneCharacter } from "../../src/renderer/src/components/room/SceneCharacter";
import { readRenderedScenePosition } from "../../src/renderer/src/features/voice-scene/characterMotionRuntime";
import "../../src/renderer/src/styles/parts/50-character.css";
import "../../src/renderer/src/styles/parts/100-scene-weather.css";

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
      <style>{`.scene-character-motion { position: absolute; } .room-character-sprite { position: relative; }`}</style>
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
  await waitFor(() => settled("gameDesk1"), "entry");
  const point = api().read();
  if (Math.abs(point.left - 30) > 0.05 || Math.abs(point.top - 34.7) > 0.05) {
    throw new Error(`scaled position: ${JSON.stringify(point)}`);
  }
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
  api().setPresent(false);
  await waitFor(() => !document.querySelector(".scene-character-motion"), "exit");
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    scaledPosition: point,
    completedRoutes: 6,
    interruptions: 5,
    failureRecovery: true,
    exit: true,
  };
};
void verify().then(
  (result) => console.info(`MOTION_RESULT:${JSON.stringify(result)}`),
  (error) => console.error(`MOTION_FAILURE:${String(error)}`),
);
