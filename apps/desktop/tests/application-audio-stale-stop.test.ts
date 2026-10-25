import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationAudioDelivery } from "../src/main/application-audio-delivery";
test("a delayed stop for an old audio share cannot reset the current IPC backpressure budget", () => {
  const delivery = new ApplicationAudioDelivery();
  for (let index = 1; index <= 8; index++) assert.equal(delivery.offer("current", index), true);
  delivery.clear("old");
  assert.equal(delivery.offer("current", 9), false);
  delivery.acknowledge("current", 1);
  assert.equal(delivery.offer("current", 9), true);
  delivery.clear("current");
  assert.equal(delivery.offer("next", 1), true);
});
