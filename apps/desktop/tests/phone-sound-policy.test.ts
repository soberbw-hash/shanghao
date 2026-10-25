import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("phone cues are distinct and soft, use the shared volume, and obey feedback mute", () => {
  const played: { cue: string; volume: number; playbackRate: number }[] = [];
  const volumes: number[] = [];
  let playerVolume = -1;
  const source = ts.transpileModule(
    readFileSync(
      new URL("../src/renderer/src/features/audio/uiSound.ts", import.meta.url),
      "utf8",
    ).replaceAll("import.meta.url", '"file:///fixture/uiSound.ts"'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const exported = {} as {
    playUiSound(sound: string): void;
    setUiSoundVolume(volume: number): void;
    setUiSoundFeedbackEnabled(enabled: boolean): void;
  };
  runInNewContext(source, {
    exports: exported,
    URL,
    performance: { now: () => 1000 },
    window: {
      AudioContext: class {
        state = "running";
      },
    },
    require: (id: string) => {
      if (id === "uisfx")
        return {
          createUISFX: (options: { volume: number }) => {
            playerVolume = options.volume;
            return {
              play: (cue: string, recipe: { volume: number; playbackRate: number }) => {
                played.push({ cue, ...recipe });
                return undefined;
              },
              setVolume: (volume: number) => {
                playerVolume = volume;
                volumes.push(volume);
              },
              stopAll: () => undefined,
            };
          },
        };
      if (id === "../../utils/logger") return { writeRendererLog: async () => undefined };
      if (id === "../visual-runtime/waitForVisualIdle") return {};
      if (id === "./roomEntryCue") return {};
      throw Error(id);
    },
  });
  exported.setUiSoundVolume(0.25);
  exported.playUiSound("phone-mode-enter");
  exported.playUiSound("phone-mode-exit");
  assert.equal(played.length, 2);
  assert.notEqual(played[0].cue, played[1].cue);
  assert.ok(played.every((cue) => cue.volume > 0 && cue.volume <= 0.6));
  assert.equal(playerVolume, 0.25);
  exported.setUiSoundVolume(0);
  assert.equal(playerVolume, 0);
  assert.deepEqual(volumes, [0]);
  exported.setUiSoundFeedbackEnabled(false);
  exported.playUiSound("phone-mode-enter");
  exported.playUiSound("phone-mode-exit");
  assert.equal(played.length, 2, "disabled feedback cannot enqueue either cue");
});
