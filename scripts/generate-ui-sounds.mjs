import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sampleRate = 44_100;
const outputDirectory = path.resolve(
  "apps/desktop/src/renderer/src/assets/sounds",
);

const sounds = {
  "button-click": [[720, 55]],
  "enter-room": [[523, 80], [659, 95]],
  "leave-room": [[523, 75], [392, 110]],
  "knock-bell": [[784, 80], [988, 120]],
  "popup-open": [[660, 60], [880, 80]],
  "copy-success": [[740, 55], [988, 80]],
  "device-switch": [[560, 60], [700, 75]],
  "send-message": [[760, 70]],
  "receive-message": [[620, 55], [820, 65]],
  "connection-restored": [[659, 70], [784, 90]],
  "connection-failed": [[440, 90], [349, 140]],
  "mic-error": [[320, 100], [270, 160]],
  "record-start": [[650, 95]],
  "record-stop": [[420, 110]],
  "mic-on": [[660, 90]],
  "mic-off": [[440, 90]],
};

const makeWav = (steps) => {
  const gapMs = 24;
  const durationMs = steps.reduce((total, [, duration]) => total + duration + gapMs, 0);
  const sampleCount = Math.ceil((durationMs / 1000) * sampleRate);
  const data = Buffer.alloc(sampleCount * 2);
  let cursor = 0;

  for (const [frequency, durationMsStep] of steps) {
    const toneSamples = Math.floor((durationMsStep / 1000) * sampleRate);
    for (let index = 0; index < toneSamples; index += 1) {
      const progress = index / toneSamples;
      const envelope = Math.sin(Math.PI * progress) ** 1.5;
      const sample = Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      data.writeInt16LE(Math.round(sample * envelope * 5_200), (cursor + index) * 2);
    }
    cursor += toneSamples + Math.floor((gapMs / 1000) * sampleRate);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

await mkdir(outputDirectory, { recursive: true });
for (const [name, steps] of Object.entries(sounds)) {
  await writeFile(path.join(outputDirectory, `${name}.wav`), makeWav(steps));
}

console.log(`Generated ${Object.keys(sounds).length} UI sounds in ${outputDirectory}`);
