import { SignalingServer } from "@private-voice/signaling";

if (!process.env.SHANGHAO_CAPTURE_PATH) throw new Error("capture_only_server");
process.env.SHANGHAO_ALLOW_GUESTS = "true";
process.env.SHANGHAO_DEPLOYMENT_MODE = "development";
process.env.ALLOW_INSECURE_DEV_CONNECTION = "1";

const server = new SignalingServer({ port: 43821, roomName: "上号视觉检查" });
void server.listen().then((port) => console.log(`capture_relay_port=${port}`));
