import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

class Track {
  readyState = "live";
  contentHint = "";
  constructor(public id: string) {}
  stop() {
    this.readyState = "ended";
  }
}
class Stream {
  constructor(private tracks: Track[]) {}
  getAudioTracks() {
    return this.tracks;
  }
}
const contexts: Context[] = [];
class Context {
  closed = false;
  sampleRate = 32000;
  track = new Track(`mix-${contexts.length}`);
  constructor() {
    contexts.push(this);
  }
  createMediaStreamDestination() {
    return { stream: new Stream([this.track]) };
  }
  createMediaStreamSource() {
    return { connect: () => ({ connect: () => undefined }) };
  }
  createGain() {
    return { gain: { value: 0 } };
  }
  async close() {
    this.closed = true;
  }
}
function load<T>(relativePath: string): T {
  const exports = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(relativePath, import.meta.url), "utf8").replaceAll(
        "import.meta.env.DEV",
        "false",
      ),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      },
    ).outputText,
    {
      exports,
      // Constructor/network boundaries are intentionally not invoked. Exercise the
      // real replacement methods with controlled sender and Web Audio failures.
      require: (id: string) =>
        id.endsWith("/replaceOutgoingAudioTrack")
          ? load("../src/renderer/src/features/audio/replaceOutgoingAudioTrack.ts")
          : { writeRendererLog: async () => undefined },
      MediaStream: Stream,
      AudioContext: Context,
    },
  );
  return exports as T;
}
const { RoomClient } = load<{ RoomClient: { prototype: object } }>(
  "../src/renderer/src/features/room/roomClient.ts",
);
const { ScreenAudioMixer } = load<{
  ScreenAudioMixer: new () => {
    mix(mic: Track, system: Track, connect?: (track: Track) => Promise<void>): Promise<Track>;
    dispose(): void;
    hasActiveMix(): boolean;
  };
}>("../src/renderer/src/features/screen-share/ScreenAudioMixer.ts");
function clientFixture(fail: "peer" | "relay" | undefined) {
  const old = new Track("old");
  const next = new Track("new");
  const senders = [{ track: old }, { track: old }];
  let relay = new Stream([old]);
  const client = Object.assign(Object.create(RoomClient.prototype), {
    primaryInputTrack: old,
    localStream: relay,
    screenShareCoordinator: {},
    screenAudioMixer: new ScreenAudioMixer(),
    peers: new Map(
      senders.map((sender, index) => [
        index,
        {
          replaceLocalTrack: async (track: Track) => {
            if (index === 1) await new Promise((resolve) => setTimeout(resolve, 10));
            if (index === 0 && fail === "peer" && track !== old) throw new Error("sender failure");
            sender.track = track;
          },
        },
      ]),
    ),
    audioFallback: {
      replaceLocalStream: async (stream: Stream) => {
        relay = stream;
        if (fail === "relay" && stream.getAudioTracks()[0] !== old)
          throw new Error("relay failure");
      },
    },
  });
  return { client, old, next, senders, relay: () => relay.getAudioTracks()[0] };
}

for (const failure of ["peer", "relay"] as const) {
  test(`microphone ${failure} replacement failure restores previous live senders`, async () => {
    const f = clientFixture(failure);
    await assert.rejects(f.client.replaceInputTrack(f.next), /failure/);
    assert.equal(f.client.primaryInputTrack, f.old);
    assert.equal(f.client.localStream.getAudioTracks()[0], f.old);
    assert.equal(f.old.readyState, "live");
    assert.ok(f.senders.every((sender) => sender.track === f.old));
    assert.equal(f.relay(), f.old);
  });
}
test("successful microphone replacement retires old track only after all senders switch", async () => {
  const f = clientFixture(undefined);
  const pending = f.client.replaceInputTrack(f.next);
  assert.equal(f.old.readyState, "live");
  await pending;
  assert.equal(f.old.readyState, "ended");
  assert.equal(f.client.primaryInputTrack, f.next);
  assert.ok(f.senders.every((sender) => sender.track === f.next));
});
test("failed system-audio mix handoff retains previous graph and cleans only candidate", async () => {
  const mixer = new ScreenAudioMixer();
  const mic = new Track("mic"),
    system = new Track("system");
  const previous = await mixer.mix(mic, system);
  const previousContext = contexts.at(-1)!;
  await assert.rejects(
    mixer.mix(new Track("next"), system, async () => {
      throw new Error("handoff failed");
    }),
    /handoff failed/,
  );
  assert.equal(previous.readyState, "live");
  assert.equal(previousContext.closed, false);
  assert.equal(contexts.at(-1)!.closed, true);
  assert.equal(contexts.at(-1)!.track.readyState, "ended");
  await mixer.mix(mic, system);
  assert.equal(previous.readyState, "ended");
  assert.equal(previousContext.closed, true);
  mixer.dispose();
  assert.equal(contexts.at(-1)!.closed, true);
  assert.equal(mic.readyState, "live");
  assert.equal(system.readyState, "live");
});

test("disposing during a pending mix never resurrects its audio graph", async () => {
  const mixer = new ScreenAudioMixer();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const pending = mixer.mix(new Track("mic"), new Track("system"), () => gate);
  mixer.dispose();
  finish();
  await assert.rejects(pending, /superseded/);
  assert.equal(mixer.hasActiveMix(), false);
  assert.equal(contexts.at(-1)!.closed, true);
  assert.equal(contexts.at(-1)!.track.readyState, "ended");
});
