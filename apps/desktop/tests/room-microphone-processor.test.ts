import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { defaultSettings } from "../src/main/settings-migration";

test("room processor retains dynamic remote reference and capture ownership on every rebuild", () => {
  const source = ts.transpileModule(
    readFileSync(
      new URL("../src/renderer/src/features/audio/roomMicrophoneProcessor.ts", import.meta.url),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = {
    exports: {} as { createRoomMicrophoneProcessor: (source: object, settings?: object) => void },
  };
  let remoteLevel = 0.25;
  const calls: {
    stream: object;
    settings: typeof defaultSettings & {
      getRemoteReferenceLevel: () => number;
      stopInputOnDispose: boolean;
    };
  }[] = [];
  runInNewContext(source, {
    exports: module.exports,
    require: (id: string) => {
      if (id === "./RemoteAudioMixer")
        return { getRemoteAudioMixer: () => ({ getRemoteReferenceLevel: () => remoteLevel }) };
      if (id === "./microphoneProcessor")
        return {
          createProcessedMicrophoneStream: (
            stream: object,
            settings: (typeof calls)[number]["settings"],
          ) => {
            calls.push({ stream, settings });
          },
        };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  for (const stopInputOnDispose of [true, false]) {
    const stream = {};
    module.exports.createRoomMicrophoneProcessor({ stream, stopInputOnDispose }, defaultSettings);
    const call = calls.at(-1)!;
    assert.equal(call.stream, stream);
    assert.equal(call.settings.stopInputOnDispose, stopInputOnDispose);
    assert.equal(call.settings.getRemoteReferenceLevel(), remoteLevel);
    remoteLevel += 0.1;
    assert.equal(
      call.settings.getRemoteReferenceLevel(),
      remoteLevel,
      "reference remains live rather than snapshotting a level",
    );
    assert.equal(call.settings.microphoneSendVolume, defaultSettings.microphoneSendVolume);
  }
  module.exports.createRoomMicrophoneProcessor({ stream: {}, stopInputOnDispose: true });
  assert.equal(calls.at(-1)!.settings.isNoiseSuppressionEnabled, true);
  assert.equal(calls.at(-1)!.settings.lowCutFrequency, "75");

  const roomSource = readFileSync(
    new URL("../src/renderer/src/hooks/useRoomState.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    (roomSource.match(/await createRoomMicrophoneProcessor\(/g) ?? []).length,
    2,
    "initial capture and device replacement share the same configuration",
  );
});
