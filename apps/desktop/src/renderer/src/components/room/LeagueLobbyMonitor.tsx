import {
  gameSessionLabel,
  isGameSessionActivity,
  type GameSessionActivity,
} from "@private-voice/shared";

/** A waiting-room picture only appears when the local client reported a real party. */
export function hasLeagueLobbyParty(
  session?: GameSessionActivity,
): session is GameSessionActivity & { partySize: number; partyCapacity: number } {
  return Boolean(
    session &&
    isGameSessionActivity(session) &&
    ["lobby", "matchmaking", "ready-check"].includes(session.phase) &&
    session.partySize &&
    session.partyCapacity,
  );
}

export function LeagueLobbyMonitor({
  session,
}: {
  session: GameSessionActivity & { partySize: number; partyCapacity: number };
}) {
  return (
    <span className="scene-league-lobby" aria-label={gameSessionLabel(session)}>
      <span className="scene-league-lobby-heading">
        {session.phase === "lobby"
          ? "等待队友"
          : session.phase === "ready-check"
            ? "找到对局"
            : "正在匹配"}
      </span>
      <span
        className="scene-league-lobby-slots"
        style={{ gridTemplateColumns: `repeat(${Math.min(session.partyCapacity, 8)},1fr)` }}
        aria-hidden="true"
      >
        {Array.from({ length: session.partyCapacity }, (_, index) => (
          <span key={index} data-occupied={index < session.partySize}>
            <svg viewBox="0 0 20 28">
              <path d="M10 2 18 8v12l-8 6-8-6V8Z" />
              <circle cx="10" cy="10" r="3" />
              <path d="M5 20c0-6 10-6 10 0" />
            </svg>
          </span>
        ))}
      </span>
      <span className="scene-league-lobby-count">
        {session.partySize}/{session.partyCapacity}
      </span>
    </span>
  );
}
