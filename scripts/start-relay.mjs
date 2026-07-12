import { readFile } from "node:fs/promises";

const loadLocalEnv = async () => {
  try {
    const source = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separator = line.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Environment variables remain the deployment fallback when .env is absent.
  }
};

await loadLocalEnv();

const { SignalingServer } = await import("../packages/signaling/dist/index.js");

const port = Number(process.env.PORT || "43821");
const roomName = process.env.ROOM_NAME || "ShangHao Relay";
const packageVersion =
  process.env.SHANGHAO_VERSION ||
  JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;

const server = new SignalingServer({
  port,
  roomName,
  packageVersion,
  logger: (message, context) => {
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        message,
        context,
      }),
    );
  },
});

const actualPort = await server.listen();
console.log(`ShangHao relay listening on ws://0.0.0.0:${actualPort}`);

const shutdown = async () => {
  console.log("Stopping ShangHao relay...");
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
