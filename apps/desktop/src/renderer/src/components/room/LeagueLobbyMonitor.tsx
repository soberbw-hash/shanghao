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
    <span
      className="scene-league-lobby"
      data-mode={session.mode}
      aria-label={gameSessionLabel(session)}
    >
      <span className="scene-league-lobby-heading">
        {session.phase === "lobby"
          ? "等待队友"
          : session.phase === "ready-check"
            ? "找到对局"
            : "正在匹配"}
      </span>
      <span className="scene-league-lobby-count">
        {session.partySize}/{session.partyCapacity}
      </span>
      <span
        className="scene-league-lobby-slots"
        data-dense={session.partyCapacity > 8}
        style={{
          gridTemplateColumns: `repeat(${Math.min(session.partyCapacity, 8)}, minmax(0, 1fr))`,
        }}
        aria-hidden="true"
      >
        {Array.from({ length: session.partyCapacity }, (_, index) => (
          <span key={index} data-occupied={index < session.partySize}>
            {index < session.partySize ? (
              <svg className="scene-league-lobby-player" viewBox="0 0 32 40">
                <path
                  className="scene-league-lobby-crest"
                  d="M16 1 27 7 29 19 26 30 16 39 6 30 3 19 5 7Z"
                />
                <circle className="scene-league-lobby-portrait" cx="16" cy="16" r="7" />
                <circle className="scene-league-lobby-face" cx="16" cy="14" r="2.5" />
                <path className="scene-league-lobby-face" d="M11 21c0-5 10-5 10 0" />
              </svg>
            ) : (
              <svg className="scene-league-lobby-empty" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
