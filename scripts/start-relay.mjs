import { SignalingServer } from "../packages/signaling/dist/index.js";
import { readFile } from "node:fs/promises";

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
