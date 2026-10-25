import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationAudioService } from "../src/main/application-audio-service";

test("music picker excludes browsers, games and chat even when their window title names music", async () => {
  const processNames = [
    "cloudmusic.exe",
    "QQMusic.exe",
    "AppleMusic.exe",
    "Spotify.exe",
    "Kugou.exe",
    "Soda Music.exe",
    "chrome.exe",
    "QQ.exe",
    "League of Legends.exe",
  ];
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    musicOnly: true,
    listNativeSources: async () =>
      processNames.map((processName, i) => ({
        pid: 8100 + i,
        creationTime: "123",
        processName,
        name: "QQ音乐 · Spotify",
      })),
  });
  try {
    assert.deepEqual(
      (await service.listSources()).sources.map((source) => source.processName),
      processNames.slice(0, 6),
    );
  } finally {
    await service.close();
  }
});

test("music source revalidation refuses a process that no longer qualifies before capture", async () => {
  let processName = "QQMusic.exe";
  let spawns = 0;
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    musicOnly: true,
    listNativeSources: async () => [{ pid: 8100, creationTime: "123", processName, name: "音乐" }],
    spawnCapture: () => {
      spawns++;
      throw Error("must not capture");
    },
  });
  try {
    const selected = (await service.listSources()).sources[0]!;
    processName = "chrome.exe";
    await assert.rejects(service.start(selected.id), /source_exited|source_identity_changed/);
    assert.equal(spawns, 0);
  } finally {
    await service.close();
  }
});
