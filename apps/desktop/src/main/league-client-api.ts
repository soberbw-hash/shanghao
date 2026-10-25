import { open } from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessSnapshot } from "./game-detection";
import { platformService } from "./platform/PlatformService";

export interface LeagueConnection {
  port: number;
  password: string;
}
const execFileAsync = promisify(execFile);
let commandLineLookup:
  { identity: string; checkedAt: number; connection?: LeagueConnection } | undefined;
let connectionGeneration = 0;
export const clearLeagueConnectionCache = () => {
  connectionGeneration++;
  commandLineLookup = undefined;
};
export function parseLeagueCommandLine(value: string): LeagueConnection | undefined {
  const port = Number(/(?:^|\s)"?--app-port[= ](\d+)"?(?=\s|$)/.exec(value)?.[1]);
  const password = /(?:^|\s)"?--remoting-auth-token[= ]([^\s"]{1,128})"?(?=\s|$)/.exec(value)?.[1];
  return Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    password &&
    /^[\x21-\x7e]+$/.test(password)
    ? { port, password }
    : undefined;
}
const name = (value = "") => value.toLowerCase().replace(/\.exe$/, "");
export const isLeagueProcess = (process: ProcessSnapshot): boolean =>
  ["leagueclient", "leagueclientux", "league of legends", "leagueoflegends"].includes(
    name(process.ProcessName),
  );

export function parseLeagueLockfile(
  text: string,
  clientPids: ReadonlySet<number>,
): LeagueConnection | undefined {
  const parts = text.trim().split(":");
  if (parts.length !== 5 || parts[0] !== "LeagueClient" || parts[4] !== "https") return;
  const pid = Number(parts[1]),
    port = Number(parts[2]),
    password = parts[3]!;
  if (
    !Number.isInteger(pid) ||
    !clientPids.has(pid) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[\x21-\x7e]{1,128}$/.test(password)
  )
    return;
  return { port, password };
}

export async function leagueConnection(
  processes: ProcessSnapshot[],
  readCommandLines: () => Promise<unknown> = queryLeagueCommandLines,
): Promise<LeagueConnection | undefined> {
  const clients = processes.filter((process) =>
    ["leagueclient", "leagueclientux"].includes(name(process.ProcessName)),
  );
  const pids = new Set(clients.map((process) => process.ProcessId ?? -1));
  for (const client of clients) {
    const supplied = parseLeagueCommandLine(client.CommandLine ?? "");
    if (supplied) return supplied;
    if (!client.Path || !path.isAbsolute(client.Path)) continue;
    for (const directory of [path.dirname(client.Path), path.dirname(path.dirname(client.Path))]) {
      let file;
      try {
        file = await open(path.join(directory, "lockfile"), "r");
        const buffer = Buffer.alloc(2049);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 2048) continue;
        const connection = parseLeagueLockfile(buffer.toString("utf8", 0, bytesRead), pids);
        if (connection) return connection;
      } catch {
        /* Client closed, permissions unavailable or no local API: ordinary presence remains. */
      } finally {
        await file?.close();
      }
    }
  }
  if (!clients.length || !platformService.isWindows) return;
  const identity = JSON.stringify(clients.map((client) => [client.ProcessId, client.Path]).sort());
  if (commandLineLookup?.identity === identity && Date.now() - commandLineLookup.checkedAt < 30_000)
    return commandLineLookup.connection;
  // Some CN clients keep an empty lockfile. Query only the observed UX process,
  // once per client/cooldown; a higher-integrity client may require matching privileges.
  const generation = connectionGeneration;
  const parsed = await readCommandLines();
  if (generation !== connectionGeneration) return;
  let connection: LeagueConnection | undefined;
  try {
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (item && pids.has(item.ProcessId) && typeof item.CommandLine === "string")
        connection = parseLeagueCommandLine(item.CommandLine) ?? connection;
    }
  } catch {
    /* Do not log command lines: the local API password is present in them. */
  }
  commandLineLookup = { identity, checkedAt: Date.now(), connection };
  return connection;
}

async function queryLeagueCommandLines(): Promise<unknown> {
  const result = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024 },
  ).catch(() => undefined);
  try {
    return JSON.parse(result?.stdout ?? "null");
  } catch {
    return undefined;
  }
}

type Endpoint =
  | "/lol-gameflow/v1/gameflow-phase"
  | "/lol-gameflow/v1/session"
  | "/lol-lobby/v2/lobby"
  | "/liveclientdata/gamestats";
/** The self-signed TLS exception is confined to fixed GETs on numeric loopback. No redirects/proxy. */
export function readLeagueEndpoint(
  endpoint: Endpoint,
  signal: AbortSignal,
  connection?: LeagueConnection,
): Promise<unknown> {
  if (
    ![
      "/lol-gameflow/v1/gameflow-phase",
      "/lol-gameflow/v1/session",
      "/lol-lobby/v2/lobby",
      "/liveclientdata/gamestats",
    ].includes(endpoint)
  )
    return Promise.resolve(undefined);
  if (!connection && endpoint !== "/liveclientdata/gamestats") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const request = https.request(
      {
        hostname: "127.0.0.1",
        port: connection?.port ?? 2999,
        path: endpoint,
        method: "GET",
        rejectUnauthorized: false,
        signal,
        headers: connection
          ? {
              Authorization: `Basic ${Buffer.from(`riot:${connection.password}`).toString("base64")}`,
            }
          : {},
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(undefined);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            request.destroy();
            resolve(undefined);
          } else chunks.push(chunk);
        });
        response.on("error", () => resolve(undefined));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    const deadline = setTimeout(() => {
      request.destroy();
      resolve(undefined);
    }, 1000);
    request.once("close", () => clearTimeout(deadline));
    request.on("error", () => resolve(undefined));
    request.end();
  });
}
