import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GameMonitorContent } from "../../src/renderer/src/components/room/GameMonitorContent";
import type { GameSessionActivity } from "@private-voice/shared";
import "../../src/renderer/src/styles/index.css";
function Fixture() {
  const [phase, setPhase] = useState<GameSessionActivity["phase"]>("lobby");
  const [size, setSize] = useState(1);
  const [capacity, setCapacity] = useState(5);
  const [mode, setMode] = useState<GameSessionActivity["mode"]>("大乱斗");
  return (
    <main style={{ padding: 32 }}>
      <div id="monitor" style={{ position: "relative", width: 112, height: 67, borderRadius: 8 }}>
        <GameMonitorContent
          gameName="英雄联盟"
          gameSession={{
            source: "league",
            phase,
            mode,
            partySize: size,
            partyCapacity: capacity,
          }}
        />
      </div>
      <button onClick={() => setSize(2)}>two</button>
      <button
        onClick={() => {
          setCapacity(2);
          setSize(1);
        }}
      >
        one-of-two
      </button>
      <button
        onClick={() => {
          setCapacity(5);
          setSize(2);
        }}
      >
        two-of-five
      </button>
      <button onClick={() => setCapacity(14)}>fourteen</button>
      <button onClick={() => setMode("训练模式")}>practice</button>
      <button onClick={() => setPhase("ready-check")}>ready</button>
      <button onClick={() => setPhase("matchmaking")}>queue</button>
      <button onClick={() => setPhase("in-game")}>game</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
