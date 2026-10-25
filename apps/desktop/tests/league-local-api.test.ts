import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:https";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLanCertificate } from "../src/main/temporary-lan-certificate";
import {
  clearLeagueConnectionCache,
  leagueConnection,
  readLeagueEndpoint,
} from "../src/main/league-client-api";

test(
  "turning detection off discards a late command-line credential lookup",
  { skip: process.platform !== "win32" },
  async () => {
    clearLeagueConnectionCache();
    let finish!: (value: unknown) => void;
    const reading = leagueConnection(
      [{ ProcessName: "LeagueClientUx", ProcessId: 999991 }],
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    clearLeagueConnectionCache();
    finish([
      { ProcessId: 999991, CommandLine: "--app-port=12345 --remoting-auth-token=synthetic" },
    ]);
    assert.equal(await reading, undefined);
    assert.equal(
      await leagueConnection(
        [{ ProcessName: "LeagueClientUx", ProcessId: 999991 }],
        async () => [],
      ),
      undefined,
    );
    clearLeagueConnectionCache();
  },
);

test("local client API uses bounded read-only loopback TLS, rejects redirects and cancels stalled reads", async (t) => {
  const received: { url?: string; method?: string; auth?: string }[] = [];
  const server = createServer(createLanCertificate(), (request, response) => {
    received.push({
      url: request.url,
      method: request.method,
      auth: request.headers.authorization,
    });
    if (request.url === "/lol-gameflow/v1/gameflow-phase") response.end(JSON.stringify("Lobby"));
    if (request.url === "/lol-gameflow/v1/session") {
      response.writeHead(302, { Location: "https://example.invalid/steal" });
      response.end();
    }
    // The lobby intentionally never returns, to check explicit cancellation.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connection = { port: address.port, password: "synthetic-local-test" };
  const controller = new AbortController();
  assert.equal(
    await readLeagueEndpoint("/lol-gameflow/v1/gameflow-phase", controller.signal, connection),
    "Lobby",
  );
  assert.equal(
    await readLeagueEndpoint("/lol-gameflow/v1/session", controller.signal, connection),
    undefined,
  );
  const waiting = readLeagueEndpoint("/lol-lobby/v2/lobby", controller.signal, connection);
  controller.abort();
  assert.equal(await waiting, undefined);
  assert.equal(received[0]?.method, "GET");
  assert.equal(
    received[0]?.auth,
    `Basic ${Buffer.from("riot:synthetic-local-test").toString("base64")}`,
  );
  assert.equal(received.filter((item) => item.url === "/steal").length, 0);
  assert.equal(
    await readLeagueEndpoint("/unexpected" as never, new AbortController().signal, connection),
    undefined,
  );
});

test("client discovery only reads the active client's bounded lockfile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-league-lock-"));
  try {
    const processes = [
      {
        ProcessName: "LeagueClient",
        ProcessId: 42,
        Path: path.join(directory, "LeagueClient.exe"),
      },
    ];
    await writeFile(path.join(directory, "lockfile"), "LeagueClient:42:12345:synthetic:https");
    assert.deepEqual(await leagueConnection(processes, async () => []), {
      port: 12345,
      password: "synthetic",
    });
    await writeFile(path.join(directory, "lockfile"), "LeagueClient:43:12345:synthetic:https");
    assert.equal(await leagueConnection(processes, async () => []), undefined);
    await writeFile(path.join(directory, "lockfile"), "X".repeat(2049));
    assert.equal(await leagueConnection(processes, async () => []), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
