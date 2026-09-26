import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";

import { PhoneMicUsbService } from "../src/main/phone-mic-usb-service";

test("USB source relays framed audio and releases its own mapping across 50 cycles", async () => {
  const commands: string[][] = [];
  const service = new PhoneMicUsbService(async (args) => {
    commands.push(args);
    if (args[0] === "devices")
      return "List of devices attached\nmock-serial\tdevice model:Pixel_7\n";
    return "";
  });
  try {
    for (let cycle = 0; cycle < 50; cycle++) {
      const session = await service.start();
      assert.match(session.url, /^http:\/\/localhost:\d+\/usb#code=/);
      assert.equal(session.serial, "mock-serial");
      if (cycle === 0) {
        const response = await fetch(session.url.split("#")[0]!);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /手机麦克风/);
        const connect = async (url: string) => {
          const socket = new WebSocket(url);
          await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          });
          return socket;
        };
        const receiver = await connect(session.receiverUrl);
        const sender = await connect(session.receiverUrl.replace("role=receiver", "role=sender"));
        const received = new Promise<Buffer>((resolve) => {
          receiver.on("message", (data, isBinary) => {
            if (isBinary) resolve(Buffer.from(data as Buffer));
          });
        });
        const frame = Buffer.alloc(1_928);
        frame.writeUInt32LE(42, 0);
        sender.send(frame);
        assert.deepEqual(await received, frame);
      }
      await service.stop();
    }
    const added = commands.filter((args) => args.includes("reverse") && !args.includes("--remove"));
    const removed = commands.filter(
      (args) => args.includes("reverse") && args.includes("--remove"),
    );
    assert.equal(added.length, 50);
    assert.equal(removed.length, 50);
    for (let index = 0; index < 50; index++) {
      assert.equal(removed[index]?.at(-1), added[index]?.at(-1));
    }
  } finally {
    await service.stop();
  }
});
