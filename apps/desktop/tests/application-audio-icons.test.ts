import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationAudioIcons } from "../src/main/application-audio-icons";
import { ApplicationAudioService } from "../src/main/application-audio-service";
const icon = "data:image/png;base64,aWNvbg==";
const row = {
  pid: 800,
  creationTime: "123",
  processName: "music.exe",
  name: "音乐",
  executablePath: "C:\\Apps\\music.exe",
};

test("icons load native executable metadata, deduplicate paths and refuse network paths", async () => {
  const calls: string[] = [];
  const icons = await readApplicationAudioIcons(
    [
      row,
      row,
      { ...row, executablePath: "\\\\remote\\music.exe" },
      { ...row, executablePath: "https://example.test/a.exe" },
    ],
    async (file) => {
      calls.push(file);
      return icon;
    },
  );
  assert.deepEqual(calls, [row.executablePath]);
  assert.equal(icons.get(row.executablePath)?.appIconDataUrl, icon);
  assert.equal(Object.hasOwn(icons.get(row.executablePath)!, "thumbnailDataUrl"), false);
});
test("bad or missing application icons do not fabricate a screenshot or prevent selection", async () => {
  assert.equal(
    (
      await readApplicationAudioIcons([row], async () => {
        throw Error("missing");
      })
    ).size,
    0,
  );
  assert.equal(
    (await readApplicationAudioIcons([row], async () => "data:text/html;base64,aA==")).size,
    0,
  );
});
test("opaque source ids carry icons without exposing process ids or executable paths", async () => {
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    listNativeSources: async () => [row],
    loadIcons: async () => new Map([[row.executablePath, { appIconDataUrl: icon }]]),
  });
  const source = (await service.listSources()).sources[0]!;
  assert.equal(source.appIconDataUrl, icon);
  for (const field of ["pid", "executablePath", "windowId", "thumbnailDataUrl"])
    assert.equal(Object.hasOwn(source, field), false);
  await service.close();
});
test("process identity change while reading icons discards the stale icon", async () => {
  let calls = 0;
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    listNativeSources: async () => [{ ...row, creationTime: ++calls === 1 ? "123" : "456" }],
    loadIcons: async () => new Map([[row.executablePath, { appIconDataUrl: icon }]]),
  });
  assert.equal((await service.listSources()).sources[0]?.appIconDataUrl, undefined);
  await service.close();
});
test("slow icon extraction falls back to selectable apps without multiplying background work", async () => {
  let calls = 0;
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    iconTimeoutMs: 10,
    listNativeSources: async () => [row],
    loadIcons: () => {
      calls++;
      return new Promise(() => undefined);
    },
  });
  assert.equal((await service.listSources()).sources.length, 1);
  assert.equal((await service.listSources()).sources.length, 1);
  assert.equal(calls, 1);
  await service.close();
});
