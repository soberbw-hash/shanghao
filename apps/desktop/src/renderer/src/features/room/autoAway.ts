export const AUTO_AWAY_IDLE_SECONDS = 30 * 60;
export const AUTO_RETURN_ACTIVE_SECONDS = 5;
export const IDLE_POLL_INTERVAL_MS = 10_000;

export type AutoAwayDecision = "none" | "auto_away" | "auto_return";

export const decideAutoAway = ({
  idleSeconds,
  isInAwayZone,
  awayMethod,
}: {
  idleSeconds: number;
  isInAwayZone: boolean;
  awayMethod?: "auto" | "manual";
}): AutoAwayDecision => {
  if (idleSeconds >= AUTO_AWAY_IDLE_SECONDS && !isInAwayZone) {
    return "auto_away";
  }
  if (idleSeconds < AUTO_RETURN_ACTIVE_SECONDS && isInAwayZone && awayMethod === "auto") {
    return "auto_return";
  }
  return "none";
};
