/* eslint-disable no-console -- Explicit opt-in probe emits only sanitized status metadata. */
import { execFileSync } from "node:child_process";
import { leagueConnection, readLeagueEndpoint } from "../src/main/league-client-api";
import { resolveLeagueActivity } from "../src/main/league-activity";
import type { ProcessSnapshot } from "../src/main/game-detection";
import { gameSessionLabel } from "@private-voice/shared";

// Explicit read-only probe. Never emits command lines, API passwords or player identities.
if (process.env.SHANGHAO_LIVE_LEAGUE_PROBE !== "1") throw new Error("explicit_live_probe_required");
const raw = execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Process -Name LeagueClient,LeagueClientUx -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ProcessId=$_.Id;ProcessName=$_.ProcessName;Path=$_.Path} } | ConvertTo-Json -Compress",
  ],
  { encoding: "utf8", windowsHide: true, timeout: 5000 },
);
const parsed = raw.trim() ? JSON.parse(raw) : [];
const processes: ProcessSnapshot[] = Array.isArray(parsed) ? parsed : [parsed];
const connection = await leagueConnection(processes);
const controller = new AbortController();
const phase = connection
  ? await readLeagueEndpoint("/lol-gameflow/v1/gameflow-phase", controller.signal, connection)
  : undefined;
const [lobby, session, live] = await Promise.all([
  phase === "Lobby"
    ? readLeagueEndpoint("/lol-lobby/v2/lobby", controller.signal, connection)
    : undefined,
  ["InProgress", "ChampSelect", "Matchmaking"].includes(String(phase))
    ? readLeagueEndpoint("/lol-gameflow/v1/session", controller.signal, connection)
    : undefined,
  phase === "InProgress"
    ? readLeagueEndpoint("/liveclientdata/gamestats", controller.signal)
    : undefined,
]);
const result = resolveLeagueActivity({ phase, lobby, session, live });
console.log(
  JSON.stringify({
    clientFound: processes.length > 0,
    localApiAvailable: phase !== undefined,
    phase: result?.phase,
    status: result ? gameSessionLabel(result) : undefined,
    source: result?.source,
    playerDataLogged: false,
    gameChanged: false,
  }),
);
