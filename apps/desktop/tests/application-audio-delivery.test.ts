import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationAudioDelivery } from "../src/main/application-audio-delivery";
test("a stalled renderer cannot accumulate PCM; foreign and stale acknowledgements cannot unlock another capture", () => {
  const delivery = new ApplicationAudioDelivery();
  for (let index = 0; index < 8; index++) assert.equal(delivery.offer("one", index), true);
  for (let index = 8; index < 1000; index++) assert.equal(delivery.offer("one", index), false);
  delivery.acknowledge("other", 0);
  assert.equal(delivery.offer("one", 1000), false);
  delivery.acknowledge("one", 0);
  assert.equal(delivery.offer("one", 1001), true);
  assert.equal(delivery.offer("two", 0), true);
  delivery.acknowledge("one", 0);
  assert.equal(delivery.offer("two", 0), false);
  delivery.clear();
  assert.equal(delivery.offer("two", 0), true);
});
