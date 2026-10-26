import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GameMonitorContent } from "../../src/renderer/src/components/room/GameMonitorContent";
import type { GameSessionActivity } from "@private-voice/shared";
import "../../src/renderer/src/styles/index.css";
function Fixture() {
  const [phase, setPhase] = useState<GameSessionActivity["phase"]>("lobby");
  const [size, setSize] = useState(1);
  return (
    <main style={{ padding: 32 }}>
      <div id="monitor" style={{ position: "relative", width: 240, height: 144, borderRadius: 8 }}>
        <GameMonitorContent
          gameName="英雄联盟"
          gameSession={{
            source: "league",
            phase,
            mode: "大乱斗",
            partySize: size,
            partyCapacity: 5,
          }}
        />
      </div>
      <button onClick={() => setSize(2)}>two</button>
      <button onClick={() => setPhase("matchmaking")}>queue</button>
      <button onClick={() => setPhase("in-game")}>game</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
