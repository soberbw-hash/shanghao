import { SignalingServer } from "../packages/signaling/dist/index.js";

const port = Number(process.env.PORT || "43821");
const roomName = process.env.ROOM_NAME || "ShangHao Relay";

const server = new SignalingServer({
  port,
  roomName,
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
